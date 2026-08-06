import type { FastifyPluginAsync } from 'fastify'
import { reportsService } from './reports.service.js'
import { authenticate }   from '../../middleware/authenticate.js'
import { authorize }      from '../../middleware/authorize.js'
import { RATE }           from '../../lib/rate-limit.plugin.js'
import { z }              from 'zod'

// Shared date range schema — validates ISO dates or YYYY-MM-DD at the route
// layer so malformed strings get a clean 400 before reaching the service.
// FIX 12: Better date validation regex
const dateRangeSchema = z.object({
  channelId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'startDate must be YYYY-MM-DD'),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'endDate must be YYYY-MM-DD'),
})

// Helper — resolves the effective channelId and validates it's present
// for admin roles who must specify one explicitly.
// FIX 4: Replaces `cid!` non-null assertion which passed undefined to raw
// SQL when a MANAGER had no channelId, silently returning empty results.
function resolveChannelId(
  role:      string,
  channelId: string | null | undefined,
  queryCid:  string | undefined
): string {
  const isGlobalRole = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(role)

  if (!isGlobalRole) {
    if (!channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return channelId
  }

  const effectiveCid = queryCid || channelId
  if (!effectiveCid) {
    throw { statusCode: 400, message: 'channelId is required for admin reports (specify a branch)' }
  }
  return effectiveCid
}

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // FIX 9: Added ADMIN to authorize() — it was in the channel scoping check
  // but blocked at this hook, making that branch permanently dead code.
  app.addHook('preHandler', authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER'))

  // GET /reports/sales-summary
  app.get('/sales-summary', { config: RATE.READ }, async (request) => {
    const q   = dateRangeSchema.parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.salesSummary(cid, q.startDate, q.endDate)
  })

  // GET /reports/top-selling
  app.get('/top-selling', { config: RATE.READ }, async (request) => {
    const q = z.object({
      channelId: z.string().uuid().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}/),
      limit:     z.coerce.number().min(1).max(50).optional(),
    }).parse(request.query)

    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.topSellingItems(cid, q.startDate, q.endDate, q.limit)
  })

  // GET /reports/stock-flow
  app.get('/stock-flow', { config: RATE.READ }, async (request) => {
    const q   = dateRangeSchema.parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.stockFlowReport(cid, q.startDate, q.endDate)
  })

  // GET /reports/daily-trend
  app.get('/daily-trend', { config: RATE.READ }, async (request) => {
    const q   = dateRangeSchema.parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.dailySalesTrend(cid, q.startDate, q.endDate)
  })

  // GET /reports/staff-performance
  app.get('/staff-performance', { config: RATE.READ }, async (request) => {
    const q   = dateRangeSchema.parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.staffSalesPerformance(cid, q.startDate, q.endDate)
  })

  // GET /reports/admin-dashboard — HQ only
  app.get('/admin-dashboard', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const q = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    }).parse(request.query)
    return reportsService.adminDashboardAnalytics(q.startDate, q.endDate)
  })

  // GET /reports/sales-forecast
  app.get('/sales-forecast', { config: RATE.READ }, async (request) => {
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.salesForecast(cid)
  })

  // GET /reports/forensic-audit
  // Audit finding: The "Loss-Leader" Audit Report
  app.get('/forensic-audit', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const q   = dateRangeSchema.parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.getForensicMarginAudit(cid, q.startDate, q.endDate)
  })

  // GET /reports/aging-analysis
  app.get('/aging-analysis', { config: RATE.READ }, async (request) => {
    const q   = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.agingAnalysis(cid)
  })

  // GET /reports/dow-trends
  app.get('/dow-trends', { config: RATE.READ }, async (request) => {
    const q   = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const cid = resolveChannelId(request.user.role, request.user.channelId, q.channelId)
    return reportsService.dayOfWeekTrends(cid)
  })
}
