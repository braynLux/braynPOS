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
const PAYMENT_DEBIT_ACCOUNTS: Record<string, string> = {
  CASH:           ACCOUNT_IDS.CASH_ON_HAND,
  MOBILE_MONEY:   ACCOUNT_IDS.BANK_ACCOUNT,
  CARD:           ACCOUNT_IDS.BANK_ACCOUNT,
  BANK_TRANSFER:  ACCOUNT_IDS.BANK_ACCOUNT,
  CREDIT:         ACCOUNT_IDS.ACCOUNTS_RECEIVABLE,
  LOYALTY_POINTS: ACCOUNT_IDS.CASH_ON_HAND,
}

export async function buildSaleJournalEntry(
  tx:        TransactionClient,
  sale:      SaleForJournal,
  totalCost: number,
  postedBy:  string,
  isCredit = false,
  payments?: { method: string; amount: number | { toNumber(): number } }[]
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

  const lines: any[] = []

  // 1. Debit lines: split across payment accounts or single default
  if (payments && payments.length > 0) {
    for (const pmt of payments) {
      const pmtAmt = toNum(pmt.amount)
      if (pmtAmt <= 0) continue
      const debitAccountId = PAYMENT_DEBIT_ACCOUNTS[pmt.method] || ACCOUNT_IDS.CASH_ON_HAND
      lines.push({
        journalEntryId: je.id,
        accountId:      debitAccountId,
        debitAmount:    pmtAmt,
        creditAmount:   0,
      })
    }
  } else {
    const debitAccountId = isCredit
      ? ACCOUNT_IDS.ACCOUNTS_RECEIVABLE
      : ACCOUNT_IDS.CASH_ON_HAND
    lines.push({
      journalEntryId: je.id,
      accountId:      debitAccountId,
      debitAmount:    netAmount,
      creditAmount:   0,
    })
  }

  // 2. Credit line: Sales Revenue
  lines.push({
    journalEntryId: je.id,
    accountId:      ACCOUNT_IDS.SALES_REVENUE,
    debitAmount:    0,
    creditAmount:   revenueAmount,
  })

  // 3. Tax line: only written when tax is actually applied
  if (taxAmount > 0) {
    lines.push({
      journalEntryId: je.id,
      accountId:      ACCOUNT_IDS.TAX_PAYABLE,
      debitAmount:    0,
      creditAmount:   taxAmount,
    })
  }

  // 4. Cost of Goods Sold & Inventory Asset
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
// DR: Cash, Bank, Accounts Payable, or Retained Earnings (by paymentSource) / CR: General Expense
// FIX: referenceType was 'EXPENSE' — identical to the original expense.
// Reversals are now tagged 'EXPENSE_REVERSAL' so they are distinguishable
// in the journal, P&L reports, and audit queries.
//
// FIX 2: this always debited Cash on Hand regardless of how the expense was
// actually paid — the exact bug already fixed on buildExpenseJournalEntry's
// forward path (see EXPENSE_CREDIT_ACCOUNT above), just missed here. Deleting
// a BANK/CREDITOR/CAPITAL-funded expense left that account permanently
// understated while incorrectly inflating Cash on Hand.
export async function buildExpenseReversalJournalEntry(
  tx:      TransactionClient,
  expense: { id: string; description: string; amount: number | { toNumber(): number }; channelId: string; paymentSource?: string },
  postedBy: string
) {
  const amount = toNum(expense.amount)
  const debitAccountId = EXPENSE_CREDIT_ACCOUNT[expense.paymentSource ?? 'CASH'] ?? ACCOUNT_IDS.CASH_ON_HAND

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
      { journalEntryId: je.id, accountId: debitAccountId,               debitAmount: amount, creditAmount: 0 },
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

// ── STOCK ADJUSTMENT SHRINKAGE ─────────────────────────────────────────
// DR: Shrinkage & Transit Loss / CR: Inventory Valuation
// Same account treatment as transfer shrinkage above, but for manual stock
// adjustments (damage/expiry/theft) — kept separate so referenceType and the
// journal description stay accurate rather than reusing 'Transit loss' /
// TRANSFER_DISPUTE for something that isn't a transfer.
export async function buildStockAdjustmentShrinkageJournalEntry(
  tx:             TransactionClient,
  referenceId:    string,
  description:    string,
  shrinkageValue: number,
  channelId:      string,
  postedBy:       string
) {
  const je = await tx.journalEntry.create({
    data: {
      description,
      referenceId,
      referenceType: 'ADJUSTMENT',
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

// ── MARGIN CORRECTION ────────────────────────────────────────────────────
// DR: COGS / CR: Inventory Valuation
//
// FIX: repairMargin() (margin-correction.service.ts) retroactively fixes a
// SaleItem's costPriceSnapshot from 0 to its real cost — reports that
// compute COGS live from costPriceSnapshot (reports.service.ts) pick this
// up correctly, but the sale's original journal entry already posted COGS
// at the old (zero) cost and is never touched. Without this, the formal
// ledger (Trial Balance / P&L / Balance Sheet) permanently understates
// COGS and overstates Inventory Valuation for every repaired historical
// sale, even after the "fix".
export async function buildMarginCorrectionJournalEntry(
  tx:         TransactionClient,
  saleId:     string,
  correction: number,
  channelId:  string,
  postedBy:   string
) {
  const je = await tx.journalEntry.create({
    data: {
      description:   `Margin correction for sale ${saleId}`,
      referenceId:   saleId,
      referenceType: 'ADJUSTMENT',
      channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.COGS,            debitAmount: correction, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.INVENTORY_VALUE, debitAmount: 0,          creditAmount: correction },
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

// ── CREDIT NOTE (SALE REVERSAL — full void or partial return) ─────────
// Cash reversal:   DR Sales Revenue + DR Tax Payable / CR Cash on Hand   + DR Inventory / CR COGS
// Credit reversal: DR Sales Revenue + DR Tax Payable / CR Accounts Rec. + DR Inventory / CR COGS
//
// FIX: netAmount is what was actually posted to Cash/AR on the original sale
// (buildSaleJournalEntry debits netAmount, not the pre-discount totalAmount).
// The reversal must credit the same netAmount back, split between Sales
// Revenue and Tax Payable exactly as the original entry split it — otherwise
// a voided/returned sale with a discount or tax leaves the ledger unbalanced
// and permanently overstates Tax Payable.
export async function buildCreditNoteJournalEntry(
  tx:           TransactionClient,
  referenceId:  string,
  netAmount:    number,
  taxAmount:    number,
  costAmount:   number,
  channelId:    string,
  postedBy:     string,
  wasCredit = false
) {
  const revenueAmount = netAmount - taxAmount

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
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.SALES_REVENUE, debitAmount: revenueAmount, creditAmount: 0 },
    { journalEntryId: je.id, accountId: creditAccountId,            debitAmount: 0,             creditAmount: netAmount },
  ]

  if (taxAmount > 0) {
    lines.push(
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.TAX_PAYABLE, debitAmount: taxAmount, creditAmount: 0 }
    )
  }

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

// ── INVOICE (B2B ACCOUNTS RECEIVABLE) ──────────────────────────────────
// DR: Accounts Receivable / CR: Sales Revenue + Tax Payable (if any)
// Only INVOICE-type documents post — QUOTATION and PROFORMA are non-binding
// and must not touch the books until converted into an actual invoice.
export async function buildInvoiceJournalEntry(
  tx:        TransactionClient,
  invoice:   { id: string; invoiceNo: string; channelId: string; totalAmount: number | { toNumber(): number }; taxAmount: number | { toNumber(): number } },
  postedBy:  string
) {
  const totalAmount   = toNum(invoice.totalAmount)
  const taxAmount     = toNum(invoice.taxAmount)
  const revenueAmount = totalAmount - taxAmount

  const je = await tx.journalEntry.create({
    data: {
      description:   `Invoice ${invoice.invoiceNo}`,
      referenceId:   invoice.id,
      referenceType: 'INVOICE',
      channelId:     invoice.channelId,
      postedBy,
    },
  })

  const lines: any[] = [
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.ACCOUNTS_RECEIVABLE, debitAmount: totalAmount, creditAmount: 0 },
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.SALES_REVENUE,      debitAmount: 0,           creditAmount: revenueAmount },
  ]
  if (taxAmount > 0) {
    lines.push({ journalEntryId: je.id, accountId: ACCOUNT_IDS.TAX_PAYABLE, debitAmount: 0, creditAmount: taxAmount })
  }

  await tx.ledgerLine.createMany({ data: lines })
  return je
}

// ── INVOICE VOID (reversal of the entry above) ─────────────────────────
// DR: Sales Revenue + Tax Payable / CR: Accounts Receivable
// Only called for invoices that actually posted (type INVOICE, amountPaid = 0
// — voiding a paid invoice is blocked upstream in invoice.service.ts).
export async function buildInvoiceVoidJournalEntry(
  tx:        TransactionClient,
  invoice:   { id: string; invoiceNo: string; channelId: string; totalAmount: number | { toNumber(): number }; taxAmount: number | { toNumber(): number } },
  postedBy:  string
) {
  const totalAmount   = toNum(invoice.totalAmount)
  const taxAmount     = toNum(invoice.taxAmount)
  const revenueAmount = totalAmount - taxAmount

  const je = await tx.journalEntry.create({
    data: {
      description:   `Void invoice ${invoice.invoiceNo}`,
      referenceId:   invoice.id,
      referenceType: 'INVOICE',
      channelId:     invoice.channelId,
      postedBy,
    },
  })

  const lines: any[] = [
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.SALES_REVENUE,      debitAmount: revenueAmount, creditAmount: 0 },
    { journalEntryId: je.id, accountId: ACCOUNT_IDS.ACCOUNTS_RECEIVABLE, debitAmount: 0,             creditAmount: totalAmount },
  ]
  if (taxAmount > 0) {
    lines.push({ journalEntryId: je.id, accountId: ACCOUNT_IDS.TAX_PAYABLE, debitAmount: taxAmount, creditAmount: 0 })
  }

  await tx.ledgerLine.createMany({ data: lines })
  return je
}

// ── INVOICE PAYMENT ─────────────────────────────────────────────────────
// DR: Cash on Hand or Bank Account (by payment method) / CR: Accounts Receivable
const INVOICE_PAYMENT_DEBIT_ACCOUNT: Record<string, string> = {
  CASH:          ACCOUNT_IDS.CASH_ON_HAND,
  MOBILE_MONEY:  ACCOUNT_IDS.BANK_ACCOUNT,
  CARD:          ACCOUNT_IDS.BANK_ACCOUNT,
  BANK_TRANSFER: ACCOUNT_IDS.BANK_ACCOUNT,
}

export async function buildInvoicePaymentJournalEntry(
  tx:            TransactionClient,
  invoice:       { id: string; invoiceNo: string; channelId: string },
  amount:        number,
  paymentMethod: string,
  postedBy:      string
) {
  const debitAccountId = INVOICE_PAYMENT_DEBIT_ACCOUNT[paymentMethod] ?? ACCOUNT_IDS.CASH_ON_HAND

  const je = await tx.journalEntry.create({
    data: {
      description:   `Payment for invoice ${invoice.invoiceNo}`,
      referenceId:   invoice.id,
      referenceType: 'INVOICE_PAYMENT',
      channelId:     invoice.channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: debitAccountId,                     debitAmount: amount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.ACCOUNTS_RECEIVABLE,    debitAmount: 0,      creditAmount: amount },
    ],
  })

  return je
}

// ── CUSTOMER CREDIT REPAYMENT ────────────────────────────────────────────
// DR: Cash on Hand or Bank Account (by method) / CR: Accounts Receivable
//
// FIX: recordRepayment() previously only decremented Customer.outstandingCredit
// (a shadow field feeding the AR Aging report) and logged a CustomerPayment —
// it never touched the general ledger. The original credit sale had already
// debited Accounts Receivable via buildSaleJournalEntry; without this, AR on
// the Balance Sheet only ever grows and never clears when customers pay off
// what they owe, and the cash/bank actually collected is never recorded.
export async function buildCustomerRepaymentJournalEntry(
  tx:         TransactionClient,
  customerId: string,
  amount:     number,
  method:     string,
  channelId:  string,
  postedBy:   string
) {
  const debitAccountId = INVOICE_PAYMENT_DEBIT_ACCOUNT[method] ?? ACCOUNT_IDS.CASH_ON_HAND

  const je = await tx.journalEntry.create({
    data: {
      description:   `Credit repayment from customer ${customerId}`,
      referenceId:   customerId,
      referenceType: 'CUSTOMER_REPAYMENT',
      channelId,
      postedBy,
    },
  })

  await tx.ledgerLine.createMany({
    data: [
      { journalEntryId: je.id, accountId: debitAccountId,                  debitAmount: amount, creditAmount: 0 },
      { journalEntryId: je.id, accountId: ACCOUNT_IDS.ACCOUNTS_RECEIVABLE, debitAmount: 0,      creditAmount: amount },
    ],
  })

  return je
}
