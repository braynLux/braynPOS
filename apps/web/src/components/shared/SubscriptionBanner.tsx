'use client'
import React from 'react'
import { useAuthStore } from '@/stores/auth.store'
import dayjs from 'dayjs'

export function SubscriptionBanner() {
  const user = useAuthStore((s) => s.user)
  const isPlatformOwnerSwitched = useAuthStore((s) => s.isPlatformOwnerSwitched)

  // Only display for tenant enterprises (or when switched into a tenant)
  if (!user?.enterprise) return null

  const { billingStatus, trialEndsAt, currentPeriodEnd, plan } = user.enterprise as any
  const now = new Date()

  // Compute days left
  let daysLeft = 0
  if (billingStatus === 'TRIAL' && trialEndsAt) {
    daysLeft = Math.max(0, dayjs(trialEndsAt).diff(dayjs(now), 'day'))
  } else if (currentPeriodEnd) {
    daysLeft = dayjs(currentPeriodEnd).diff(dayjs(now), 'day')
  }

  // 1. Active Free Trial Banner
  if (billingStatus === 'TRIAL') {
    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
        color: '#b45309',
        padding: '8px 20px',
        fontSize: '0.8rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>⏳</span>
          <span>
            <strong>Free Trial Active:</strong> You have <strong>{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</strong> on your {plan || 'STARTER'} trial. All features are fully functional.
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
            Ends {trialEndsAt ? dayjs(trialEndsAt).format('DD MMM YYYY') : 'soon'}
          </span>
          <a
            href="mailto:support@brayn.app?subject=Activate%20Paid%20Subscription"
            className="btn btn-sm"
            style={{
              background: '#d97706',
              color: '#ffffff',
              border: 'none',
              padding: '3px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              borderRadius: '6px',
              textDecoration: 'none',
            }}
          >
            Upgrade / Settle
          </a>
        </div>
      </div>
    )
  }

  // 2. Past Due Banner
  if (billingStatus === 'PAST_DUE') {
    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.1) 100%)',
        borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
        color: '#b91c1c',
        padding: '8px 20px',
        fontSize: '0.8rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>⚠️</span>
          <span>
            <strong>Subscription Past Due:</strong> Payment was due on {currentPeriodEnd ? dayjs(currentPeriodEnd).format('DD MMM YYYY') : 'recent date'}. Please settle to prevent service lockout.
          </span>
        </div>
        <a
          href="mailto:support@brayn.app?subject=Settle%20Subscription%20Invoice"
          className="btn btn-sm"
          style={{
            background: '#dc2626',
            color: '#ffffff',
            border: 'none',
            padding: '3px 10px',
            fontSize: '0.75rem',
            fontWeight: 700,
            borderRadius: '6px',
            textDecoration: 'none',
          }}
        >
          Renew Now
        </a>
      </div>
    )
  }

  // 3. Expired Banner
  if (billingStatus === 'EXPIRED') {
    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(220, 38, 38, 0.2) 0%, rgba(185, 28, 28, 0.15) 100%)',
        borderBottom: '1px solid rgba(220, 38, 38, 0.4)',
        color: '#991b1b',
        padding: '10px 20px',
        fontSize: '0.82rem',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.1rem' }}>🛑</span>
          <span>
            Subscription Expired. Software access is currently in grace read-only mode. Please contact the administrator to activate your subscription.
          </span>
        </div>
      </div>
    )
  }

  // 4. Renewal Due Soon (<= 5 days)
  if (billingStatus === 'ACTIVE' && daysLeft <= 5 && daysLeft >= 0) {
    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(2, 132, 199, 0.12) 0%, rgba(3, 105, 161, 0.08) 100%)',
        borderBottom: '1px solid rgba(2, 132, 199, 0.25)',
        color: '#0369a1',
        padding: '8px 20px',
        fontSize: '0.8rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>📅</span>
          <span>
            <strong>Renewal Notice:</strong> Your subscription renews in <strong>{daysLeft === 0 ? 'Today' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}</strong> ({currentPeriodEnd ? dayjs(currentPeriodEnd).format('DD MMM YYYY') : ''}).
          </span>
        </div>
      </div>
    )
  }

  return null
}
