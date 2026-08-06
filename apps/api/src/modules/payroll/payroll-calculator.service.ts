import { prisma } from '../../lib/prisma.js'

interface DeductionResult {
  name: string
  amount: number
  isEmployerContribution: boolean
  isPreTax: boolean
}

// ── Safe numeric conversion ───────────────────────────────────────────
// Prisma Decimal fields return Decimal objects. Number() usually works
// but can produce NaN when the underlying value is null, undefined, or
// a non-numeric string. This helper always returns a finite number.
function n(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const result = Number(value)
  if (!isFinite(result) || isNaN(result)) {
    console.warn(`[payroll-calculator] Non-finite numeric value encountered: ${value}. Using fallback: ${fallback}`)
    return fallback
  }
  return result
}

export interface PrefetchedPayrollRules {
  allowanceRules: any[]
  deductionRules: any[]
}

export async function calculateNetSalary(
  staffProfileId: string, 
  runDate: Date = new Date(),
  prefetchedRules?: PrefetchedPayrollRules
) {
  const profile = await prisma.staffProfile.findUniqueOrThrow({
    where: { id: staffProfileId },
    include: { user: true },
  })

  // Guard: grossSalary must be a positive number
  const grossSalary = n(profile.grossSalary)
  if (grossSalary <= 0) {
    throw {
      statusCode: 422,
      message: `Staff profile ${staffProfileId} (${profile.user.username}) has a zero or invalid grossSalary. Cannot calculate payroll.`,
    }
  }

  const channelRuleScope = profile.user.channelId
    ? { OR: [{ channelId: profile.user.channelId }, { channelId: null }] }
    : { channelId: null }

  // ── Fetch allowances ──────────────────────────────────────────────
  const allowanceRules = prefetchedRules 
    ? prefetchedRules.allowanceRules.filter(r => 
        r.isActive && (r.appliesToJobLevelId === profile.jobLevelId || r.appliesToJobLevelId === null)
      )
    : await prisma.allowanceRule.findMany({
        where: {
          isActive: true,
          AND: [
            channelRuleScope,
            {
              OR: [
                { appliesToJobLevelId: profile.jobLevelId },
                { appliesToJobLevelId: null },
              ],
            },
          ],
        },
      })

  const allowances = allowanceRules.map(r => {
    // FIX 5: Allowance percentages apply to base grossSalary only —
    // using grossWithAllowances here would be circular (allowance
    // inflating the base that calculates the next allowance).
    const amount =
      r.type === 'FIXED_AMOUNT'
        ? n(r.amount)
        : grossSalary * (n(r.amount) / 100)

    return { name: r.name, amount }
  })

  const allowancesTotal     = allowances.reduce((s, a) => s + a.amount, 0)
  const grossWithAllowances = grossSalary + allowancesTotal

  // ── Fetch deduction rules ordered by calculationSequence ─────────
  const deductionRules = prefetchedRules
    ? prefetchedRules.deductionRules
        .filter(r => 
          r.isActive && (r.appliesToJobLevelId === profile.jobLevelId || r.appliesToJobLevelId === null)
        )
        .sort((a, b) => (a.calculationSequence ?? 100) - (b.calculationSequence ?? 100))
    : await prisma.deductionRule.findMany({
        where: {
          isActive: true,
          AND: [
            channelRuleScope,
            {
              OR: [
                { appliesToJobLevelId: profile.jobLevelId },
                { appliesToJobLevelId: null },
              ],
            },
          ],
        },
        orderBy: { calculationSequence: 'asc' },
        include: { brackets: { orderBy: { incomeFrom: 'asc' } } },
      })

  const deductions: DeductionResult[] = []
  let preTaxDeductionsTotal = 0
  let taxableBase           = grossWithAllowances

  for (const rule of deductionRules) {
    // ── Filter brackets by temporal validity ──────────────────────
    const validBrackets = rule.brackets.filter((b: any) => {
      const afterStart  = !b.effectiveStartDate || runDate >= new Date(b.effectiveStartDate.toISOString())
      const beforeEnd   = !b.effectiveEndDate   || runDate <= new Date(b.effectiveEndDate.toISOString())
      return afterStart && beforeEnd
    })

    const calcBase =
      rule.type === 'PERCENTAGE_OF_TAXABLE' ? taxableBase : grossWithAllowances

    let amount = 0

    if (rule.type === 'FIXED_AMOUNT') {
      // FIX 2: null rate on a FIXED_AMOUNT rule is a data config error —
      if (rule.rate === null || rule.rate === undefined) {
        console.warn(`[payroll-calculator] DeductionRule "${rule.name}" is FIXED_AMOUNT but has no rate. Using 0 to prevent blocking payroll.`)
        amount = 0
      } else {
        amount = n(rule.rate)
      }

    } else if (rule.type === 'PERCENTAGE_OF_GROSS' || rule.type === 'PERCENTAGE_OF_TAXABLE') {
      const rate = n(rule.rate)
      if (rate === 0) {
        console.warn(`[payroll-calculator] DeductionRule "${rule.name}" has a zero rate — deduction will be 0.`)
      }
      amount = calcBase * (rate / 100)

    } else if (rule.type === 'BRACKET_TABLE') {
      const bracket = validBrackets.find((b: any) =>
        calcBase >= n(b.incomeFrom) &&
        (b.incomeTo === null || calcBase <= n(b.incomeTo))
      )

      if (bracket) {
        amount = calcBase * (n(bracket.ratePercentage) / 100) + n(bracket.fixedDeduction)
      } else {
        // FIX 4: log a warning so misconfigured brackets surface in logs
        console.warn(
          `[payroll-calculator] DeductionRule "${rule.name}" (BRACKET_TABLE): no matching bracket for income ${calcBase} on ${runDate.toISOString()}. Deduction will be 0.`
        )
      }
    }

    // ── Apply floor and cap ──────────────────────────────────────
    const floor = rule.minimumFloorAmount ? n(rule.minimumFloorAmount) : null
    const cap   = rule.maximumCapAmount   ? n(rule.maximumCapAmount)   : null

    if (floor !== null && amount < floor) amount = floor
    if (cap   !== null && amount > cap)   amount = cap

    // ── Final NaN guard before pushing ───────────────────────────
    // FIX 1: Catch NaN here, default to 0 and warn instead of aborting salary run.
    if (!isFinite(amount) || isNaN(amount)) {
      console.warn(`[payroll-calculator] DeductionRule "${rule.name}" produced a non-numeric result (${amount}). Forced to 0.`)
      amount = 0
    }

    deductions.push({
      name:                   rule.name,
      amount,
      isEmployerContribution: rule.isEmployerContribution,
      isPreTax:               rule.isPreTaxDeduction,
    })

    if (rule.isPreTaxDeduction && !rule.isEmployerContribution) {
      preTaxDeductionsTotal += amount
      taxableBase            = grossWithAllowances - preTaxDeductionsTotal
    }
  }

  const employeeDeductions  = deductions.filter(d => !d.isEmployerContribution)
  const employerDeductions  = deductions.filter(d => d.isEmployerContribution)
  const totalEmployeeDeduct = employeeDeductions.reduce((s, d) => s + d.amount, 0)

  // FIX 3: Guard against grossWithAllowances being zero
  if (grossWithAllowances <= 0) {
    throw {
      statusCode: 422,
      message: `Staff profile ${staffProfileId}: grossWithAllowances computed as ${grossWithAllowances}. Cannot produce a valid net salary.`,
    }
  }

  const netSalary       = grossWithAllowances - totalEmployeeDeduct
  const employerCostTotal =
    grossWithAllowances + employerDeductions.reduce((s, d) => s + d.amount, 0)

  return {
    staffProfileId,
    userName:           profile.user.username,
    grossSalary,
    allowances,
    allowancesTotal,
    grossWithAllowances,
    taxableBase,
    deductions,
    netSalary,
    employerCostTotal,
  }
}
