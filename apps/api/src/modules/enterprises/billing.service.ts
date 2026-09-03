import { basePrisma as prisma } from '../../lib/prisma.js'
import dayjs from 'dayjs'

export interface RecordPaymentInput {
  amount: number
  currency?: string
  paymentMethod: 'MPESA' | 'BANK_TRANSFER' | 'CARD' | 'CASH'
  reference: string
  periodMonths?: number
  notes?: string
}

export interface StartSoftwareInput {
  periodMonths?: number
  amount?: number
  currency?: string
  paymentMethod?: 'MPESA' | 'BANK_TRANSFER' | 'CARD' | 'CASH'
  reference?: string
  notes?: string
}

export class BillingService {
  /**
   * Record a subscription payment and extend/activate the enterprise subscription.
   */
  static async recordPayment(enterpriseId: string, input: RecordPaymentInput, recordedBy: string) {
    const enterprise = await prisma.enterprise.findUnique({
      where: { id: enterpriseId },
    })
    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }

    const months = input.periodMonths && input.periodMonths > 0 ? input.periodMonths : 1
    const now = new Date()

    // If current subscription is active and in the future, extend from currentPeriodEnd.
    // Otherwise start from today.
    let periodStart = now
    if (enterprise.currentPeriodEnd && new Date(enterprise.currentPeriodEnd) > now) {
      periodStart = new Date(enterprise.currentPeriodEnd)
    }

    const periodEnd = dayjs(periodStart).add(months, 'month').toDate()

    const result = await prisma.$transaction(async (tx) => {
      // 1. Log payment receipt
      const payment = await tx.subscriptionPayment.create({
        data: {
          enterpriseId,
          amount:        input.amount,
          currency:      input.currency || 'KES',
          paymentMethod: input.paymentMethod,
          reference:     input.reference.trim(),
          periodMonths:  months,
          periodStart,
          periodEnd,
          notes:         input.notes || null,
          recordedBy,
        },
      })

      // 2. Update enterprise subscription status
      const updatedEnterprise = await tx.enterprise.update({
        where: { id: enterpriseId },
        data: {
          billingStatus:      'ACTIVE',
          currentPeriodStart: periodStart,
          currentPeriodEnd:   periodEnd,
          isActive:           true,
        },
      })

      // 3. Dispatch system notification for Tenant Super Admin
      await tx.systemNotification.create({
        data: {
          enterpriseId,
          type:     'PAYMENT_RECEIVED',
          title:    'Subscription Payment Confirmed',
          message:  `Payment of ${input.currency || 'KES'} ${input.amount.toLocaleString()} received via ${input.paymentMethod}. Next renewal due on ${dayjs(periodEnd).format('DD MMM YYYY')}.`,
          severity: 'SUCCESS',
          metadata: { paymentId: payment.id, reference: input.reference, periodEnd },
        },
      })

      // 4. Dispatch system notification for Platform Owner
      await tx.systemNotification.create({
        data: {
          enterpriseId: null, // Global platform notification
          type:     'PAYMENT_RECEIVED',
          title:    `Payment Logged for ${enterprise.name}`,
          message:  `Recorded ${input.currency || 'KES'} ${input.amount.toLocaleString()} for ${enterprise.name} (${months} month${months > 1 ? 's' : ''}). New due date: ${dayjs(periodEnd).format('DD MMM YYYY')}.`,
          severity: 'SUCCESS',
          metadata: { enterpriseId, paymentId: payment.id, reference: input.reference },
        },
      })

      return { payment, enterprise: updatedEnterprise }
    })

    return {
      message: `Payment of ${input.currency || 'KES'} ${input.amount} recorded. Subscription active until ${dayjs(result.enterprise.currentPeriodEnd).format('DD MMM YYYY')}.`,
      payment: result.payment,
      enterprise: {
        id:                 result.enterprise.id,
        name:               result.enterprise.name,
        billingStatus:      result.enterprise.billingStatus,
        currentPeriodStart: result.enterprise.currentPeriodStart,
        currentPeriodEnd:   result.enterprise.currentPeriodEnd,
      },
    }
  }

  /**
   * Start official paid software subscription for an enterprise (converting trial or expired).
   */
  static async startSoftware(enterpriseId: string, input: StartSoftwareInput, recordedBy: string) {
    const months = input.periodMonths || 1
    const amount = input.amount || 0
    const reference = input.reference || `ACT-${Date.now().toString().slice(-6)}`
    const paymentMethod = input.paymentMethod || 'BANK_TRANSFER'

    return this.recordPayment(
      enterpriseId,
      {
        amount,
        currency: input.currency || 'KES',
        paymentMethod,
        reference,
        periodMonths: months,
        notes: input.notes || 'Official Software Subscription Activated',
      },
      recordedBy
    )
  }

  /**
   * Extend free trial for an enterprise by X days.
   */
  static async adjustTrial(
    enterpriseId: string,
    payload: { days?: number; newEndDate?: string; mode?: 'SET_DAYS' | 'ADD_DAYS' | 'SET_DATE' | 'EXPIRE_NOW' },
    recordedBy: string
  ) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id: enterpriseId } })
    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }

    const mode = payload.mode || 'ADD_DAYS'
    const now = new Date()
    let newTrialEnd: Date
    let newBillingStatus = 'TRIAL'
    let isEnterpriseActive = true
    let notificationTitle = 'Free Trial Adjusted'
    let notificationMessage = ''

    if (mode === 'EXPIRE_NOW') {
      newTrialEnd = now
      newBillingStatus = 'EXPIRED'
      notificationTitle = 'Free Trial Concluded'
      notificationMessage = `Your free trial for ${enterprise.name} has concluded. Please contact the platform admin to activate your official software subscription.`
    } else if (mode === 'SET_DATE') {
      if (!payload.newEndDate) {
        throw { statusCode: 400, message: 'newEndDate is required for SET_DATE mode' }
      }
      newTrialEnd = new Date(payload.newEndDate)
      if (isNaN(newTrialEnd.getTime())) {
        throw { statusCode: 400, message: 'Invalid newEndDate format' }
      }
      if (newTrialEnd <= now) {
        newBillingStatus = 'EXPIRED'
        notificationTitle = 'Free Trial Concluded'
        notificationMessage = `Your free trial has ended as of ${dayjs(newTrialEnd).format('DD MMM YYYY')}.`
      } else {
        notificationMessage = `Your free trial has been set to conclude on ${dayjs(newTrialEnd).format('DD MMM YYYY')}.`
      }
    } else if (mode === 'SET_DAYS') {
      const days = payload.days !== undefined ? payload.days : 14
      if (days <= 0) {
        newTrialEnd = now
        newBillingStatus = 'EXPIRED'
        notificationTitle = 'Free Trial Concluded'
        notificationMessage = `Your free trial has concluded.`
      } else {
        newTrialEnd = dayjs(now).add(days, 'day').toDate()
        notificationMessage = `Your free trial duration has been set to ${days} days (valid until ${dayjs(newTrialEnd).format('DD MMM YYYY')}).`
      }
    } else {
      // ADD_DAYS (default)
      const days = payload.days !== undefined ? payload.days : 14
      const baseDate = enterprise.trialEndsAt && new Date(enterprise.trialEndsAt) > now
        ? new Date(enterprise.trialEndsAt)
        : now
      newTrialEnd = dayjs(baseDate).add(days, 'day').toDate()
      notificationTitle = 'Free Trial Extended'
      notificationMessage = `Your free trial has been extended by ${days} days until ${dayjs(newTrialEnd).format('DD MMM YYYY')}.`
    }

    const updated = await prisma.enterprise.update({
      where: { id: enterpriseId },
      data: {
        billingStatus: newBillingStatus,
        trialEndsAt:   newTrialEnd,
        isActive:      isEnterpriseActive,
      },
    })

    await prisma.systemNotification.create({
      data: {
        enterpriseId,
        type:     'SYSTEM',
        title:    notificationTitle,
        message:  notificationMessage,
        severity: newBillingStatus === 'EXPIRED' ? 'WARNING' : 'INFO',
        metadata: { newTrialEnd, mode, adjustedBy: recordedBy },
      },
    }).catch(() => {})

    return {
      message:       notificationMessage,
      enterprise:    updated,
      newTrialEnd,
      billingStatus: newBillingStatus,
      daysRemaining: Math.max(0, dayjs(newTrialEnd).diff(dayjs(now), 'day')),
    }
  }

  static async extendTrial(enterpriseId: string, days: number, recordedBy: string) {
    return this.adjustTrial(enterpriseId, { days, mode: 'ADD_DAYS' }, recordedBy)
  }

  /**
   * Get billing details, due date, and payment history for a specific enterprise.
   */
  static async getEnterpriseBilling(enterpriseId: string) {
    const enterprise = await prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    })

    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }

    const now = new Date()
    let daysRemaining = 0

    if (enterprise.billingStatus === 'TRIAL' && enterprise.trialEndsAt) {
      daysRemaining = Math.max(0, dayjs(enterprise.trialEndsAt).diff(dayjs(now), 'day'))
    } else if (enterprise.currentPeriodEnd) {
      daysRemaining = dayjs(enterprise.currentPeriodEnd).diff(dayjs(now), 'day')
    }

    return {
      enterpriseId:       enterprise.id,
      name:               enterprise.name,
      plan:               enterprise.plan,
      billingStatus:      enterprise.billingStatus,
      trialEndsAt:        enterprise.trialEndsAt,
      currentPeriodStart: enterprise.currentPeriodStart,
      currentPeriodEnd:   enterprise.currentPeriodEnd,
      daysRemaining,
      subscriptionPrice:  enterprise.subscriptionPrice,
      billingCycle:       enterprise.billingCycle,
      payments:           enterprise.payments,
    }
  }

  /**
   * Get platform-wide SaaS billing overview (Platform Owner only).
   */
  static async getBillingSummary() {
    const now = new Date()
    const in7Days = dayjs(now).add(7, 'day').toDate()
    const in14Days = dayjs(now).add(14, 'day').toDate()

    const [
      allEnterprises,
      totalPayments,
      recentPayments,
    ] = await Promise.all([
      prisma.enterprise.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          billingStatus: true,
          trialEndsAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          subscriptionPrice: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.subscriptionPayment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.subscriptionPayment.findMany({
        include: {
          enterprise: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    const activeSubscriptions = allEnterprises.filter(e => e.billingStatus === 'ACTIVE')
    const activeTrials = allEnterprises.filter(e => e.billingStatus === 'TRIAL')
    const pastDue = allEnterprises.filter(e => e.billingStatus === 'PAST_DUE')
    const expired = allEnterprises.filter(e => e.billingStatus === 'EXPIRED')

    const expiringTrialsIn7Days = activeTrials.filter(e => e.trialEndsAt && new Date(e.trialEndsAt) <= in7Days)
    const renewalsDueIn7Days = activeSubscriptions.filter(e => e.currentPeriodEnd && new Date(e.currentPeriodEnd) <= in7Days)

    return {
      kpis: {
        totalEnterprises:       allEnterprises.length,
        activeSubscriptions:    activeSubscriptions.length,
        activeTrials:           activeTrials.length,
        pastDueCount:           pastDue.length,
        expiredCount:           expired.length,
        expiringTrialsIn7Days:  expiringTrialsIn7Days.length,
        renewalsDueIn7Days:     renewalsDueIn7Days.length,
        totalRevenueCollected:  Number(totalPayments._sum.amount || 0),
        totalPaymentsCount:     totalPayments._count.id,
      },
      enterprises: allEnterprises.map((e) => {
        let daysLeft = 0
        if (e.billingStatus === 'TRIAL' && e.trialEndsAt) {
          daysLeft = dayjs(e.trialEndsAt).diff(dayjs(now), 'day')
        } else if (e.currentPeriodEnd) {
          daysLeft = dayjs(e.currentPeriodEnd).diff(dayjs(now), 'day')
        }
        return {
          ...e,
          daysRemaining: daysLeft,
        }
      }),
      recentPayments,
    }
  }

  /**
   * Automated Daily Lifecycle & Notification Evaluator.
   * Checks expiring trials and renewals, creates proactive notifications for tenant admins and platform owner.
   */
  static async evaluateSubscriptionsAndNotify() {
    const now = new Date()
    const enterprises = await prisma.enterprise.findMany({
      where: { deletedAt: null, isActive: true },
    })

    let notificationsCreated = 0

    for (const ent of enterprises) {
      // ── 1. Trial Lifecycle Evaluation ──────────────────────────────────
      if (ent.billingStatus === 'TRIAL' && ent.trialEndsAt) {
        const trialEnd = dayjs(ent.trialEndsAt)
        const daysToExpiry = trialEnd.diff(dayjs(now), 'day')

        // Trial has expired
        if (trialEnd.isBefore(dayjs(now))) {
          await prisma.enterprise.update({
            where: { id: ent.id },
            data:  { billingStatus: 'EXPIRED' },
          })

          // Notify Tenant Admin
          await this.createNotificationIfNotDuplicate({
            enterpriseId: ent.id,
            type:         'TRIAL_EXPIRED',
            title:        'Free Trial Concluded',
            message:      `Your free trial for ${ent.name} has concluded. Please contact the platform admin to activate your official software subscription.`,
            severity:     'WARNING',
          })

          // Notify Platform Owner
          await this.createNotificationIfNotDuplicate({
            enterpriseId: null,
            type:         'TRIAL_EXPIRED',
            title:        `Trial Ended: ${ent.name}`,
            message:      `Free trial for ${ent.name} (${ent.plan}) ended today. Account is now awaiting subscription activation.`,
            severity:     'WARNING',
          })
          notificationsCreated += 2
        }
        // Trial expiring in 3 days or less
        else if (daysToExpiry <= 3 && daysToExpiry >= 0) {
          await this.createNotificationIfNotDuplicate({
            enterpriseId: ent.id,
            type:         'TRIAL_EXPIRING_SOON',
            title:        `Free Trial Ends in ${daysToExpiry === 0 ? 'Today' : `${daysToExpiry} Day${daysToExpiry > 1 ? 's' : ''}`}`,
            message:      `Your free trial for ${ent.name} will end on ${trialEnd.format('DD MMM YYYY')}. Prepare your subscription payment to ensure uninterrupted service.`,
            severity:     'INFO',
          })

          await this.createNotificationIfNotDuplicate({
            enterpriseId: null,
            type:         'TRIAL_EXPIRING_SOON',
            title:        `Trial Expiring: ${ent.name} (${daysToExpiry}d remaining)`,
            message:      `${ent.name} trial concludes on ${trialEnd.format('DD MMM YYYY')}. Follow up for software activation.`,
            severity:     'INFO',
          })
          notificationsCreated += 2
        }
      }

      // ── 2. Active Subscription Lifecycle Evaluation ────────────────────
      if (ent.billingStatus === 'ACTIVE' && ent.currentPeriodEnd) {
        const periodEnd = dayjs(ent.currentPeriodEnd)
        const daysToDue = periodEnd.diff(dayjs(now), 'day')

        // Subscription Overdue
        if (periodEnd.isBefore(dayjs(now))) {
          const daysOverdue = Math.abs(daysToDue)
          const newStatus = daysOverdue <= 3 ? 'PAST_DUE' : 'EXPIRED'

          await prisma.enterprise.update({
            where: { id: ent.id },
            data:  { billingStatus: newStatus },
          })

          // Notify Tenant Admin
          await this.createNotificationIfNotDuplicate({
            enterpriseId: ent.id,
            type:         'SUBSCRIPTION_OVERDUE',
            title:        'Subscription Renewal Overdue',
            message:      `Your subscription payment was due on ${periodEnd.format('DD MMM YYYY')}. Please submit your payment to avoid service interruption.`,
            severity:     'CRITICAL',
          })

          // Notify Platform Owner
          await this.createNotificationIfNotDuplicate({
            enterpriseId: null,
            type:         'SUBSCRIPTION_OVERDUE',
            title:        `Overdue Account: ${ent.name}`,
            message:      `Subscription for ${ent.name} is ${daysOverdue} day(s) overdue (due ${periodEnd.format('DD MMM')}).`,
            severity:     'WARNING',
          })
          notificationsCreated += 2
        }
        // Subscription Due in 5 days or less
        else if (daysToDue <= 5 && daysToDue >= 0) {
          await this.createNotificationIfNotDuplicate({
            enterpriseId: ent.id,
            type:         'SUBSCRIPTION_DUE_SOON',
            title:        `Subscription Renewal Due in ${daysToDue === 0 ? 'Today' : `${daysToDue} Day${daysToDue > 1 ? 's' : ''}`}`,
            message:      `Your subscription renewal is due on ${periodEnd.format('DD MMM YYYY')}. Settle your invoice to continue uninterrupted.`,
            severity:     'INFO',
          })

          await this.createNotificationIfNotDuplicate({
            enterpriseId: null,
            type:         'SUBSCRIPTION_DUE_SOON',
            title:        `Upcoming Renewal: ${ent.name} (in ${daysToDue}d)`,
            message:      `${ent.name} (${ent.plan}) subscription renewal due on ${periodEnd.format('DD MMM YYYY')}.`,
            severity:     'INFO',
          })
          notificationsCreated += 2
        }
      }
    }

    return { evaluated: enterprises.length, notificationsCreated }
  }

  /**
   * Helper to prevent spamming duplicate notifications within the same 24 hours.
   */
  private static async createNotificationIfNotDuplicate(data: {
    enterpriseId: string | null
    type: string
    title: string
    message: string
    severity: string
  }) {
    const oneDayAgo = dayjs().subtract(24, 'hour').toDate()
    const existing = await prisma.systemNotification.findFirst({
      where: {
        enterpriseId: data.enterpriseId,
        type:         data.type,
        createdAt:    { gte: oneDayAgo },
      },
    })

    if (!existing) {
      await prisma.systemNotification.create({
        data: {
          enterpriseId: data.enterpriseId,
          type:         data.type,
          title:        data.title,
          message:      data.message,
          severity:     data.severity,
        },
      })
    }
  }
}
