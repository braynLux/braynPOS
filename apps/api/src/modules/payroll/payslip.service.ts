import { prisma } from '../../lib/prisma.js'
import { calculateNetSalary } from './payroll-calculator.service.js'
import { buildPayrollJournalEntry } from '../../lib/ledger.js'
import { buildCommissionPayout } from '../commission/commission.service.js'
import { verifyPassword } from '../../lib/password.js'
import { logAction, AUDIT } from '../../lib/audit.js'

// Safe numeric conversion — mirrors the one in the calculator
function n(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback
  const result = Number(value)
  return isFinite(result) && !isNaN(result) ? result : fallback
}

export class PayslipService {
  async createSalaryRun(month: number, year: number, runBy: string, channelId: string) {
    const whereChannel = { user: { channelId } }

    const staffProfiles = await prisma.staffProfile.findMany({
      where: { ...whereChannel },
      include: { user: { select: { id: true, username: true, channelId: true, role: true } } },
    })

    if (staffProfiles.length === 0) {
      throw { statusCode: 400, message: 'No staff profiles found' }
    }

    // ── Pre-fetch all rules once to avoid thousands of queries ───────
    const [allowanceRules, deductionRules] = await Promise.all([
      prisma.allowanceRule.findMany({
        where: {
          isActive: true,
          OR: [{ channelId }, { channelId: null }],
        },
      }),
      prisma.deductionRule.findMany({ 
        where: {
          isActive: true,
          OR: [{ channelId }, { channelId: null }],
        }, 
        include: { brackets: { orderBy: { incomeFrom: 'asc' } } } 
      }),
    ])

    const prefetchedRules = { allowanceRules, deductionRules }
    const runDate = new Date(year, month - 1, 15)
    const warnings: string[] = []

    // ── Pre-calculate all net salaries BEFORE starting transaction ───
    // This allows the transaction to be purely focused on persistence.
    const calculations = await Promise.all(
      staffProfiles.map(async (profile) => {
        try {
          const calc = await calculateNetSalary(profile.id, runDate, prefetchedRules)
          return { profile, calc, error: null }
        } catch (err: any) {
          return { profile, calc: null, error: err?.message || 'Calculation failed' }
        }
      })
    )

    return prisma.$transaction(async (tx) => {
      const salaryRun = await tx.salaryRun.create({
        data: {
          month,
          year,
          channelId: channelId ?? null,
          status:    'DRAFT',
          runBy,
        },
      })

      let totalGross       = 0
      let totalNet         = 0
      let totalDeductions  = 0
      let totalEmployerCost = 0

      for (const item of calculations) {
        const { profile, calc, error } = item
        if (error || !calc) {
          warnings.push(`Skipped ${profile.user.username}: ${error}`)
          continue
        }

        const deductionsTotal = calc.deductions
          .filter(d => !d.isEmployerContribution)
          .reduce((s, d) => s + d.amount, 0)

        const periodStart = new Date(year, month - 1, 1)
        const periodEnd   = new Date(year, month, 0, 23, 59, 59)

        // FIX 2: Use tx.commissionEntry (type-safe) instead of (tx as any)
        const entries = await tx.commissionEntry.findMany({
          where: { userId: profile.userId, status: 'PENDING', createdAt: { gte: periodStart, lte: periodEnd }, ...(channelId ? { channelId } : {}) }
        })

        await tx.commissionEntry.updateMany({
          where: {
            userId:    profile.userId,
            status:    'PENDING',
            createdAt: { gte: periodStart, lte: periodEnd },
            ...(channelId ? { channelId } : {}),
          },
          data: { status: 'APPROVED' },
        })

        const payout          = await buildCommissionPayout(profile.userId, periodStart, periodEnd, channelId, tx)
        const commissionTotal = n(payout?.totalCommission)
        const netWithCommission = calc.netSalary + commissionTotal

        // Refetch the exact entries included in this payout for the breakdown
        const payoutEntries = payout?.payoutId 
          ? await tx.commissionEntry.findMany({ where: { payoutId: payout.payoutId } })
          : []

        // FIX 4: Guard against NaN before any DB write
        const fieldsToCheck = {
          grossSalary:   calc.grossSalary,
          allowancesTotal: calc.allowancesTotal,
          deductionsTotal,
          netSalary:     netWithCommission,
          employerCost:  calc.employerCostTotal,
        }
        for (const [field, value] of Object.entries(fieldsToCheck)) {
          if (!isFinite(value) || isNaN(value)) {
            throw {
              statusCode: 422,
              message: `NaN detected in salary calculation for ${profile.user.username} — field: ${field}, value: ${value}. Aborting salary run to prevent data corruption.`,
            }
          }
        }

        await tx.salaryRunLine.create({
          data: {
            salaryRunId:     salaryRun.id,
            staffProfileId:  profile.id,
            grossSalary:     calc.grossSalary,
            allowancesTotal: calc.allowancesTotal,
            deductionsTotal,
            netSalary:       netWithCommission,
            employerCost:    calc.employerCostTotal,
            breakdown: {
              ...calc,
              commission: {
                amount:        commissionTotal,
                payoutId:      payout?.payoutId ?? null,
                totalMargin:   payoutEntries.reduce((s: number, e: any) => s + Number(e.grossMargin), 0),
                avgRate:       payoutEntries.length > 0 ? payoutEntries.reduce((s: number, e: any) => s + Number(e.rateApplied), 0) / payoutEntries.length : 0,
                saleCount:     payoutEntries.length,
                note:          commissionTotal > 0 ? `Earned from ${payoutEntries.length} sales` : 'No commission earned',
              },
            } as any,
          },
        })

        // FIX 2: Use tx.commissionPayout (type-safe)
        if (payout?.payoutId) {
          await tx.commissionPayout.update({
            where: { id: payout.payoutId },
            data:  { salaryRunId: salaryRun.id, status: 'PAID', processedAt: new Date() },
          })
        }

        totalGross        += calc.grossSalary + calc.allowancesTotal + commissionTotal
        totalNet          += netWithCommission
        totalDeductions   += deductionsTotal
        totalEmployerCost += calc.employerCostTotal
      }

      const updatedRun = await tx.salaryRun.update({
        where: { id: salaryRun.id },
        data: {
          totalGross,
          totalNet,
          totalDeductions,
          totalEmployerCost,
        } as any,
      })

      return {
        salaryRun:   updatedRun,
        totalPayroll: totalNet,
        staffCount:   staffProfiles.length,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    }, {
      timeout: 30000 // Increase timeout to 30s for large payroll runs
    })
  }

  async finalizeSalaryRun(salaryRunId: string, postedBy: string, actorRole = 'MANAGER') {
    return prisma.$transaction(async (tx) => {
      const run = await tx.salaryRun.findUniqueOrThrow({
        where:   { id: salaryRunId },
        include: { lines: true },
      })

      if (run.status === 'FINALIZED') {
        throw { statusCode: 400, message: 'Salary run is already finalized' }
      }

      // FIX 5: null channelId means a global/cross-channel run — the
      // journal entry builder must handle null explicitly, not receive
      // the string 'global' which could be mistaken for a real channelId.
      if (!run.channelId) {
        throw {
          statusCode: 422,
          message: 'Cannot finalize a salary run with no channel assigned. Set a channelId on the salary run before finalizing.',
        }
      }

      const totalPayroll = run.lines.reduce((s, l) => s + n(l.netSalary), 0)

      await buildPayrollJournalEntry(tx, salaryRunId, totalPayroll, run.channelId, postedBy)

      await tx.salaryRun.update({
        where: { id: salaryRunId },
        data:  { status: 'FINALIZED', finalizedAt: new Date() } as any,
      })

      logAction({
        action:     AUDIT.PAYROLL_RUN_FINALIZE,
        actorId:    postedBy,
        actorRole,
        channelId:  run.channelId || undefined,
        targetType: 'SalaryRun',
        targetId:   salaryRunId,
        newValues:  { totalPayroll },
      })

      return { message: 'Salary run finalized', totalPayroll }
    })
  }

  async getSalaryRun(id: string) {
    const run = await prisma.salaryRun.findUniqueOrThrow({
      where:   { id },
      include: {
        lines: {
          include: {
            staffProfile: {
              include: { user: { include: { channel: { select: { name: true } } } } },
            },
          },
        },
      },
    })
    const { lines, ...rest } = run
    return { ...rest, payslips: lines }
  }

  async listSalaryRuns(page = 1, limit = 25) {
    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      prisma.salaryRun.findMany({
        skip, take: limit,
        orderBy: { runAt: 'desc' },
        include: { _count: { select: { lines: true } } },
      }),
      prisma.salaryRun.count(),
    ])
    const runs = data.map(r => {
      const { _count, ...rest } = r
      return { ...rest, payslipsCount: _count.lines }
    })
    return { data: runs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async updateSalaryRunLine(lineId: string, deductionsTotal: number) {
    return prisma.$transaction(async (tx) => {
      const line = await tx.salaryRunLine.findUniqueOrThrow({
        where:   { id: lineId },
        include: { salaryRun: true },
      })

      if (line.salaryRun.status !== 'DRAFT') {
        throw { statusCode: 400, message: 'Can only edit deductions for draft salary runs' }
      }

      // FIX 1: Preserve commission when recalculating net salary.
      // The original formula was: netSalary = grossSalary + allowancesTotal - deductionsTotal
      // This wiped commission because it was never included in that formula.
      // Commission is stored in the breakdown JSON — read it back before recalculating.
      const breakdown       = line.breakdown as any
      const commissionAmount = n(breakdown?.commission?.amount)
      const basePay         = n(line.grossSalary) + n(line.allowancesTotal)
      const netSalary       = basePay - deductionsTotal + commissionAmount

      if (!isFinite(netSalary) || isNaN(netSalary)) {
        throw {
          statusCode: 422,
          message: `Recalculated netSalary is non-numeric (${netSalary}). Check the deductionsTotal value.`,
        }
      }

      await tx.salaryRunLine.update({
        where: { id: lineId },
        data:  { deductionsTotal, netSalary },
      })

      // Recalculate parent SalaryRun totals using all lines
      const allLines = await tx.salaryRunLine.findMany({
        where: { salaryRunId: line.salaryRunId },
      })

      const totalGross        = allLines.reduce((s, l) => s + n(l.grossSalary) + n(l.allowancesTotal), 0)
      const totalNet          = allLines.reduce((s, l) => s + n(l.netSalary), 0)
      const totalDeductions   = allLines.reduce((s, l) => s + n(l.deductionsTotal), 0)
      const totalEmployerCost = allLines.reduce((s, l) => s + n(l.employerCost), 0)

      await tx.salaryRun.update({
        where: { id: line.salaryRunId },
        data:  { totalGross, totalNet, totalDeductions, totalEmployerCost } as any,
      })

      return { message: 'Line updated', netSalary }
    })
  }

  async getPayslip(staffProfileId: string, month: number, year: number) {
    const line = await prisma.salaryRunLine.findFirst({
      where: {
        staffProfileId,
        salaryRun: { month, year },
      },
      include: {
        salaryRun:    true,
        staffProfile: {
          include: { user: { include: { channel: { select: { name: true } } } } },
        },
      },
    })
    if (!line) throw { statusCode: 404, message: 'Payslip not found' }
    return line
  }

  async verifyUserPassword(userId: string, password?: string) {
    if (!password) throw { statusCode: 400, message: 'Password is required' }
    const user    = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const isValid = await verifyPassword(user.passwordHash, password)
    if (!isValid) throw { statusCode: 401, message: 'Invalid password. Action denied.' }
  }

  async deleteSalaryRun(id: string, userId: string, password?: string, actorRole = 'MANAGER') {
    await this.verifyUserPassword(userId, password)
    return prisma.$transaction(async (tx) => {
      const run = await tx.salaryRun.findUniqueOrThrow({ where: { id } })
      if (run.status !== 'DRAFT') throw { statusCode: 400, message: 'Only draft salary runs can be deleted.' }
      
      const lines = await tx.salaryRunLine.findMany({ where: { salaryRunId: id }, include: { staffProfile: true } })
      const userIds = lines.map(l => l.staffProfile.userId)
      // FIX: Reset entries that were set to PAID or APPROVED back to PENDING
      // This allows them to be picked up by the next run.
      await tx.commissionEntry.updateMany({
        where: { 
          userId:    { in: userIds }, 
          status:    { in: ['APPROVED', 'PAID'] }, 
          createdAt: { gte: new Date(run.year, run.month - 1, 1), lte: new Date(run.year, run.month, 0, 23, 59, 59) } 
        },
        data: { status: 'PENDING', payoutId: null }
      })
      await tx.commissionPayout.deleteMany({ where: { salaryRunId: id } })
      await tx.salaryRunLine.deleteMany({ where: { salaryRunId: id } })
      await tx.salaryRun.delete({ where: { id } })

      logAction({
        action:     AUDIT.PAYROLL_RUN_DELETE,
        actorId:    userId,
        actorRole,
        channelId:  run.channelId || undefined,
        targetType: 'SalaryRun',
        targetId:   id,
      })

      return { message: 'Salary run deleted' }
    })
  }

  async reverseSalaryRun(id: string, userId: string, password?: string, actorRole = 'MANAGER') {
    await this.verifyUserPassword(userId, password)
    return prisma.$transaction(async (tx) => {
      const run = await tx.salaryRun.findUniqueOrThrow({ where: { id } })
      if (run.status !== 'FINALIZED') throw { statusCode: 400, message: 'Only finalized salary runs can be reversed' }

      if (run.finalizedAt) {
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        if (run.finalizedAt < threeDaysAgo) {
          throw { statusCode: 400, message: 'Finalized payroll runs can only be reversed within 3 days (Window Expired).' }
        }
      }

      // ── FIX: Do NOT hard-delete journal entries ───────────────────
      // Hard-deleting accounting records breaks the audit trail and
      // violates double-entry bookkeeping integrity. Reversals in
      // accounting are handled by creating counter-entries (DR ↔ CR
      // swapped), not by erasing the originals.
      //
      // We create a reversal journal entry with flipped debits/credits:
      //   Original:  DR Payroll Expense / CR Cash on Hand
      //   Reversal:  DR Cash on Hand    / CR Payroll Expense
      const journals = await tx.journalEntry.findMany({
        where:   { referenceId: id, referenceType: 'PAYROLL' },
        include: { lines: true },
      })

      for (const je of journals) {
        // Mark original entry as reversed
        await tx.journalEntry.update({
          where: { id: je.id },
          data:  { reversedAt: new Date() } as any,
        })

        // Create counter-entry with all debits/credits flipped
        const reversalJe = await tx.journalEntry.create({
          data: {
            description:   `Reversal of: ${je.description}`,
            referenceId:   id,
            referenceType: 'PAYROLL_REVERSAL' as any,

            channelId:     je.channelId,
            postedBy:      userId,
          },
        })

        await tx.ledgerLine.createMany({
          data: je.lines.map((line: any) => ({
            journalEntryId: reversalJe.id,
            accountId:      line.accountId,
            // Flip debit ↔ credit to reverse the accounting effect
            debitAmount:    line.creditAmount,
            creditAmount:   line.debitAmount,
          })),
        })
      }

      await tx.salaryRun.update({
        where: { id },
        data:  { status: 'DRAFT', finalizedAt: null } as any,
      })

      logAction({
        action:     AUDIT.PAYROLL_RUN_REVERSE,
        actorId:    userId,
        actorRole,
        channelId:  run.channelId || undefined,
        targetType: 'SalaryRun',
        targetId:   id,
      })

      return { message: 'Salary run reversed to draft' }
    })
  }

  async autoDeleteOldDrafts() {
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    
    // Find drafts older than 3 days
    const oldDrafts = await prisma.salaryRun.findMany({
      where: { status: 'DRAFT', createdAt: { lt: threeDaysAgo } },
      select: { id: true }
    })

    // ── FIX: Isolate each wipe — one failure must not abort the rest ─
    let succeeded = 0
    let failed    = 0
    for (const draft of oldDrafts) {
      try {
        await this.performDraftWipe(draft.id)
        succeeded++
      } catch (err: any) {
        failed++
        // Log but continue — don't let one bad draft block all others
        console.error(`[payslip] autoDeleteOldDrafts: failed to wipe draft ${draft.id}:`, err?.message)
      }
    }

    return { total: oldDrafts.length, succeeded, failed }
  }

  private async performDraftWipe(id: string) {
    return prisma.$transaction(async (tx) => {
      const run = await tx.salaryRun.findUniqueOrThrow({ where: { id } })
      const lines = await tx.salaryRunLine.findMany({ where: { salaryRunId: id }, include: { staffProfile: true } })
      const userIds = lines.map(l => l.staffProfile.userId)
      
      await tx.commissionEntry.updateMany({
        where: { 
          userId:    { in: userIds }, 
          status:    { in: ['APPROVED', 'PAID'] }, 
          createdAt: { gte: new Date(run.year, run.month - 1, 1), lte: new Date(run.year, run.month, 0, 23, 59, 59) } 
        },
        data: { status: 'PENDING', payoutId: null }
      })
      await tx.commissionPayout.deleteMany({ where: { salaryRunId: id } })
      await tx.salaryRunLine.deleteMany({ where: { salaryRunId: id } })
      await tx.salaryRun.delete({ where: { id } })
    })
  }
}

export const payslipService = new PayslipService()
