import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { logAction, AUDIT } from '../../lib/audit.js'
import { buildCustomerRepaymentJournalEntry } from '../../lib/ledger.js'
import type { TokenPayload } from '../../lib/jwt.js'

export interface RecordRepaymentInput {
  customerId: string
  amount:     number
  method:     'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER'
  reference?: string | null
  notes?:     string | null
}

export interface AgingBucket {
  customerId: string; customerName: string; phone: string | null
  current: number; days30: number; days60: number; days90Plus: number; total: number
}

/** Accounts-receivable aging: outstanding CREDIT sales bucketed by days overdue past dueDate. */
export async function getArAgingReport(channelId?: string) {
  const customers = await prisma.customer.findMany({
    where: { outstandingCredit: { gt: 0 }, ...(channelId && { channelId }) },
    select: { id: true, name: true, phone: true, outstandingCredit: true },
  })
  if (customers.length === 0) return { buckets: [], totals: { current: 0, days30: 0, days60: 0, days90Plus: 0, total: 0 } }

  const sales = await prisma.sale.findMany({
    where: {
      customerId: { in: customers.map(c => c.id) },
      saleType:   'CREDIT',
      deletedAt:  null,
    },
    orderBy: { createdAt: 'asc' },
  })

  const now = Date.now()
  const buckets: AgingBucket[] = customers.map(c => {
    const row: AgingBucket = {
      customerId: c.id, customerName: c.name, phone: c.phone,
      current: 0, days30: 0, days60: 0, days90Plus: 0, total: 0,
    }

    const customerSales = sales.filter(s => s.customerId === c.id)

    // FIX: repayments (recordRepayment, below) are a lump-sum reduction of
    // Customer.outstandingCredit — they are never allocated to a specific
    // sale, since no sale-level payment mechanism for credit exists (the
    // only Payment row a credit sale ever has is its original placeholder
    // with method 'CREDIT', created once at commit and never touched
    // again). Summing "non-CREDIT payments" per sale was therefore always
    // zero, so `outstanding` always equaled the full original netAmount —
    // every repayment ever made was silently ignored, permanently
    // overstating this report. outstandingCredit is the one number that
    // actually reflects repayments; allocate it across this customer's
    // credit sales oldest-first (standard FIFO aging convention) so the
    // bucketed total always reconciles exactly to what's really still owed.
    const totalOriginal = customerSales.reduce((sum, s) => sum + Number(s.netAmount), 0)
    let repaidPool = Math.max(0, totalOriginal - Number(c.outstandingCredit))

    for (const s of customerSales) {
      const saleAmount = Number(s.netAmount)
      const payoff = Math.min(saleAmount, repaidPool)
      repaidPool -= payoff
      const outstanding = saleAmount - payoff
      if (outstanding <= 0) continue

      const reference = s.dueDate ?? s.createdAt
      const daysOverdue = Math.floor((now - new Date(reference).getTime()) / (1000 * 60 * 60 * 24))

      if (daysOverdue <= 0)      row.current   += outstanding
      else if (daysOverdue <= 30) row.days30   += outstanding
      else if (daysOverdue <= 60) row.days60   += outstanding
      else                        row.days90Plus += outstanding
    }
    row.total = row.current + row.days30 + row.days60 + row.days90Plus
    return row
  }).filter(r => r.total > 0)

  const totals = buckets.reduce((acc, r) => ({
    current:   acc.current   + r.current,
    days30:    acc.days30    + r.days30,
    days60:    acc.days60    + r.days60,
    days90Plus: acc.days90Plus + r.days90Plus,
    total:     acc.total     + r.total,
  }), { current: 0, days30: 0, days60: 0, days90Plus: 0, total: 0 })

  return { buckets: buckets.sort((a, b) => b.total - a.total), totals }
}

/**
 * Supplier balance summary — an approximation, not a true aging report.
 * The Purchase model has no due-date or partial-payment tracking, so this
 * surfaces non-cash (assumed-credit) purchase totals per supplier rather
 * than genuinely aged, per-invoice outstanding balances.
 */
export async function getApBalanceSummary(channelId?: string) {
  const purchases = await prisma.purchase.groupBy({
    by:     ['supplierId'],
    where:  {
      deletedAt: null,
      paymentMethod: { not: 'CASH' },
      ...(channelId && { channelId }),
    },
    _sum:   { totalCost: true },
    _count: { _all: true },
  })
  if (purchases.length === 0) return []

  const suppliers = await prisma.supplier.findMany({
    where:  { id: { in: purchases.map(p => p.supplierId) } },
    select: { id: true, name: true, phone: true },
  })
  const supplierById = new Map(suppliers.map(s => [s.id, s]))

  return purchases
    .map(p => ({
      supplierId:   p.supplierId,
      supplierName: supplierById.get(p.supplierId)?.name ?? 'Unknown supplier',
      phone:        supplierById.get(p.supplierId)?.phone ?? null,
      purchaseCount: p._count._all,
      totalValue:   Number(p._sum.totalCost ?? 0),
    }))
    .sort((a, b) => b.totalValue - a.totalValue)
}

export async function recordRepayment(
  input: RecordRepaymentInput,
  actor: TokenPayload
): Promise<{
  customerId:              string
  amountPaid:              number
  newOutstanding:          number
  newSuccessfulRepayments: number
  warning?:                string
}> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where:  { id: input.customerId },
      select: {
        id: true, name: true, outstandingCredit: true,
        creditLimit: true, successfulRepayments: true, channelId: true,
      },
    })

    if (!customer.channelId) {
      throw { statusCode: 422, message: `Customer "${customer.name}" has no channel assignment. Cannot record payment.` }
    }

    // FIX: the balance was read here, capped in JS, then decremented. Two
    // repayments arriving together both read the same outstanding figure, both
    // capped against it, and both decremented — so a customer owing 1,000 who
    // paid it off twice at once ended up at −1,000, with two CustomerPayment
    // rows and two journal entries crediting 2,000 against a 1,000 debt.
    // The cap and the decrement now happen in one statement: the row is locked
    // first, so a concurrent repayment waits and then caps against what is
    // genuinely left. `before − after` is the amount actually applied, which is
    // what the receipt and the ledger entry must both use.
    const [applied] = await tx.$queryRaw<Array<{
      before: Prisma.Decimal; after: Prisma.Decimal; applied: Prisma.Decimal; repayments: number
    }>>`
      WITH locked AS (
        SELECT "outstandingCredit" AS before
        FROM customers
        WHERE id = ${input.customerId}
        FOR UPDATE
      ),
      upd AS (
        UPDATE customers c
        SET "outstandingCredit"    = c."outstandingCredit" - LEAST(${input.amount}::numeric, c."outstandingCredit"),
            "successfulRepayments" = c."successfulRepayments" + 1
        FROM locked
        WHERE c.id = ${input.customerId}
          AND c."outstandingCredit" > 0
        RETURNING locked.before, c."outstandingCredit" AS after, c."successfulRepayments" AS repayments
      )
      SELECT before, after, (before - after) AS applied, repayments FROM upd
    `

    if (!applied) {
      throw { statusCode: 422, message: `${customer.name} has no outstanding credit balance to repay.` }
    }

    const amountToApply = Number(applied.applied)
    const warning = input.amount > amountToApply
      ? `Payment of ${input.amount} exceeds outstanding balance of ${Number(applied.before).toFixed(2)}. Only ${amountToApply.toFixed(2)} was applied.`
      : undefined

    await tx.customerPayment.create({
      data: {
        customerId: input.customerId,
        channelId:  customer.channelId,
        method:     input.method,
        amount:     new Prisma.Decimal(amountToApply.toFixed(4)),
        reference:  input.reference ?? null,
        notes:      input.notes ?? null,
      },
    })

    const updated = { outstandingCredit: applied.after, successfulRepayments: applied.repayments }

    await buildCustomerRepaymentJournalEntry(
      tx as any, input.customerId, amountToApply, input.method, customer.channelId, actor.sub
    )

    return {
      customerId:              input.customerId,
      amountPaid:              amountToApply,
      newOutstanding:          Number(updated.outstandingCredit),
      newSuccessfulRepayments: updated.successfulRepayments,
      ...(warning ? { warning } : {}),
    }
  })
}

export async function getCreditStatus(customerId: string) {
  const customer = await prisma.customer.findUniqueOrThrow({
    where:  { id: customerId },
    select: {
      id: true, name: true, creditLimit: true, outstandingCredit: true,
      successfulRepayments: true, tier: true,
      customerPayments: {
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  { amount: true, method: true, reference: true, createdAt: true },
      },
      sales: {
        // FIX 13: filter out reversed sales (deletedAt: null) from recent credit sales
        where:   { saleType: 'CREDIT', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  { receiptNo: true, netAmount: true, createdAt: true, dueDate: true },
      },
    },
  })

  const creditLimit       = Number(customer.creditLimit)
  const outstandingCredit = Number(customer.outstandingCredit)
  const availableCredit   = Math.max(0, creditLimit - outstandingCredit)
  const utilisationPct    = creditLimit > 0 ? (outstandingCredit / creditLimit) * 100 : 0

  return {
    customerId:           customer.id,
    name:                 customer.name,
    tier:                 customer.tier,
    creditLimit,
    outstandingCredit,
    availableCredit,
    utilisationPercent:   Number(utilisationPct.toFixed(2)),
    successfulRepayments: customer.successfulRepayments,
    recentPayments:       customer.customerPayments,
    recentCreditSales:    customer.sales,
  }
}

export async function adjustCreditLimit(
  customerId: string,
  newLimit:   number,
  actor:      TokenPayload
): Promise<{ customerId: string; oldLimit: number; newLimit: number }> {
  if (newLimit < 0) throw { statusCode: 422, message: 'Credit limit cannot be negative' }

  const customer = await prisma.customer.findUniqueOrThrow({
    where:  { id: customerId },
    select: { creditLimit: true, outstandingCredit: true, name: true },
  })

  const oldLimit    = Number(customer.creditLimit)
  const outstanding = Number(customer.outstandingCredit)

  if (newLimit < outstanding) {
    throw {
      statusCode: 422,
      message: `Cannot set credit limit to ${newLimit.toLocaleString()} — `
             + `${customer.name} already owes ${outstanding.toLocaleString()}.`,
    }
  }

  await prisma.customer.update({
    where: { id: customerId },
    data:  { creditLimit: new Prisma.Decimal(newLimit.toFixed(4)) },
  })

  // FIX 8: Remove the `?? 'CREDIT_LIMIT_ADJUST'` fallback — AUDIT.CREDIT_LIMIT_ADJUST
  // is now defined in audit.ts. Fallback strings are dangerous because they
  // silently write uncontrolled values to the audit log if the import breaks.
  logAction({
    action:     AUDIT.CREDIT_LIMIT_ADJUST,
    actorId:    actor.sub,
    actorRole:  actor.role,
    channelId:  actor.channelId ?? undefined,
    targetType: 'customer',
    targetId:   customerId,
    oldValues:  { creditLimit: oldLimit },
    newValues:  { creditLimit: newLimit },
  })

  return { customerId, oldLimit, newLimit }
}
