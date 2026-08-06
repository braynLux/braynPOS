import type { TransactionClient } from './prisma.js'

// Inlined from packages/shared — eliminates cross-package import that
// caused tsc rootDir to resolve to monorepo root, breaking dist/ output path
const SYSTEM_ACCOUNT_IDS = {
  CASH_ON_HAND: 'acc-1010',
  BANK_ACCOUNT: 'acc-1020',
  ACCOUNTS_RECEIVABLE: 'acc-1200',
  INVENTORY_VALUE: 'acc-1500',
  ACCOUNTS_PAYABLE: 'acc-2000',
  RETAINED_EARNINGS: 'acc-3000',
  SALES_REVENUE: 'acc-4000',
  COGS: 'acc-5000',
  SHRINKAGE_LOSS: 'acc-5100',
  PAYROLL_EXPENSE: 'acc-5200',
  GENERAL_EXPENSE: 'acc-5300',
  TAX_PAYABLE: 'acc-2100',
} as const

export const ACCOUNT_IDS = SYSTEM_ACCOUNT_IDS

interface SaleForJournal {
  id:          string
  receiptNo:   string
  channelId:   string
  totalAmount: number | { toNumber(): number }
  netAmount:   number | { toNumber(): number }
  taxAmount?:  number | { toNumber(): number }
  saleType?:   string
}

function toNum(val: number | { toNumber(): number } | undefined | null, fallback = 0): number {
  if (val === null || val === undefined) return fallback
  return typeof val === 'number' ? val : val.toNumber()
}

// ── SALE ──────────────────────────────────────────────────────────────
// Cash sale:   DR Cash on Hand        / CR Sales Revenue + DR COGS / CR Inventory
// Credit sale: DR Accounts Receivable / CR Sales Revenue + DR COGS / CR Inventory
//
// FIX 1: Was using totalAmount (pre-discount gross) for the debit line.
// The actual cash received (or AR created) is netAmount (post-discount).
// Using gross overstated Cash/AR and made the entry unbalanced when
// discounts existed. Now uses netAmount for the revenue/asset lines.
//
// FIX 2: Tax line support added. When taxAmount > 0, Sales Revenue is
// credited only the pre-tax net, and Tax Payable receives the tax portion.
// This keeps the journal balanced: Cash DR = Revenue CR + Tax Payable CR.
export async function buildSaleJournalEntry(
  tx:        TransactionClient,
  sale:      SaleForJournal,
  totalCost: number,
  postedBy:  string,
  isCredit = false
) {
  const netAmount = toNum(sale.netAmount)
  const taxAmount = toNum(sale.taxAmount)
  // Revenue is net of tax — tax goes to a separate liability account
  const revenueAmount = netAmount - taxAmount

  const je = await tx.journalEntry.create({
    data: {
      description:   `Sale ${sale.receiptNo}`,
      referenceId:   sale.id,
      referenceType: 'SALE',
      channelId:     sale.channelId,
      postedBy,
    },
  })

  const debitAccountId = isCredit
    ? ACCOUNT_IDS.ACCOUNTS_RECEIVABLE
    : ACCOUNT_IDS.CASH_ON_HAND

  const lines: any[] = [
    // FIX 1: netAmount replaces totalAmount — actual cash/AR created
    { journalEntryId: je.id, accountId: debitAccountId,              debitAmount: netAmount,     creditAmount: 0 },
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.SALES_REVENUE,   debitAmount: 0,             creditAmount: revenueAmount },
  ]

  // FIX 2: Tax line — only written when tax is actually applied
  if (taxAmount > 0) {
    lines.push(
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.TAX_PAYABLE, debitAmount: 0, creditAmount: taxAmount }
    )
  }

  if (totalCost > 0) {
    lines.push(
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.COGS,            debitAmount: totalCost, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: 0,         creditAmount: totalCost }
    )
  }

  await tx.ledgerLine.createMany({ data: lines })
  return je
}

// ── EXPENSE ───────────────────────────────────────────────────────────
// DR: General Expense / CR: Cash, Bank, Accounts Payable, or Retained Earnings —
// depending on how the expense was funded.
const EXPENSE_CREDIT_ACCOUNT: Record<string, string> = {
  CASH:     ACCOUNT_IDS.CASH_ON_HAND,
  BANK:     ACCOUNT_IDS.BANK_ACCOUNT,
  CREDITOR: ACCOUNT_IDS.ACCOUNTS_PAYABLE,
  CAPITAL:  ACCOUNT_IDS.RETAINED_EARNINGS,
}

export async function buildExpenseJournalEntry(
  tx:      TransactionClient,
  expense: { id: string; description: string; amount: number | { toNumber(): number }; channelId: string; paymentSource?: string },
  postedBy: string
) {
  const amount = toNum(expense.amount)
  const creditAccountId = EXPENSE_CREDIT_ACCOUNT[expense.paymentSource ?? 'CASH'] ?? ACCOUNT_IDS.CASH_ON_HAND

  const je = await tx.journalEntry.create({
    data: {
      description:   `Expense: ${expense.description}`,
      referenceId:   expense.id,
      referenceType: 'EXPENSE',
      channelId:     expense.channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.GENERAL_EXPENSE, debitAmount: amount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: creditAccountId,             debitAmount: 0,      creditAmount: amount },
    ],
  })

  return je
}

// ── EXPENSE REVERSAL ──────────────────────────────────────────────────
// DR: Cash on Hand / CR: General Expense
// FIX: referenceType was 'EXPENSE' — identical to the original expense.
// Reversals are now tagged 'EXPENSE_REVERSAL' so they are distinguishable
// in the journal, P&L reports, and audit queries.
export async function buildExpenseReversalJournalEntry(
  tx:      TransactionClient,
  expense: { id: string; description: string; amount: number | { toNumber(): number }; channelId: string },
  postedBy: string
) {
  const amount = toNum(expense.amount)

  const je = await tx.journalEntry.create({
    data: {
      description:   `Reversal of Expense: ${expense.description}`,
      referenceId:   expense.id,
      referenceType: 'EXPENSE_REVERSAL',   // FIX: was 'EXPENSE'
      channelId:     expense.channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.CASH_ON_HAND,    debitAmount: amount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.GENERAL_EXPENSE, debitAmount: 0,      creditAmount: amount },
    ],
  })

  return je
}

// ── TRANSFER SHRINKAGE ────────────────────────────────────────────────
// DR: Shrinkage & Transit Loss / CR: Inventory Valuation
export async function buildShrinkageJournalEntry(
  tx:             TransactionClient,
  transferNo:     string,
  shrinkageValue: number,
  channelId:      string,
  postedBy:       string
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Transit loss: ${transferNo}`,
      referenceId:   transferNo,
      referenceType: 'TRANSFER_DISPUTE',
      channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.SHRINKAGE_LOSS,  debitAmount: shrinkageValue, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: 0,              creditAmount: shrinkageValue },
    ],
  })

  return je
}

// ── PURCHASE ──────────────────────────────────────────────────────────
// DR: Inventory Valuation / CR: Accounts Payable (credit) or Cash (cash)
export async function buildPurchaseJournalEntry(
  tx:       TransactionClient,
  purchase: { id: string; purchaseNo: string; channelId: string },
  totalCost: number,
  postedBy:  string,
  isCashPayment = false
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Purchase ${purchase.purchaseNo}`,
      referenceId:   purchase.id,
      referenceType: 'PURCHASE',
      channelId:     purchase.channelId,
      postedBy,
    },
  })

  const creditAccountId = isCashPayment
    ? ACCOUNT_IDS.CASH_ON_HAND
    : ACCOUNT_IDS.ACCOUNTS_PAYABLE

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: totalCost, creditAmount: 0 },
      { journalEntryId: je.id, accountId: creditAccountId,              debitAmount: 0,         creditAmount: totalCost },
    ],
  })

  return je
}

// ── PURCHASE RETURN / VOID ────────────────────────────────────────────
// DR: Accounts Payable (or Cash) / CR: Inventory Valuation
export async function buildPurchaseReturnJournalEntry(
  tx:       TransactionClient,
  purchase: { id: string; purchaseNo: string; channelId: string },
  totalCost: number,
  postedBy:  string,
  wasCash = false
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Void/Return Purchase ${purchase.purchaseNo}`,
      referenceId:   purchase.id,
      referenceType: 'ADJUSTMENT',
      channelId:     purchase.channelId,
      postedBy,
    },
  })

  const debitAccountId = wasCash
    ? ACCOUNT_IDS.CASH_ON_HAND
    : ACCOUNT_IDS.ACCOUNTS_PAYABLE

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: debitAccountId,              debitAmount: totalCost, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: 0,         creditAmount: totalCost },
    ],
  })

  return je
}

// ── PAYROLL ───────────────────────────────────────────────────────────
// DR: Payroll Expense / CR: Cash on Hand
export async function buildPayrollJournalEntry(
  tx:           TransactionClient,
  salaryRunId:  string,
  totalPayroll: number,
  channelId:    string,
  postedBy:     string
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Payroll run ${salaryRunId}`,
      referenceId:   salaryRunId,
      referenceType: 'PAYROLL',
      channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.PAYROLL_EXPENSE, debitAmount: totalPayroll, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.CASH_ON_HAND,    debitAmount: 0,            creditAmount: totalPayroll },
    ],
  })

  return je
}

// ── CREDIT NOTE (SALE REVERSAL) ───────────────────────────────────────
// Cash reversal:   DR Sales Revenue / CR Cash on Hand   + DR Inventory / CR COGS
// Credit reversal: DR Sales Revenue / CR Accounts Rec.  + DR Inventory / CR COGS
export async function buildCreditNoteJournalEntry(
  tx:           TransactionClient,
  referenceId:  string,
  refundAmount: number,
  costAmount:   number,
  channelId:    string,
  postedBy:     string,
  wasCredit = false
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Credit note for ${referenceId}`,
      referenceId,
      referenceType: 'CREDIT_NOTE',
      channelId,
      postedBy,
    },
  })

  const creditAccountId = wasCredit
    ? ACCOUNT_IDS.ACCOUNTS_RECEIVABLE
    : ACCOUNT_IDS.CASH_ON_HAND

  const lines: any[] = [
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.SALES_REVENUE, debitAmount: refundAmount, creditAmount: 0 },
    { journalEntryId: je.id, accountId: creditAccountId,            debitAmount: 0,            creditAmount: refundAmount },
  ]

  if (costAmount > 0) {
    lines.push(
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: costAmount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.COGS,            debitAmount: 0,          creditAmount: costAmount }
    )
  }

  await tx.ledgerLine.createMany({ data: lines })
  return je
}

// ── BANK DEPOSIT ──────────────────────────────────────────────────────
// DR: Bank / Cash Clearing / CR: Cash on Hand
export async function buildBankDepositJournalEntry(
  tx:        TransactionClient,
  depositId: string,
  amount:    number,
  channelId: string,
  postedBy:  string
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Bank deposit ${depositId}`,
      referenceId:   depositId,
      referenceType: 'BANK_DEPOSIT',
      channelId,
      postedBy,
    },
  })

  const bankAccountId = ACCOUNT_IDS.BANK_ACCOUNT ?? ACCOUNT_IDS.CASH_ON_HAND

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: bankAccountId,               debitAmount: amount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.CASH_ON_HAND,    debitAmount: 0,      creditAmount: amount },
    ],
  })

  return je
}
