import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'

// FIX 1: Safe date parser that avoids midnight UTC timezone ambiguity
function parseStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}
function parseEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`)
}

export class LedgerService {
  async getJournalEntries(query: {
    channelId?:      string
    referenceType?:  string
    startDate?:      string
    endDate?:        string
    page?:           number
    limit?:          number
  }) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 25
    const skip  = (page - 1) * limit

    const where: Prisma.JournalEntryWhereInput = {
      ...(query.channelId     && { channelId:     query.channelId }),
      ...(query.referenceType && { referenceType: query.referenceType as Prisma.EnumJournalRefTypeFilter }),
      ...(query.startDate || query.endDate ? {
        postedAt: {
          ...(query.startDate && { gte: parseStart(query.startDate) }),
          ...(query.endDate   && { lte: parseEnd(query.endDate) }),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where, skip, take: limit,
        orderBy: { postedAt: 'desc' },
        include: {
          lines: {
            include: {
              account: { select: { id: true, code: true, name: true, type: true } },
            },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async getJournalEntry(id: string, channelId?: string) {
    const entry = await prisma.journalEntry.findFirst({
      where:   { id, ...(channelId && { channelId }) },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
        },
      },
    })
    if (!entry) throw { statusCode: 404, message: 'Journal entry not found' }
    return entry
  }

  async getTrialBalance(asOfDate?: string, channelId?: string) {
    // FIX 1: Use end-of-day UTC for the as-of date
    const dateFilter    = asOfDate ? parseEnd(asOfDate) : new Date()
    const channelFilter = channelId
      ? Prisma.sql`AND je."channelId" = ${channelId}`
      : Prisma.sql``

    const rows = await prisma.$queryRaw<Array<{
      accountId:   string
      accountCode: string
      accountName: string
      accountType: string
      totalDebit:  Prisma.Decimal
      totalCredit: Prisma.Decimal
    }>>`
      SELECT
        a.id                                  AS "accountId",
        a.code                                AS "accountCode",
        a.name                                AS "accountName",
        a.type                                AS "accountType",
        COALESCE(SUM(ll."debitAmount"),  0)   AS "totalDebit",
        COALESCE(SUM(ll."creditAmount"), 0)   AS "totalCredit"
      FROM accounts a
      JOIN ledger_lines ll    ON ll."accountId" = a.id
      JOIN journal_entries je ON je.id          = ll."journalEntryId"
      WHERE a."isActive" = true
        AND je."postedAt" <= ${dateFilter}
        ${channelFilter}
      GROUP BY a.id, a.code, a.name, a.type
      HAVING
        COALESCE(SUM(ll."debitAmount"),  0) > 0
        OR COALESCE(SUM(ll."creditAmount"), 0) > 0
      ORDER BY a.code
    `

    const totalDebit  = rows.reduce((s, r) => s + Number(r.totalDebit),  0)
    const totalCredit = rows.reduce((s, r) => s + Number(r.totalCredit), 0)

    return {
      rows: rows.map(r => ({
        accountId:   r.accountId,
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountType: r.accountType,
        totalDebit:  Number(r.totalDebit),
        totalCredit: Number(r.totalCredit),
        balance:     Number(r.totalDebit) - Number(r.totalCredit),
      })),
      totalDebit,
      totalCredit,
      variance: totalDebit - totalCredit,
      asOf:     dateFilter.toISOString(),
    }
  }

  // FIX 2: channelId now scopes through journal entry join
  async getAccountLedger(accountId: string, query: {
    startDate?:  string
    endDate?:    string
    channelId?:  string
    page?:       number
    limit?:      number
  }) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 50
    const skip  = (page - 1) * limit

    const where: Prisma.LedgerLineWhereInput = {
      accountId,
      ...(query.startDate || query.endDate || query.channelId ? {
        journalEntry: {
          ...(query.channelId && { channelId: query.channelId }),
          ...(query.startDate || query.endDate ? {
            postedAt: {
              ...(query.startDate && { gte: parseStart(query.startDate) }),
              ...(query.endDate   && { lte: parseEnd(query.endDate) }),
            },
          } : {}),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.ledgerLine.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          journalEntry: {
            select: { id: true, description: true, referenceId: true, referenceType: true, postedAt: true },
          },
        },
      }),
      prisma.ledgerLine.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async getProfitLoss(startDate: string, endDate: string, channelId?: string) {
    // FIX 1: Full-day UTC boundaries
    const start         = parseStart(startDate)
    const end           = parseEnd(endDate)
    const channelFilter = channelId
      ? Prisma.sql`AND je."channelId" = ${channelId}`
      : Prisma.sql``

    const rows = await prisma.$queryRaw<Array<{
      accountId:   string
      accountCode: string
      accountName: string
      accountType: string
      amount:      Prisma.Decimal
    }>>`
      SELECT
        a.id   AS "accountId",
        a.code AS "accountCode",
        a.name AS "accountName",
        a.type AS "accountType",
        CASE
          WHEN a.type = 'REVENUE'
            THEN COALESCE(SUM(ll."creditAmount") - SUM(ll."debitAmount"), 0)
          WHEN a.type = 'EXPENSE'
            THEN COALESCE(SUM(ll."debitAmount") - SUM(ll."creditAmount"), 0)
          ELSE 0
        END AS amount
      FROM accounts a
      JOIN ledger_lines ll    ON ll."accountId"      = a.id
      JOIN journal_entries je ON je.id               = ll."journalEntryId"
      WHERE a.type IN ('REVENUE', 'EXPENSE')
        AND je."postedAt" >= ${start}
        AND je."postedAt" <= ${end}
        ${channelFilter}
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.type, a.code
    `

    const revenue  = rows.filter(r => r.accountType === 'REVENUE').map(r => ({
      accountId: r.accountId, accountCode: r.accountCode, accountName: r.accountName,
      amount: Number(r.amount),
    }))
    const expenses = rows.filter(r => r.accountType === 'EXPENSE').map(r => ({
      accountId: r.accountId, accountCode: r.accountCode, accountName: r.accountName,
      amount: Number(r.amount),
    }))

    const totalRevenue  = revenue.reduce((s, r) => s + r.amount, 0)
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0)

    return { revenue, totalRevenue, expenses, totalExpenses, netProfit: totalRevenue - totalExpenses, startDate, endDate }
  }

  async getBalanceSheet(asOfDate?: string, channelId?: string) {
    // FIX 1: End-of-day UTC boundary
    const dateFilter    = asOfDate ? parseEnd(asOfDate) : new Date()
    const channelFilter = channelId
      ? Prisma.sql`AND je."channelId" = ${channelId}`
      : Prisma.sql``

    const rows = await prisma.$queryRaw<Array<{
      accountId:   string
      accountCode: string
      accountName: string
      accountType: string
      balance:     Prisma.Decimal
    }>>`
      SELECT
        a.id   AS "accountId",
        a.code AS "accountCode",
        a.name AS "accountName",
        a.type AS "accountType",
        CASE
          WHEN a.type IN ('ASSET')
            THEN COALESCE(SUM(ll."debitAmount") - SUM(ll."creditAmount"), 0)
          WHEN a.type IN ('LIABILITY', 'EQUITY')
            THEN COALESCE(SUM(ll."creditAmount") - SUM(ll."debitAmount"), 0)
          ELSE 0
        END AS balance
      FROM accounts a
      JOIN ledger_lines ll    ON ll."accountId" = a.id
      JOIN journal_entries je ON je.id          = ll."journalEntryId"
      WHERE a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND a."isActive" = true
        AND je."postedAt" <= ${dateFilter}
        ${channelFilter}
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.type, a.code
    `

    const mapRow = (r: (typeof rows)[number]) => ({
      accountId:   r.accountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      balance:     Number(r.balance),
    })

    const assets      = rows.filter(r => r.accountType === 'ASSET').map(mapRow)
    const liabilities = rows.filter(r => r.accountType === 'LIABILITY').map(mapRow)
    const equity      = rows.filter(r => r.accountType === 'EQUITY').map(mapRow)

    const totalAssets      = assets.reduce((s, a) => s + a.balance, 0)
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0)
    
    // Calculate Cumulative Net Income (Revenue - Expenses) to date for Equity
    const netIncomeRows = await prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>`
      SELECT 
        COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN ll."creditAmount" - ll."debitAmount" ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN ll."debitAmount" - ll."creditAmount" ELSE 0 END), 0) AS net
      FROM accounts a
      JOIN ledger_lines ll    ON ll."accountId" = a.id
      JOIN journal_entries je ON je.id          = ll."journalEntryId"
      WHERE a.type IN ('REVENUE', 'EXPENSE')
        AND je."postedAt" <= ${dateFilter}
        ${channelFilter}
    `
    const netIncome = Number(netIncomeRows[0]?.net || 0)
    
    // Add Net Income to Equity section if not already zero
    if (netIncome !== 0) {
      equity.push({
        accountId:   'net-income-period',
        accountCode: 'NET',
        accountName: 'Current Period Profit/Loss',
        balance:     netIncome,
      })
    }

    const totalEquity      = equity.reduce((s, e) => s + e.balance, 0)

    // FIX 3: Balance sheet assertion — Assets must equal Liabilities + Equity
    const imbalance   = totalAssets - (totalLiabilities + totalEquity)
    const isBalanced  = Math.abs(imbalance) < 0.01  // allow 1 cent rounding tolerance

    return {
      assets,      totalAssets,
      liabilities, totalLiabilities,
      equity,      totalEquity,
      isBalanced,
      imbalance,
      asOf: dateFilter.toISOString(),
    }
  }
}

export const ledgerService = new LedgerService()
