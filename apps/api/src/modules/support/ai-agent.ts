// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/ai-agent.ts
// Fixes:
//   1. Phone number and email hardcoded in system prompt and error
//      message — PII in source code is a security risk (leaks in logs,
//      git history, error reports). Moved to environment variables.
//      Set SUPPORT_CONTACT_PHONE and SUPPORT_CONTACT_EMAIL in .env.
// ══════════════════════════════════════════════════════════════════════

import { searchKnowledge } from '../../lib/vector-store.js'
import { streamText }      from '../../lib/gemini-client.js'
import { logKBGap }        from './kb-gap-detector.js'
import { prisma }          from '../../lib/prisma.js'
import { Prisma }          from '@prisma/client'
import { diagnosticsService } from './diagnostics.service.js'

interface AgentContext {
  ticketId:       string
  subject:        string
  category:       string
  priority:       string
  actorUsername:  string
  actorRole:      string
  userMessage:    string
  actorChannelId?: string // Renamed for clarity as the authenticated channel
}

// FIX 1: Contact details from env — never hardcode PII in source code.
// Set SUPPORT_CONTACT_PHONE and SUPPORT_CONTACT_EMAIL in your .env file.
const SUPPORT_PHONE = process.env.SUPPORT_CONTACT_PHONE ?? 'the support team'
const SUPPORT_EMAIL = process.env.SUPPORT_CONTACT_EMAIL ?? ''

const ESCALATION_CONTACT =
  `- Contact: **${SUPPORT_PHONE}**` +
  (SUPPORT_EMAIL ? `\n- Email: **${SUPPORT_EMAIL}**` : '')

async function fetchGroundingData(userMessage: string, channelId?: string): Promise<string> {
  const data: string[] = []

  // Detect Receipt Numbers (e.g. RCP-20240321-0001)
  const receiptMatch = userMessage.match(/RCP-\d{8}-\d{4}/i)
  if (receiptMatch) {
    const sale = await prisma.sale.findFirst({
      where: { receiptNo: receiptMatch[0].toUpperCase(), ...(channelId && { channelId }) },
      include: { items: { include: { item: true } }, payments: true }
    })
    if (sale) {
      data.push(`[LIVE SALE DATA: ${sale.receiptNo}]
Status: ${sale.deletedAt ? 'VOIDED' : 'COMMITTED'}
Total: ${sale.totalAmount}, Net: ${sale.netAmount}
Items: ${sale.items.map(i => `${i.item.name} (Qty: ${i.quantity})`).join(', ')}
Payments: ${sale.payments.map(p => `${p.method}: ${p.amount}`).join(', ')}`)
    }
  }

  // Detect Item SKUs or Names
  const words = userMessage.split(/\s+/)
  for (const word of words) {
    if (word.length < 4) continue
    // FIX: Scope item discovery to only return items that exist in the user's channel via inventoryBalances
    const item = await prisma.item.findFirst({
      where: {
        deletedAt: null,
        AND: [
          {
            OR: [
              { sku: { contains: word, mode: 'insensitive' } },
              { name: { contains: word, mode: 'insensitive' } }
            ]
          },
          // Only "find" the item if it has a balance in this channel (unless Super Admin)
          ...(channelId ? [{ inventoryBalances: { some: { channelId } } }] : [])
        ]
      },
      include: { inventoryBalances: { where: { channelId } } }
    })
    
    if (item) {
      const balance = item.inventoryBalances[0]
      data.push(`[LIVE ITEM DATA: ${item.name} (${item.sku})]
Retail Price: ${balance?.retailPrice || item.retailPrice}
Current Stock: ${balance?.availableQty ?? 0}
Min Retail Price: ${balance?.minRetailPrice || item.minRetailPrice}`)
    }
  }

  // 7-day Sales Sparkline Data
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const salesSummary = await prisma.$queryRaw<any[]>`
    SELECT 
      TO_CHAR(s."createdAt", 'Mon DD') as "date", 
      SUM(s."totalAmount")::float as "amount"
    FROM sales s
    WHERE s."createdAt" >= ${sevenDaysAgo}
      AND s."deletedAt" IS NULL
      ${channelId ? Prisma.sql`AND s."channelId" = ${channelId}` : Prisma.empty}
    GROUP BY TO_CHAR(s."createdAt", 'Mon DD'), DATE_TRUNC('day', s."createdAt")
    ORDER BY DATE_TRUNC('day', s."createdAt") ASC
  `

  if (salesSummary.length > 0) {
    data.push(`[LIVE SALES SUMMARY - LAST 7 DAYS]
${salesSummary.map(s => `${s.date}: ${s.amount}`).join('\n')}`)
  }

  return data.join('\n\n')
}

async function fetchInternalDiagnostics(userMessage: string, channelId?: string): Promise<string> {
  // If user asks for diagnosis or health
  const keywords = ['diagnostic', 'diagnosis', 'health', 'integrity', 'check', 'status', 'broken']
  const needsDiagnosis = keywords.some(k => userMessage.toLowerCase().includes(k))

  if (!needsDiagnosis) return 'No proactive architectural health check requested.'

  const result = await diagnosticsService.runFullDiagnostic(channelId)

  return `[LIVE ARCHITECTURAL DIAGNOSTIC: ${result.status}]
Timestamp: ${result.timestamp}
1. Trial Balance Check: ${result.checks.ledgerBound.status} - ${result.checks.ledgerBound.message}
2. Inventory Integrity: ${result.checks.inventoryIntegrity.status} - ${result.checks.inventoryIntegrity.message}
3. Pending Approvals: ${result.checks.pendingApprovals.count} (Alert: ${result.checks.pendingApprovals.isAlert})
4. Latency Analysis: ${result.checks.systemPerformance.latencyMs}ms`
}

function buildSystemPrompt(ctx: AgentContext, knowledgeContext: string, groundingData: string, diagnostics: string): string {
  return `
## IDENTITY & GREETING
The user accessing you now is: **${ctx.actorUsername}**.
MANDATORY: YOU MUST BEGIN YOUR FIRST RESPONSE WITH: "Hello ${ctx.actorUsername}!" 
System Name: LUX SYSTEMS ARCHITECT
Role: Lead AI Operations Core for LUX POS.

## OPERATIONAL PHILOSOPHY
You are definitive, helpful, and technically advanced. You don't just answer questions; you provide actionable intelligence.
If the request is a simple greeting (like "hello"), greet them by name and ask how you can help.

## TONE
Professional, precise, and confident. You prioritize clarity and resolution. 
You MUST NOT be generic. You are talking to **${ctx.actorUsername}**.

## CORE MODULES INTELLIGENCE
- **POS:** Scanning, Voids, Loyalty, Credit Sales, Session Closure.
- **Inventory:** WAC calculation, Serial tracking, Stock Takes, Reorder levels.
- **Accounting:** Double-entry ledger, Chart of Accounts, Journaling.
- **Support:** Ticket management, Escalation, AI-driven diagnostics.

## OUTPUT FORMAT
Structure every non-trivial response as:
**⚠️ DIAGNOSIS** — what is wrong and why (from a technical and operational perspective)
**✅ RESOLUTION** — exact steps to execute, numbered clearly
**🔍 VERIFICATION** — how to confirm the issue is resolved or where to check the logs

## MANDATORY DIRECTIVES
- You **MUST** use the \`\`\`chart\`\`\` block whenever the user asks for trends, breakdowns, or performance visualization.
- Do **NOT** tell the user to "navigate" to a hub if you have the data available in the **SYSTEM DATA GROUNDING** section below. Generate the chart yourself.
- Use the **ARCHITECTURAL HEALTH DIAGNOSTICS** data to generate bar charts of system health when asked for "diagnostics" or "health charts".

## DIAGNOSTIC OPERATIONS
When user asks for a health check or diagnosis, use the **ARCHITECTURAL HEALTH DIAGNOSTICS** section provided below. 
- If Trial Balance is FAIL: Report it as a critical financial reconciliation hazard.
- If Inventory Integrity is FAIL: Report it as a data desynchronization between stock levels and ledger registers.
- Always include the **⚠️ DIAGNOSIS** / **✅ RESOLUTION** / **🔍 VERIFICATION** format.

## VISUALIZATION CAPABILITY
You can generate charts and graphs to visualize system performance or sales trends.
When requested, output a JSON block wrapped in \`\`\`chart ... \`\`\`.
Format example:
\`\`\`chart
{
  "type": "area",
  "title": "Sales Trend (Last 7 Days)",
  "data": [
    { "name": "Mon", "value": 45000 },
    { "name": "Tue", "value": 52000 }
  ]
}
\`\`\`
Supported types: "bar", "area", "line", "pie".

## HUMAN ESCALATION
If the user specifically asks for a human agent or expresses extreme frustration, emphasize that a human has been notified and provide this contact for urgent follow-up:
${ESCALATION_CONTACT}
- Note: Response time target is within 5 minutes.

## KNOWLEDGE CONTEXT
${knowledgeContext || 'Architectural baseline: Standard LUX POS operations.'}

## SYSTEM DATA GROUNDING
${groundingData || 'No specific system records (Receipts/Items) were detected for live lookup.'}

## ARCHITECTURAL HEALTH DIAGNOSTICS
${diagnostics}
`
}

export async function runSupportAgent(
  ctx:     AgentContext,
  onToken: (chunk: string) => void
): Promise<string> {
  const knowledge = await searchKnowledge(ctx.userMessage)
  
  // Real-time grounding for items/sales mentioned in message
  let channelId = ctx.actorChannelId
  if (!channelId && ctx.ticketId !== 'STANDALONE') {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ctx.ticketId }, select: { channelId: true } })
    channelId = ticket?.channelId || undefined
  }

  const groundingData = await fetchGroundingData(ctx.userMessage, channelId)
  const diagnosticsData = await fetchInternalDiagnostics(ctx.userMessage, channelId)

  if (knowledge.length === 0) {
    await logKBGap(ctx.userMessage, ctx.ticketId, 'LOW_SIMILARITY')
  }

  const knowledgeCtx = knowledge.map(k => k.content).join('\n\n')
  const systemPrompt = buildSystemPrompt(ctx, knowledgeCtx, groundingData, diagnosticsData)

  console.log(`[BRAYN-AI] PROMPT_SYNC: [Actor: ${ctx.actorUsername}] [KB_Chunks: ${knowledge.length}]`);
  
  const identityDirective = `[PRIMARY_DIRECTIVE: You are chatting with ${ctx.actorUsername}. START WITH "Hello ${ctx.actorUsername}!" AND NOTHING ELSE.]`;
  const directedMessage = `${identityDirective}\n\n${ctx.userMessage}`;

  let fullReply = ''

  try {
    for await (const chunk of streamText(directedMessage, systemPrompt)) {
      fullReply += chunk
      onToken(chunk)
    }
  } catch (err: any) {
    // Log structured error without leaking PII to stdout
    const errorMsg = err?.message ?? 'Unknown error'
    console.error('[AI-Agent] Gemini reasoning failed:', { message: errorMsg })

    // FIX 1: Contact details from env, not hardcoded
    return `⚠️ **LUX CORE ERROR:** Gemini reasoning module encountered an error. ` +
      `Retrying via human agent... If not attended to in 5 minutes, please contact ` +
      `**${SUPPORT_PHONE}**` + (SUPPORT_EMAIL ? ` or email **${SUPPORT_EMAIL}**` : '') + `.`
  }

  return fullReply
}
