'use client'
import React from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { resolveEnterpriseCapabilities, type PlanFeatureKey, PLAN_DEFINITIONS } from '@/lib/plans'

interface PlanUpgradeGuardProps {
  feature: PlanFeatureKey
  featureTitle: string
  featureDescription?: string
  children: React.ReactNode
}

export function PlanUpgradeGuard({
  feature,
  featureTitle,
  featureDescription,
  children,
}: PlanUpgradeGuardProps) {
  const user = useAuthStore((s) => s.user)
  const isPlatformOwner = user?.role === 'PLATFORM_OWNER'

  // Platform owner always has full access
  if (isPlatformOwner) {
    return <>{children}</>
  }

  const caps = resolveEnterpriseCapabilities(user?.enterprise)

  if (caps.hasFeature(feature)) {
    return <>{children}</>
  }

  const requiredPlan = feature === 'catalog' || feature === 'fixedAssets' || feature === 'payroll' || feature === 'marginAudit' || feature === 'aiPortal'
    ? 'ENTERPRISE'
    : 'PRO'

  const targetPlanDef = PLAN_DEFINITIONS[requiredPlan]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: 540,
        width: '100%',
        background: 'var(--surface-primary, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '16px',
        padding: '36px 28px',
        textAlign: 'center',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '14px',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.1))',
          color: '#d97706',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
          marginBottom: '16px',
        }}>
          🔒
        </div>

        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', marginBottom: '8px' }}>
          {featureTitle} is locked on {caps.name}
        </h2>

        <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '24px' }}>
          {featureDescription || `${featureTitle} is available on the ${targetPlanDef.name} plan. Upgrade your enterprise subscription to unlock full capabilities.`}
        </p>

        <div style={{
          background: 'rgba(248, 250, 252, 0.8)',
          border: '1px solid rgba(226, 232, 240, 0.8)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '24px',
          textAlign: 'left',
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '8px' }}>
            ✨ Included with {targetPlanDef.name}:
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.85rem', color: '#334155', display: 'grid', gap: '6px' }}>
            {requiredPlan === 'ENTERPRISE' ? (
              <>
                <li>✓ Master Product Catalog & Central Sync</li>
                <li>✓ Full Double-Entry Accounting & P&L</li>
                <li>✓ Staff Payroll & Automatic Payslips</li>
                <li>✓ Fixed Asset Register & Depreciation</li>
                <li>✓ Forensic Margin & Zero-Cost Fraud Audits</li>
                <li>✓ Unlimited Branches & Unlimited Staff</li>
              </>
            ) : (
              <>
                <li>✓ Multi-Branch Inventory & Stock Transfers</li>
                <li>✓ Invoicing, Quotations & PDF Generation</li>
                <li>✓ Serial Number Tracking & Verification</li>
                <li>✓ Customer Credit Accounts & Ledger</li>
                <li>✓ Double-Entry Chart of Accounts & General Ledger</li>
                <li>✓ Up to 5 Branches & 15 Staff Accounts</li>
              </>
            )}
          </ul>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <Link href="/dashboard" className="btn btn-outline" style={{ padding: '8px 20px' }}>
            ← Back to Dashboard
          </Link>
          <a
            href={`mailto:support@brayn.app?subject=Upgrade%20to%20${requiredPlan}%20Plan`}
            className="btn btn-primary"
            style={{
              padding: '8px 24px',
              background: 'linear-gradient(135deg, #0284c7, #0369a1)',
              borderColor: '#0284c7',
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            Upgrade to {targetPlanDef.tier}
          </a>
        </div>
      </div>
    </div>
  )
}
