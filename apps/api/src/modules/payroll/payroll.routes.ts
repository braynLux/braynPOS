import type { FastifyPluginAsync } from 'fastify'
import { payslipService }        from './payslip.service.js'
import { calculateNetSalary }    from './payroll-calculator.service.js'
import { prisma }                from '../../lib/prisma.js'
import { authenticate }          from '../../middleware/authenticate.js'
import { authorize }             from '../../middleware/authorize.js'
import { z }                     from 'zod'
import { logAction, AUDIT }      from '../../lib/audit.js'

export const payrollRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'))

  // POST /payroll/salary-runs/cleanup
  app.post('/salary-runs/cleanup', async () => {
    return payslipService.autoDeleteOldDrafts()
  })

  // POST /payroll/calculate-preview
  app.post('/calculate-preview', async (request) => {
    const { staffProfileId, runDate } = z.object({
      staffProfileId: z.string().uuid(),
      runDate:        z.string().optional(),
    }).parse(request.body)
    return calculateNetSalary(staffProfileId, runDate ? new Date(runDate) : undefined)
  })

  // POST /payroll/salary-runs
  app.post('/salary-runs', async (request, reply) => {
    const body = z.object({
      month:     z.number().int().min(1).max(12),
      year:      z.number().int().min(2020).max(2100),
      channelId: z.string().uuid().optional(),
    }).parse(request.body)

    const channelId = body.channelId || request.user.channelId
    if (!channelId) {
      throw { statusCode: 400, message: 'channelId is required to create a salary run' }
    }

    const run = await payslipService.createSalaryRun(body.month, body.year, request.user.sub, channelId)
    reply.status(201).send(run)
  })

  // POST /payroll/salary-runs/:id/finalize
  app.post('/salary-runs/:id/finalize', async (request) => {
    const { id } = request.params as { id: string }
    return payslipService.finalizeSalaryRun(id, request.user.sub, request.user.role)
  })

  // GET /payroll/salary-runs
  app.get('/salary-runs', async (request) => {
    const q = z.object({
      page:  z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)
    return payslipService.listSalaryRuns(q.page, q.limit)
  })

  // GET /payroll/salary-runs/:id
  app.get('/salary-runs/:id', async (request) => {
    const { id } = request.params as { id: string }
    return payslipService.getSalaryRun(id)
  })

  // GET /payroll/payslip
  app.get('/payslip', async (request) => {
    const q = z.object({
      staffProfileId: z.string().uuid(),
      month:          z.coerce.number().int().min(1).max(12),
      year:           z.coerce.number().int().min(2020).max(2100),
    }).parse(request.query)
    return payslipService.getPayslip(q.staffProfileId, q.month, q.year)
  })

  // DELETE /payroll/salary-runs/:id
  app.delete('/salary-runs/:id', async (request) => {
    const { id }       = request.params as { id: string }
    const { password } = z.object({ password: z.string() }).parse(request.body)

    const result = await payslipService.deleteSalaryRun(id, request.user.sub, password, request.user.role)

    logAction({
      action:    AUDIT.PAYROLL_RUN_DELETE,
      actorId:   request.user.sub,
      actorRole: request.user.role,
      targetType: 'salary_run',
      targetId:   id,
    })

    return result
  })

  // POST /payroll/salary-runs/:id/reverse
  app.post('/salary-runs/:id/reverse', async (request) => {
    const { id }       = request.params as { id: string }
    const { password } = z.object({ password: z.string() }).parse(request.body)

    const result = await payslipService.reverseSalaryRun(id, request.user.sub, password, request.user.role)

    logAction({
      action:    AUDIT.PAYROLL_RUN_REVERSE,
      actorId:   request.user.sub,
      actorRole: request.user.role,
      targetType: 'salary_run',
      targetId:   id,
    })

    return result
  })

  // PATCH /payroll/salary-runs/line/:id
  // FIX: Manual deduction override now writes an audit log entry.
  // Previously any SUPER_ADMIN or MANAGER_ADMIN could zero out deductions
  // on any payslip silently — no trail, no reason required.
  app.patch('/salary-runs/line/:id', async (request) => {
    const { id }              = request.params as { id: string }
    const { deductionsTotal, reason } = z.object({
      deductionsTotal: z.number().min(0),
      // FIX: Require a reason so overrides are explainable in audit queries
      reason:          z.string().min(5, 'Please provide a reason for the deduction adjustment'),
    }).parse(request.body)

    const result = await payslipService.updateSalaryRunLine(id, deductionsTotal)

    logAction({
      action:    AUDIT.PAYROLL_ACCESS,
      actorId:   request.user.sub,
      actorRole: request.user.role,
      targetType: 'salary_run_line',
      targetId:   id,
      newValues: { deductionsTotal, reason },
    })

    return result
  })

  // GET /payroll/rules/deductions
  app.get('/rules/deductions', async (request) => {
    return prisma.deductionRule.findMany({
      where:   { channelId: request.user.channelId ?? null, isActive: true },
      include: { brackets: true },
      orderBy: { calculationSequence: 'asc' },
    })
  })

  // POST /payroll/rules/deductions
  app.post('/rules/deductions', async (request, reply) => {
    const body = z.object({
      name:                z.string(),
      type:                z.enum(['FIXED_AMOUNT', 'PERCENTAGE_OF_GROSS', 'BRACKET_TABLE', 'PERCENTAGE_OF_TAXABLE']),
      rate:                z.number().optional().nullable(),
      isPreTaxDeduction:   z.boolean().default(false),
      minimumFloorAmount:  z.number().optional().nullable(),
      maximumCapAmount:    z.number().optional().nullable(),
      calculationSequence: z.number().default(100),
      isEmployerContribution: z.boolean().default(false),
      brackets:            z.array(z.object({
        incomeFrom:     z.number(),
        incomeTo:       z.number().optional().nullable(),
        ratePercentage: z.number(),
        fixedDeduction: z.number().default(0),
      })).optional(),
    }).parse(request.body)

    const result = await prisma.deductionRule.create({
      data: {
        ...body,
        channelId: request.user.channelId ?? null,
        brackets:  body.brackets ? { createMany: { data: body.brackets } } : undefined,
      } as any,
    })
    reply.status(201).send(result)
  })

  // DELETE /payroll/rules/deductions/:id
  app.delete('/rules/deductions/:id', async (request) => {
    const { id } = request.params as { id: string }
    await prisma.deductionRule.update({
      where: { id },
      data:  { isActive: false },
    })
    return { message: 'Deduction rule deactivated' }
  })

  // GET /payroll/rules/allowances
  app.get('/rules/allowances', async (request) => {
    return prisma.allowanceRule.findMany({
      where:   { channelId: request.user.channelId ?? null, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
  })

  // POST /payroll/rules/allowances
  app.post('/rules/allowances', async (request, reply) => {
    const body = z.object({
      name:   z.string(),
      type:   z.enum(['FIXED_AMOUNT', 'PERCENTAGE_OF_GROSS', 'BRACKET_TABLE', 'PERCENTAGE_OF_TAXABLE']),
      amount: z.number(),
    }).parse(request.body)

    const result = await prisma.allowanceRule.create({
      data: {
        ...body,
        channelId: request.user.channelId ?? null,
      } as any,
    })
    reply.status(201).send(result)
  })

  // DELETE /payroll/rules/allowances/:id
  app.delete('/rules/allowances/:id', async (request) => {
    const { id } = request.params as { id: string }
    await prisma.allowanceRule.update({
      where: { id },
      data:  { isActive: false },
    })
    return { message: 'Allowance rule deactivated' }
  })

  // GET /payroll/rules/job-levels
  app.get('/rules/job-levels', async (request) => {
    return prisma.jobLevel.findMany({
      where:   { channelId: request.user.channelId ?? null, isActive: true },
      orderBy: { basicSalary: 'desc' },
    })
  })

  // POST /payroll/rules/job-levels
  app.post('/rules/job-levels', async (request, reply) => {
    const body = z.object({
      name:                z.string().min(1),
      basicSalary:         z.number().min(0),
      overtimeRatePerHour: z.number().min(0).default(0),
    }).parse(request.body)

    const result = await prisma.jobLevel.create({
      data: {
        ...body,
        channelId: request.user.channelId ?? null,
      },
    })
    reply.status(201).send(result)
  })

  // DELETE /payroll/rules/job-levels/:id
  app.delete('/rules/job-levels/:id', async (request) => {
    const { id } = request.params as { id: string }
    await prisma.jobLevel.update({
      where: { id },
      data:  { isActive: false },
    })
    return { message: 'Job level deactivated' }
  })
}
