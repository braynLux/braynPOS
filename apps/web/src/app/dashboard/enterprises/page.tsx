'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import {
  FiPlus,
  FiCopy,
  FiCheck,
  FiTrash2,
  FiBriefcase,
  FiUsers,
  FiLayers,
  FiShield,
  FiKey,
  FiExternalLink,
  FiZap,
  FiPause,
  FiPlay,
  FiCreditCard,
  FiSliders,
  FiClock,
  FiAlertTriangle,
  FiCheckCircle,
  FiDollarSign,
  FiFileText,
  FiCalendar,
  FiTrendingUp,
} from 'react-icons/fi'
import dayjs from 'dayjs'

interface EnterpriseItem {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  plan: string
  isActive: boolean
  billingStatus?: string
  trialEndsAt?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  subscriptionPrice?: number | null
  billingCycle?: string | null
  daysRemaining?: number
  createdAt: string
  _count?: {
    channels: number
    users: number
    items: number
  }
}

interface InviteItem {
  id: string
  code: string
  businessName: string | null
  plan: string
  createdBy: string
  isUsed: boolean
  usedAt: string | null
  expiresAt: string
  createdAt: string
  enterprise?: {
    id: string
    name: string
    slug: string
  } | null
}

interface BillingSummaryData {
  kpis: {
    totalEnterprises: number
    activeSubscriptions: number
    activeTrials: number
    pastDueCount: number
    expiredCount: number
    expiringTrialsIn7Days: number
    renewalsDueIn7Days: number
    totalRevenueCollected: number
    totalPaymentsCount: number
  }
  enterprises: EnterpriseItem[]
  recentPayments: Array<{
    id: string
    amount: number
    currency: string
    paymentMethod: string
    reference: string
    periodMonths: number
    periodEnd: string
    createdAt: string
    enterprise: { id: string; name: string; slug: string }
  }>
}

interface PlanConfigDef {
  tier: string
  name: string
  tagline?: string
  limits: {
    maxChannels: number
    maxUsers: number
    auditRetentionDays: number
  }
  features: Record<string, boolean>
  priceMonthly?: number
  priceAnnual?: number
}

const ALL_FEATURE_KEYS = [
  { key: 'pos', label: 'Point of Sale & Registers', desc: 'Fast barcode checkout and multi-tender payments' },
  { key: 'inventory', label: 'Live Stock & Inventory', desc: 'Stock cards, low stock alerts, stock taking' },
  { key: 'reports', label: 'Basic Business Reports', desc: 'Sales summaries, register shift reconciliations' },
  { key: 'expenses', label: 'Petty Cash & Expenses', desc: 'Operating expense categorization and vouchers' },
  { key: 'customers', label: 'Customer Management', desc: 'Profiles, purchase history, loyalty points' },
  { key: 'tax', label: 'Tax & Compliance (KRA)', desc: 'ETR / TIMS compliant receipt breakdowns' },
  { key: 'serials', label: 'Serial & IMEI Tracking', desc: 'Unit-level warranty and serialization forensic logs' },
  { key: 'transfers', label: 'Multi-Branch Transfers', desc: 'Inter-branch stock transfer dispatches & receipts' },
  { key: 'invoicing', label: 'Commercial Invoicing', desc: 'Corporate tax invoices, payment terms, pro-formas' },
  { key: 'credit', label: 'Credit Books & Receivables', desc: 'Customer debt limits, aging schedules, statement PDFs' },
  { key: 'commissions', label: 'Sales Rep Commissions', desc: 'Tiered rep targets and commission payouts' },
  { key: 'accounting', label: 'Full Double-Entry Ledger', desc: 'GL charts, automated debits/credits, trial balance' },
  { key: 'fixedAssets', label: 'Fixed Asset Depreciation', desc: 'Asset registry, straight-line & reducing balance runs' },
  { key: 'payroll', label: 'Payroll & Statutory Deductions', desc: 'PAYE, NSSF, NHIF/SHIF calculation and payslips' },
  { key: 'catalog', label: 'Master Product Catalog & Bulk Import', desc: 'Enterprise-wide standardized catalog and bulk opening stock' },
  { key: 'aiPortal', label: 'AI Demand Forecasts', desc: 'Stockout prediction & margin optimization suggestions' },
  { key: 'marginAudit', label: 'Margin Correction Audits', desc: 'Historical margin anomaly forensics & retroactive adjustments' },
]

export default function PlatformEnterprisesPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace)

  const [tab, setTab] = useState<'enterprises' | 'billing' | 'matrix' | 'invites'>('enterprises')
  const [enterprises, setEnterprises] = useState<EnterpriseItem[]>([])
  const [invites, setInvites] = useState<InviteItem[]>([])
  const [billingSummary, setBillingSummary] = useState<BillingSummaryData | null>(null)
  const [planMatrix, setPlanMatrix] = useState<Record<string, PlanConfigDef> | null>(null)
  const [loading, setLoading] = useState(true)

  // Actions loading state
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [suspendingId, setSuspendingId] = useState<string | null>(null)
  const [planChangingId, setPlanChangingId] = useState<string | null>(null)

  // Modals state
  const [paymentModalEnt, setPaymentModalEnt] = useState<EnterpriseItem | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: 7500,
    currency: 'KES',
    paymentMethod: 'MPESA' as 'MPESA' | 'BANK_TRANSFER' | 'CARD' | 'CASH',
    reference: '',
    periodMonths: 1,
    notes: '',
  })
  const [submittingPayment, setSubmittingPayment] = useState(false)

  const [extendTrialModalEnt, setExtendTrialModalEnt] = useState<EnterpriseItem | null>(null)
  const [trialDaysToAdd, setTrialDaysToAdd] = useState(14)
  const [submittingTrial, setSubmittingTrial] = useState(false)

  const [historyModalEnt, setHistoryModalEnt] = useState<{ ent: EnterpriseItem; payments: any[] } | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const [editingTier, setEditingTier] = useState<string>('PRO')
  const [savingMatrix, setSavingMatrix] = useState(false)

  // Invite Modal
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    businessName: '',
    plan: 'STARTER',
    expiryDays: 7,
  })
  const [generatedInvite, setGeneratedInvite] = useState<{ code: string; url: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchData = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [entsRes, invsRes, billRes, matrixRes] = await Promise.all([
        api.get<EnterpriseItem[]>('/enterprises', token).catch(() => []),
        api.get<InviteItem[]>('/enterprises/invites', token).catch(() => []),
        api.get<BillingSummaryData>('/enterprises/billing/overview', token).catch(() => null),
        api.get<Record<string, PlanConfigDef>>('/plans/matrix', token).catch(() => null),
      ])
      setEnterprises(entsRes || [])
      setInvites(invsRes || [])
      setBillingSummary(billRes)
      setPlanMatrix(matrixRes)
    } catch (err: any) {
      toast.error(err.message || 'Failed to load platform data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [token])

  const handleSwitchWorkspace = async (enterpriseId: string) => {
    if (!token) return
    setSwitchingId(enterpriseId)
    try {
      const res = await api.post<{
        enterprise: { id: string; name: string; slug: string; plan?: string }
        channel: { id: string; name: string; code: string; type?: string; isMainWarehouse?: boolean }
        accessToken: string
        refreshToken: string
      }>(`/enterprises/${enterpriseId}/switch`, {}, token)

      switchWorkspace(res.enterprise, res.channel, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      })

      toast.success(`Entered ${res.enterprise.name} workspace!`, { icon: '🏢' })
      router.push('/dashboard')
    } catch (err: any) {
      toast.error(err.message || 'Failed to enter enterprise workspace')
    } finally {
      setSwitchingId(null)
    }
  }

  const handleToggleSuspend = async (e: EnterpriseItem) => {
    if (!token) return
    if (!confirm(e.isActive
      ? `Suspend "${e.name}"? All users will be locked out immediately.`
      : `Reactivate "${e.name}"? All users will regain access.`)) return
    setSuspendingId(e.id)
    try {
      const endpoint = e.isActive ? `/enterprises/${e.id}/suspend` : `/enterprises/${e.id}/reactivate`
      const res = await api.post<{ message: string }>(endpoint, {}, token)
      toast.success(res.message)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Action failed')
    } finally {
      setSuspendingId(null)
    }
  }

  const handlePlanChange = async (enterpriseId: string, plan: string) => {
    if (!token) return
    setPlanChangingId(enterpriseId)
    try {
      await api.patch(`/enterprises/${enterpriseId}/plan`, { plan }, token)
      toast.success(`Plan updated to ${plan}!`)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to update plan')
    } finally {
      setPlanChangingId(null)
    }
  }

  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !paymentModalEnt) return
    if (!paymentForm.reference.trim()) {
      toast.error('Payment reference is required (e.g. M-Pesa code or Bank Slip #)')
      return
    }
    setSubmittingPayment(true)
    try {
      const res = await api.post<{ message: string }>(`/enterprises/${paymentModalEnt.id}/payments`, paymentForm, token)
      toast.success(res.message, { icon: '💳' })
      setPaymentModalEnt(null)
      setPaymentForm({
        amount: 7500,
        currency: 'KES',
        paymentMethod: 'MPESA',
        reference: '',
        periodMonths: 1,
        notes: '',
      })
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to record payment')
    } finally {
      setSubmittingPayment(false)
    }
  }

  const handleExtendTrialSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !extendTrialModalEnt) return
    setSubmittingTrial(true)
    try {
      const res = await api.post<{ message: string }>(`/enterprises/${extendTrialModalEnt.id}/extend-trial`, {
        days: trialDaysToAdd,
      }, token)
      toast.success(res.message, { icon: '⏳' })
      setExtendTrialModalEnt(null)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to extend trial')
    } finally {
      setSubmittingTrial(false)
    }
  }

  const handleOpenPaymentHistory = async (ent: EnterpriseItem) => {
    if (!token) return
    setLoadingHistory(true)
    try {
      const res = await api.get<{ payments: any[] }>(`/enterprises/${ent.id}/billing`, token)
      setHistoryModalEnt({ ent, payments: res.payments || [] })
    } catch (err: any) {
      toast.error(err.message || 'Failed to load billing history')
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleSavePlanMatrix = async (tier: string) => {
    if (!token || !planMatrix || !planMatrix[tier]) return
    setSavingMatrix(true)
    try {
      const def = planMatrix[tier]
      await api.put(`/plans/matrix/${tier}`, {
        name: def.name,
        tagline: def.tagline,
        maxChannels: def.limits.maxChannels,
        maxUsers: def.limits.maxUsers,
        auditRetentionDays: def.limits.auditRetentionDays,
        priceMonthly: def.priceMonthly,
        priceAnnual: def.priceAnnual,
        features: def.features,
      }, token)
      toast.success(`Global ${tier} plan specification updated!`, { icon: '⚙️' })
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to update plan matrix')
    } finally {
      setSavingMatrix(false)
    }
  }

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setGenerating(true)
    try {
      const res = await api.post<InviteItem>('/enterprises/invites', {
        businessName: inviteForm.businessName.trim() || undefined,
        plan: inviteForm.plan,
        expiryDays: Number(inviteForm.expiryDays),
      }, token)

      const url = `${window.location.origin}/onboard?code=${res.code}`
      setGeneratedInvite({ code: res.code, url })
      toast.success('Invite code generated!', { icon: '✨' })
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate invite')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Onboarding link copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const renderStatusBadge = (ent: EnterpriseItem) => {
    if (!ent.isActive) {
      return <span className="badge badge-danger">SUSPENDED</span>
    }
    const status = ent.billingStatus || 'TRIAL'
    if (status === 'ACTIVE') {
      return (
        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiCheckCircle /> ACTIVE
        </span>
      )
    }
    if (status === 'TRIAL') {
      const days = ent.daysRemaining ?? (ent.trialEndsAt ? Math.max(0, dayjs(ent.trialEndsAt).diff(dayjs(), 'day')) : 14)
      return (
        <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiClock /> TRIAL ({days}d left)
        </span>
      )
    }
    if (status === 'PAST_DUE') {
      return (
        <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiAlertTriangle /> PAST DUE
        </span>
      )
    }
    if (status === 'EXPIRED') {
      return <span className="badge badge-secondary">EXPIRED</span>
    }
    return <span className="badge badge-info">{status}</span>
  }

  return (
    <div style={{ width: '100%', padding: '28px 32px' }}>
      {/* ── Page Header ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 28,
        paddingBottom: 24,
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: '1.75rem',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
            }}>🛡️</span>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                BraynPOS Fleet HQ & SaaS Control Center
              </h1>
              <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                Manage all registered client enterprises, track subscription lifecycles, and dynamically configure SaaS plan matrices.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href="/dashboard/fleet/analytics"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <FiTrendingUp /> Fleet Analytics
          </Link>
          <Link
            href="/dashboard/fleet/security"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <FiShield /> Security Center
          </Link>
          <Link
            href="/dashboard/fleet/audit"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <FiFileText /> Audit Trail
          </Link>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setGeneratedInvite(null)
              setShowInviteModal(true)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FiPlus /> New Enterprise Link
          </button>
        </div>
      </div>

      {/* ── Nav Tabs ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setTab('enterprises')}
          className={`btn ${tab === 'enterprises' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', fontWeight: 600 }}
        >
          <FiBriefcase /> Enterprises Fleet ({enterprises.length})
        </button>
        <button
          onClick={() => setTab('billing')}
          className={`btn ${tab === 'billing' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', fontWeight: 600 }}
        >
          <FiCreditCard /> SaaS Subscriptions & Billing
          {billingSummary?.kpis?.renewalsDueIn7Days ? (
            <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
              {billingSummary.kpis.renewalsDueIn7Days} due
            </span>
          ) : null}
        </button>
        <button
          onClick={() => setTab('matrix')}
          className={`btn ${tab === 'matrix' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', fontWeight: 600 }}
        >
          <FiSliders /> Plan Matrix Configurator
        </button>
        <button
          onClick={() => setTab('invites')}
          className={`btn ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', fontWeight: 600 }}
        >
          <FiKey /> Onboarding Invites ({invites.filter((i) => !i.isUsed).length})
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: ENTERPRISES FLEET */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {tab === 'enterprises' && (
        <div>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: '1rem' }}>
              Loading enterprise fleet...
            </div>
          ) : enterprises.length === 0 ? (
            <div style={{
              padding: 48,
              textAlign: 'center',
              background: 'var(--surface-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
            }}>
              <FiBriefcase style={{ fontSize: '2.5rem', color: 'var(--text-muted)', marginBottom: 12 }} />
              <h3>No Client Enterprises Registered Yet</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                Generate an onboarding invite link to onboard your first business client!
              </p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: 20,
            }}>
              {enterprises.map((e) => (
                <div
                  key={e.id}
                  style={{
                    background: 'var(--surface-primary, #ffffff)',
                    border: e.slug === 'prototype' ? '2px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 20,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{e.name}</h3>
                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                          slug: {e.slug}
                        </p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span className={`badge ${
                          e.plan === 'ENTERPRISE' ? 'badge-primary' : e.plan === 'PRO' ? 'badge-warning' : 'badge-secondary'
                        }`}>
                          {e.plan}
                        </span>
                        {renderStatusBadge(e)}
                      </div>
                    </div>

                    {/* Meta stats */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 8,
                      margin: '16px 0',
                      background: 'var(--bg-secondary, #f8fafc)',
                      padding: 10,
                      borderRadius: 'var(--radius-md)',
                      textAlign: 'center',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>BRANCHES</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800 }}>{e._count?.channels || 0}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>USERS</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800 }}>{e._count?.users || 0}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>CATALOG</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800 }}>{e._count?.items || 0}</div>
                      </div>
                    </div>

                    {/* Dates & Contacts */}
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {e.email && <div>📧 {e.email}</div>}
                      {e.phone && <div>📞 {e.phone}</div>}
                      <div>
                        📅 Provisioned: {dayjs(e.createdAt).format('DD MMM YYYY')}
                      </div>
                      {e.billingStatus === 'TRIAL' && e.trialEndsAt && (
                        <div style={{ color: '#b45309', fontWeight: 600 }}>
                          ⏳ Trial Ends: {dayjs(e.trialEndsAt).format('DD MMM YYYY')} ({dayjs(e.trialEndsAt).diff(dayjs(), 'day')}d remaining)
                        </div>
                      )}
                      {e.currentPeriodEnd && e.billingStatus === 'ACTIVE' && (
                        <div style={{ color: '#0369a1', fontWeight: 600 }}>
                          💳 Renewal Due: {dayjs(e.currentPeriodEnd).format('DD MMM YYYY')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="select select-sm"
                        value={e.plan}
                        disabled={planChangingId === e.id}
                        onChange={(evt) => handlePlanChange(e.id, evt.target.value)}
                        style={{ flex: 1, fontSize: '0.78rem' }}
                      >
                        <option value="STARTER">Starter Tier</option>
                        <option value="PRO">Pro Tier</option>
                        <option value="ENTERPRISE">Enterprise Tier</option>
                      </select>

                      <button
                        className={`btn btn-sm ${e.isActive ? 'btn-ghost' : 'btn-success'}`}
                        onClick={() => handleToggleSuspend(e)}
                        disabled={suspendingId === e.id}
                        title={e.isActive ? 'Suspend access' : 'Reactivate access'}
                        style={{ fontSize: '0.78rem' }}
                      >
                        {e.isActive ? <FiPause /> : <FiPlay />}
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setPaymentModalEnt(e)
                          setPaymentForm((prev) => ({
                            ...prev,
                            amount: e.plan === 'STARTER' ? 2500 : e.plan === 'PRO' ? 7500 : 25000,
                          }))
                        }}
                        style={{ flex: 1, fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <FiCreditCard /> Billing
                      </button>

                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSwitchWorkspace(e.id)}
                        disabled={switchingId === e.id || !e.isActive}
                        style={{ flex: 1.5, fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <FiExternalLink /> {switchingId === e.id ? 'Entering...' : 'Enter Fleet'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: SAAS SUBSCRIPTIONS & BILLING */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div>
          {/* KPI Dashboard */}
          {billingSummary && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}>
              <div style={{ background: 'var(--surface-primary)', padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL REVENUE COLLECTED</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#10b981', marginTop: 4 }}>
                  KES {billingSummary.kpis.totalRevenueCollected.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {billingSummary.kpis.totalPaymentsCount} confirmed payments
                </div>
              </div>

              <div style={{ background: 'var(--surface-primary)', padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ACTIVE SUBSCRIPTIONS</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0284c7', marginTop: 4 }}>
                  {billingSummary.kpis.activeSubscriptions}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Paid tenant accounts
                </div>
              </div>

              <div style={{ background: 'var(--surface-primary)', padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>FREE TRIALS ACTIVE</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#f59e0b', marginTop: 4 }}>
                  {billingSummary.kpis.activeTrials}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: 4, fontWeight: 600 }}>
                  {billingSummary.kpis.expiringTrialsIn7Days} expiring within 7 days
                </div>
              </div>

              <div style={{ background: 'var(--surface-primary)', padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>RENEWALS DUE IN 7 DAYS</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#6366f1', marginTop: 4 }}>
                  {billingSummary.kpis.renewalsDueIn7Days}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Upcoming invoice collections
                </div>
              </div>

              <div style={{ background: 'var(--surface-primary)', padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PAST DUE / EXPIRED</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ef4444', marginTop: 4 }}>
                  {billingSummary.kpis.pastDueCount + billingSummary.kpis.expiredCount}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 4, fontWeight: 600 }}>
                  Requires follow-up
                </div>
              </div>
            </div>
          )}

          {/* Subscriptions Table */}
          <div style={{
            background: 'var(--surface-primary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Tenant Subscription Accounts</h3>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px' }}>Enterprise</th>
                    <th style={{ padding: '12px 16px' }}>Plan Tier</th>
                    <th style={{ padding: '12px 16px' }}>Billing Status</th>
                    <th style={{ padding: '12px 16px' }}>Current Due / Expiry</th>
                    <th style={{ padding: '12px 16px' }}>Days Left</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enterprises.map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{e.name}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{e.email || e.slug}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className={`badge ${
                          e.plan === 'ENTERPRISE' ? 'badge-primary' : e.plan === 'PRO' ? 'badge-warning' : 'badge-secondary'
                        }`}>
                          {e.plan}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{renderStatusBadge(e)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {e.billingStatus === 'TRIAL' && e.trialEndsAt ? (
                          <span>{dayjs(e.trialEndsAt).format('DD MMM YYYY')} (Trial)</span>
                        ) : e.currentPeriodEnd ? (
                          <span>{dayjs(e.currentPeriodEnd).format('DD MMM YYYY')}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>N/A</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {e.daysRemaining !== undefined ? (
                          <span style={{
                            fontWeight: 700,
                            color: e.daysRemaining <= 3 ? '#ef4444' : e.daysRemaining <= 7 ? '#f59e0b' : 'var(--text-primary)',
                          }}>
                            {e.daysRemaining} days
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              setPaymentModalEnt(e)
                              setPaymentForm((prev) => ({
                                ...prev,
                                amount: e.plan === 'STARTER' ? 2500 : e.plan === 'PRO' ? 7500 : 25000,
                              }))
                            }}
                            title="Record Payment / Renew Subscription"
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            💳 Record Payment
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              setExtendTrialModalEnt(e)
                            }}
                            title="Extend Free Trial"
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            ⏳ Extend Trial
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleOpenPaymentHistory(e)}
                            title="View Receipts History"
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            📜 History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: SAAS PLAN MATRIX CONFIGURATOR */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {tab === 'matrix' && (
        <div>
          <div style={{
            background: 'var(--surface-primary)',
            padding: 20,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Global SaaS Plan Matrix Configurator</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Define default user limits, branch quotas, pricing, and feature modules for every subscription tier. Changes apply instantly across the platform.
                </p>
              </div>

              {/* Tier Switcher */}
              <div style={{ display: 'flex', gap: 6 }}>
                {['STARTER', 'PRO', 'ENTERPRISE'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setEditingTier(t)}
                    className={`btn btn-sm ${editingTier === t ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontWeight: 700, fontSize: '0.8rem' }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {planMatrix && planMatrix[editingTier] && (
            <div style={{
              background: 'var(--surface-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              padding: 24,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                    Configuring: {planMatrix[editingTier].name} ({editingTier})
                  </h3>
                  <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {planMatrix[editingTier].tagline}
                  </p>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => handleSavePlanMatrix(editingTier)}
                  disabled={savingMatrix}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <FiCheck /> {savingMatrix ? 'Saving Changes...' : 'Save Plan Matrix'}
                </button>
              </div>

              {/* Quotas & Pricing Inputs */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
                marginBottom: 24,
                background: 'var(--bg-secondary)',
                padding: 16,
                borderRadius: 'var(--radius-md)',
              }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Max Branches / Channels (-1 = Unlimited):
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={planMatrix[editingTier].limits.maxChannels}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1
                      setPlanMatrix({
                        ...planMatrix,
                        [editingTier]: {
                          ...planMatrix[editingTier],
                          limits: { ...planMatrix[editingTier].limits, maxChannels: val },
                        },
                      })
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Max Staff Users (-1 = Unlimited):
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={planMatrix[editingTier].limits.maxUsers}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1
                      setPlanMatrix({
                        ...planMatrix,
                        [editingTier]: {
                          ...planMatrix[editingTier],
                          limits: { ...planMatrix[editingTier].limits, maxUsers: val },
                        },
                      })
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Monthly Price (KES):
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={planMatrix[editingTier].priceMonthly || 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setPlanMatrix({
                        ...planMatrix,
                        [editingTier]: {
                          ...planMatrix[editingTier],
                          priceMonthly: val,
                        },
                      })
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Annual Price (KES):
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={planMatrix[editingTier].priceAnnual || 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setPlanMatrix({
                        ...planMatrix,
                        [editingTier]: {
                          ...planMatrix[editingTier],
                          priceAnnual: val,
                        },
                      })
                    }}
                  />
                </div>
              </div>

              {/* Module Feature Toggles */}
              <h4 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800 }}>Feature Modules & Permissions</h4>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}>
                {ALL_FEATURE_KEYS.map((feat) => {
                  const isEnabled = Boolean(planMatrix[editingTier].features[feat.key])
                  return (
                    <div
                      key={feat.key}
                      onClick={() => {
                        setPlanMatrix({
                          ...planMatrix,
                          [editingTier]: {
                            ...planMatrix[editingTier],
                            features: {
                              ...planMatrix[editingTier].features,
                              [feat.key]: !isEnabled,
                            },
                          },
                        })
                      }}
                      style={{
                        padding: 12,
                        borderRadius: 'var(--radius-md)',
                        border: isEnabled ? '1px solid rgba(2, 132, 199, 0.4)' : '1px solid var(--border)',
                        background: isEnabled ? 'rgba(2, 132, 199, 0.05)' : 'var(--surface-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => {}} // Handled by parent div
                        style={{ marginTop: 3, cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isEnabled ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {feat.label}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {feat.desc}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ marginTop: 24, textAlign: 'right' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleSavePlanMatrix(editingTier)}
                  disabled={savingMatrix}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <FiCheck /> {savingMatrix ? 'Saving Changes...' : 'Save Plan Matrix'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: ONBOARDING INVITES */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {tab === 'invites' && (
        <div>
          <div style={{
            background: 'var(--surface-primary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>One-Time Onboarding Invite Codes</h3>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setGeneratedInvite(null)
                  setShowInviteModal(true)
                }}
              >
                + Generate Code
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px' }}>Code</th>
                    <th style={{ padding: '12px 16px' }}>Target Business</th>
                    <th style={{ padding: '12px 16px' }}>Plan Tier</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px' }}>Expires</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No invite codes generated yet.
                      </td>
                    </tr>
                  ) : (
                    invites.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 700 }}>
                          {inv.code}
                        </td>
                        <td style={{ padding: '12px 16px' }}>{inv.businessName || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className="badge badge-primary">{inv.plan}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {inv.isUsed ? (
                            <span className="badge badge-success">Used by {inv.enterprise?.name || 'Client'}</span>
                          ) : dayjs(inv.expiresAt).isBefore(dayjs()) ? (
                            <span className="badge badge-danger">Expired</span>
                          ) : (
                            <span className="badge badge-warning">Active (Unused)</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px' }}>{dayjs(inv.expiresAt).format('DD MMM YYYY')}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          {!inv.isUsed && (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => handleCopyLink(`${window.location.origin}/onboard?code=${inv.code}`)}
                              title="Copy onboarding link"
                            >
                              <FiCopy /> Copy Link
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL: RECORD PAYMENT */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {paymentModalEnt && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--surface-primary, #ffffff)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 480,
            padding: 24,
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 800 }}>
              Record Subscription Payment
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Client: <strong>{paymentModalEnt.name}</strong> ({paymentModalEnt.plan} Tier)
            </p>

            <form onSubmit={handleRecordPaymentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Amount Received:
                  </label>
                  <input
                    type="number"
                    className="input"
                    required
                    min={1}
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Currency:
                  </label>
                  <input
                    className="input"
                    value={paymentForm.currency}
                    onChange={(e) => setPaymentForm({ ...paymentForm, currency: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Payment Method:
                  </label>
                  <select
                    className="select"
                    value={paymentForm.paymentMethod}
                    onChange={(e: any) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                  >
                    <option value="MPESA">M-Pesa</option>
                    <option value="BANK_TRANSFER">Bank Transfer / RTGS</option>
                    <option value="CARD">Credit / Debit Card</option>
                    <option value="CASH">Direct Cash</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Period (Months):
                  </label>
                  <select
                    className="select"
                    value={paymentForm.periodMonths}
                    onChange={(e) => setPaymentForm({ ...paymentForm, periodMonths: parseInt(e.target.value) || 1 })}
                  >
                    <option value={1}>1 Month</option>
                    <option value={3}>3 Months (Quarterly)</option>
                    <option value={6}>6 Months (Bi-Annual)</option>
                    <option value={12}>12 Months (Annual)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Payment Reference / Transaction ID:
                </label>
                <input
                  className="input"
                  required
                  placeholder="e.g. QK89201948 or Slip #9021"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Receipt Notes (Optional):
                </label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Any additional payment notes..."
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPaymentModalEnt(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingPayment}>
                  {submittingPayment ? 'Processing...' : 'Confirm Payment & Activate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL: EXTEND TRIAL */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {extendTrialModalEnt && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--surface-primary, #ffffff)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 420,
            padding: 24,
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 800 }}>
              Extend Free Trial
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Client: <strong>{extendTrialModalEnt.name}</strong>
            </p>

            <form onSubmit={handleExtendTrialSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Days to Add to Trial:
                </label>
                <select
                  className="select"
                  value={trialDaysToAdd}
                  onChange={(e) => setTrialDaysToAdd(parseInt(e.target.value) || 14)}
                >
                  <option value={7}>+ 7 Days</option>
                  <option value={14}>+ 14 Days (Standard)</option>
                  <option value={30}>+ 30 Days (One Month)</option>
                  <option value={60}>+ 60 Days</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setExtendTrialModalEnt(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-warning" disabled={submittingTrial}>
                  {submittingTrial ? 'Extending...' : 'Extend Trial Period'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL: PAYMENT HISTORY */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {historyModalEnt && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--surface-primary, #ffffff)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 650,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            padding: 24,
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Payment Receipts History</h3>
                <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {historyModalEnt.ent.name}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setHistoryModalEnt(null)}>
                ✕
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {historyModalEnt.payments.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No payment receipts recorded for this enterprise yet.
                </div>
              ) : (
                <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Date</th>
                      <th style={{ padding: '8px 12px' }}>Amount</th>
                      <th style={{ padding: '8px 12px' }}>Method</th>
                      <th style={{ padding: '8px 12px' }}>Reference</th>
                      <th style={{ padding: '8px 12px' }}>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyModalEnt.payments.map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px' }}>{dayjs(p.createdAt).format('DD MMM YYYY')}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#10b981' }}>
                          {p.currency} {Number(p.amount).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 12px' }}>{p.paymentMethod}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{p.reference}</td>
                        <td style={{ padding: '8px 12px' }}>
                          {dayjs(p.periodStart).format('DD MMM')} – {dayjs(p.periodEnd).format('DD MMM YYYY')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="btn btn-ghost" onClick={() => setHistoryModalEnt(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL: ONBOARDING INVITE GENERATOR */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {showInviteModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--surface-primary, #ffffff)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: 480,
            padding: 24,
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 800 }}>
              Generate Client Onboarding Link
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Creates a secure one-time invite link for self-service business onboarding.
            </p>

            {!generatedInvite ? (
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Client Business Name (Optional):
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Acme Supermarket Ltd"
                    value={inviteForm.businessName}
                    onChange={(e) => setInviteForm({ ...inviteForm, businessName: e.target.value })}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Target Subscription Tier:
                  </label>
                  <select
                    className="select"
                    value={inviteForm.plan}
                    onChange={(e) => setInviteForm({ ...inviteForm, plan: e.target.value })}
                  >
                    <option value="STARTER">Starter Tier (1 Branch, 3 Staff)</option>
                    <option value="PRO">Pro Tier (5 Branches, 15 Staff)</option>
                    <option value="ENTERPRISE">Enterprise Tier (Unlimited Branches & Staff)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Invite Link Validity:
                  </label>
                  <select
                    className="select"
                    value={inviteForm.expiryDays}
                    onChange={(e) => setInviteForm({ ...inviteForm, expiryDays: parseInt(e.target.value) || 7 })}
                  >
                    <option value={3}>3 Days</option>
                    <option value={7}>7 Days (Standard)</option>
                    <option value={30}>30 Days</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowInviteModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={generating}>
                    {generating ? 'Generating...' : '✨ Generate Invite Link'}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>ONE-TIME CODE</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--success)' }}>
                    {generatedInvite.code}
                  </div>
                </div>

                <div style={{ textAlign: 'left' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Shareable Onboarding URL:
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input"
                      readOnly
                      value={generatedInvite.url}
                      style={{ fontSize: '0.85rem', background: 'var(--bg-elevated)' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => handleCopyLink(generatedInvite.url)}
                      style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {copied ? <FiCheck /> : <FiCopy />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Send this one-time link to your client. Once they complete registration, this link is immediately consumed and they begin their 14-day free trial.
                </p>

                <button
                  className="btn btn-ghost"
                  onClick={() => setShowInviteModal(false)}
                  style={{ marginTop: 8 }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
