'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

// ── Types: Enterprise Dashboard ────────────────────────────────────────
interface DashboardData {
  todaySales: number
  todayRevenue: number
  todayExpenses: number
  todayProfit: number
  markupPercent: number
  activeChannels: number
  lowStockItems: number
  pendingTransfers: number
  lowStockList: { id: string; name: string; sku: string; availableQty: number; reorderLevel: number; severity: 'critical' | 'low' }[]
  recentSales: { id: string; receiptNo: string; netAmount: number; createdAt: string; customer?: { name: string }; channel?: { name: string } }[]
}
interface AdminStats {
  aggregateRevenue: number
  aggregateMargin: number
  totalSalesCount: number
  channelStats: { channelName: string; revenue: number; margin: number }[]
}

// ── Types: Fleet Dashboard ─────────────────────────────────────────────
interface FleetEnterprise {
  id: string
  name: string
  slug: string
  plan: string
  isActive: boolean
  createdAt: string
  _count: { channels: number; users: number; items: number }
}
interface FleetStats {
  totalEnterprises: number
  activeCount: number
  suspendedCount: number
  totalChannels: number
  totalUsers: number
  planDistribution: Record<string, number>
  recentOnboards: { id: string; name: string; slug: string; plan: string; createdAt: string }[]
  enterprises: FleetEnterprise[]
}

// ── Plan badge colours ─────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  STARTER:    'var(--text-muted)',
  PRO:        'var(--primary)',
  ENTERPRISE: '#f59e0b',
}

export default function DashboardPage() {
  const router    = useRouter()
  const token     = useAuthStore((s) => s.accessToken)
  const user      = useAuthStore((s) => s.user)
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace)
  const isPlatformOwnerSwitched = useAuthStore((s) => s.isPlatformOwnerSwitched)

  // Is this the true Platform Owner view (not inside a workspace)?
  const isFleetView = user?.role === 'PLATFORM_OWNER' && !isPlatformOwnerSwitched

  // ── Enterprise dashboard state ────────────────────────────────────────
  const [data,      setData]      = useState<DashboardData | null>(null)
  const [adminData, setAdminData] = useState<AdminStats | null>(null)

  // ── Fleet dashboard state ─────────────────────────────────────────────
  const [fleetStats,  setFleetStats]  = useState<FleetStats | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [suspendingId, setSuspendingId] = useState<string | null>(null)
  const [planChangingId, setPlanChangingId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n)

  // ── Data fetching ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    setLoading(true)

    if (isFleetView) {
      api.get<FleetStats>('/enterprises/fleet/stats', token)
        .then(setFleetStats)
        .catch((e) => toast.error(e.message || 'Failed to load fleet stats'))
        .finally(() => setLoading(false))
    } else {
      const fetchDashboard = async () => {
        try {
          const res = await api.get<DashboardData>('/dashboard/summary', token)
          setData(res)
          if (['SUPER_ADMIN', 'MANAGER_ADMIN', 'PLATFORM_OWNER'].includes(user?.role || '')) {
            const today    = new Date().toISOString().split('T')[0]
            const adminRes = await api.get<AdminStats>(
              `/reports/admin-dashboard?startDate=${today}T00:00:00Z&endDate=${today}T23:59:59Z`, token
            )
            setAdminData(adminRes)
          }
        } catch (err: any) {
          console.error(err)
        } finally {
          setLoading(false)
        }
      }
      fetchDashboard()
    }
  }, [token, user?.role, isFleetView])

  // ── Fleet actions ─────────────────────────────────────────────────────
  const handleEnterWorkspace = async (enterpriseId: string) => {
    if (!token) return
    setSwitchingId(enterpriseId)
    try {
      const res = await api.post<{
        enterprise: { id: string; name: string; slug: string; plan?: string }
        channel: { id: string; name: string; code: string; type?: string; isMainWarehouse?: boolean }
        accessToken: string
        refreshToken: string
      }>(`/enterprises/${enterpriseId}/switch`, {}, token)
      switchWorkspace(res.enterprise, res.channel, { accessToken: res.accessToken, refreshToken: res.refreshToken })
      toast.success(`Entered ${res.enterprise.name} workspace!`, { icon: '🏢' })
      router.push('/dashboard')
    } catch (err: any) {
      toast.error(err.message || 'Failed to enter workspace')
    } finally {
      setSwitchingId(null)
    }
  }

  const handleToggleSuspend = async (e: FleetEnterprise) => {
    if (!token) return
    if (!confirm(e.isActive
      ? `Suspend "${e.name}"? All users will be locked out immediately.`
      : `Reactivate "${e.name}"? All users will regain access.`)) return
    setSuspendingId(e.id)
    try {
      const endpoint = e.isActive ? `/enterprises/${e.id}/suspend` : `/enterprises/${e.id}/reactivate`
      const res = await api.post<{ message: string }>(endpoint, {}, token)
      toast.success(res.message)
      // Refresh fleet stats
      const stats = await api.get<FleetStats>('/enterprises/fleet/stats', token)
      setFleetStats(stats)
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
      const res = await api.patch<{ message: string }>(`/enterprises/${enterpriseId}/plan`, { plan }, token)
      toast.success(res.message)
      const stats = await api.get<FleetStats>('/enterprises/fleet/stats', token)
      setFleetStats(stats)
    } catch (err: any) {
      toast.error(err.message || 'Plan change failed')
    } finally {
      setPlanChangingId(null)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FLEET DASHBOARD — Platform Owner View
  // ══════════════════════════════════════════════════════════════════════
  if (isFleetView) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.03em', margin: 0 }}>
              <span style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                Fleet Command Center
              </span>
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 4 }}>
              🛡️ Platform Owner — Complete fleet oversight across all enterprise tenants
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/dashboard/enterprises" className="btn btn-ghost btn-sm">
              🏢 Enterprise Fleet →
            </Link>
            <Link href="/dashboard/fleet/analytics" className="btn btn-ghost btn-sm">
              📈 Analytics →
            </Link>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚡</div>
            Loading fleet data...
          </div>
        ) : (
          <>
            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {[
                {
                  label: 'Total Enterprises', value: fleetStats?.totalEnterprises ?? 0,
                  sub: `${fleetStats?.activeCount ?? 0} active · ${fleetStats?.suspendedCount ?? 0} suspended`,
                  color: '#f59e0b', icon: '🏢',
                },
                {
                  label: 'Total Channels', value: fleetStats?.totalChannels ?? 0,
                  sub: 'Across all enterprises', color: 'var(--primary)', icon: '🏪',
                },
                {
                  label: 'Total Staff', value: fleetStats?.totalUsers ?? 0,
                  sub: 'All users across fleet', color: 'var(--success)', icon: '👥',
                },
                {
                  label: 'Enterprise Plans',
                  value: `${fleetStats?.planDistribution?.PRO ?? 0} Pro · ${fleetStats?.planDistribution?.ENTERPRISE ?? 0} Ent.`,
                  sub: `${fleetStats?.planDistribution?.STARTER ?? 0} on Starter`, color: 'var(--accent)', icon: '📋',
                },
              ].map((kpi) => (
                <div key={kpi.label} className="card" style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{kpi.icon}</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: kpi.color, lineHeight: 1.1 }}>
                    {kpi.value}
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>
                    {kpi.label}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {kpi.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Enterprise Fleet Table ── */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>🏢 Enterprise Fleet</h2>
                <Link href="/dashboard/enterprises" className="btn btn-ghost btn-sm" style={{ fontSize: '0.8rem' }}>
                  Full Management →
                </Link>
              </div>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '12px 16px' }}>Enterprise</th>
                        <th style={{ padding: '12px 16px' }}>Plan</th>
                        <th style={{ padding: '12px 16px' }}>Channels</th>
                        <th style={{ padding: '12px 16px' }}>Staff</th>
                        <th style={{ padding: '12px 16px' }}>Status</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(fleetStats?.enterprises ?? []).map((e) => (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontWeight: 700 }}>{e.name}</div>
                            <code style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.slug}</code>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <select
                              disabled={planChangingId === e.id}
                              value={e.plan}
                              onChange={(ev) => handlePlanChange(e.id, ev.target.value)}
                              style={{
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                borderRadius: 6, padding: '4px 8px', fontSize: '0.78rem',
                                color: PLAN_COLORS[e.plan] || 'var(--text-primary)', fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              <option value="STARTER">STARTER</option>
                              <option value="PRO">PRO</option>
                              <option value="ENTERPRISE">ENTERPRISE</option>
                            </select>
                          </td>
                          <td style={{ padding: '12px 16px' }}>{e._count.channels}</td>
                          <td style={{ padding: '12px 16px' }}>{e._count.users}</td>
                          <td style={{ padding: '12px 16px' }}>
                            {e.isActive
                              ? <span className="badge badge-success">● Active</span>
                              : <span className="badge badge-danger">● Suspended</span>
                            }
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={suspendingId === e.id}
                                onClick={() => handleToggleSuspend(e)}
                                style={{ fontSize: '0.75rem', color: e.isActive ? 'var(--warning)' : 'var(--success)', padding: '4px 10px' }}
                              >
                                {suspendingId === e.id ? '...' : e.isActive ? '⏸ Suspend' : '▶ Reactivate'}
                              </button>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={switchingId === e.id || !e.isActive}
                                onClick={() => handleEnterWorkspace(e.id)}
                                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                              >
                                {switchingId === e.id ? '...' : '⚡ Enter'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(fleetStats?.enterprises ?? []).length === 0 && !loading && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                            No enterprises registered yet.{' '}
                            <Link href="/dashboard/enterprises" style={{ color: 'var(--primary)' }}>
                              Generate an invite link →
                            </Link>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ── Plan Distribution + Recent Onboards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>

              {/* Plan Distribution */}
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 16 }}>📋 Plan Distribution</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['STARTER', 'PRO', 'ENTERPRISE'].map((plan) => {
                    const count = fleetStats?.planDistribution?.[plan] ?? 0
                    const total = fleetStats?.totalEnterprises ?? 1
                    const pct   = total > 0 ? Math.round((count / total) * 100) : 0
                    return (
                      <div key={plan}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, color: PLAN_COLORS[plan] }}>{plan}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{count} tenant{count !== 1 ? 's' : ''} ({pct}%)</span>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, height: 8 }}>
                          <div style={{ width: `${pct}%`, background: PLAN_COLORS[plan], height: '100%', borderRadius: 6, transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Recent Onboards */}
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 16 }}>🚀 Recent Onboards</h3>
                {(fleetStats?.recentOnboards ?? []).length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No enterprises onboarded yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(fleetStats?.recentOnboards ?? []).map((e) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{e.name}</div>
                          <code style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.slug}</code>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: PLAN_COLORS[e.plan] }}>{e.plan}</span>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {new Date(e.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Quick Links ── */}
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 12 }}>⚡ Platform Controls</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href="/dashboard/enterprises" className="btn btn-primary">🏢 Manage Enterprises</Link>
                <Link href="/dashboard/fleet/analytics" className="btn btn-ghost">📈 Fleet Analytics</Link>
                <Link href="/dashboard/fleet/audit" className="btn btn-ghost">📜 Audit Trail</Link>
                <Link href="/dashboard/fleet/security" className="btn btn-ghost">🔒 Security Overview</Link>
                <Link href="/dashboard/settings" className="btn btn-ghost">⚙️ Platform Settings</Link>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  //  REGULAR ENTERPRISE DASHBOARD (non-Platform Owner OR switched workspace)
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Today&apos;s performance overview
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge badge-success">● System Online</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Loading dashboard...
        </div>
      ) : (
        <div className="stat-grid">
          <div className="stat-card" id="stat-revenue">
            <div className="stat-value">{formatCurrency(data?.todayRevenue ?? 0)}</div>
            <div className="stat-label">Today&apos;s Revenue</div>
          </div>
          <div className="stat-card" id="stat-sales">
            <div className="stat-value">{data?.todaySales ?? 0}</div>
            <div className="stat-label">Sales Transactions</div>
          </div>
          <div className="stat-card" id="stat-expenses">
            <div className="stat-value">{formatCurrency(data?.todayExpenses ?? 0)}</div>
            <div className="stat-label">Today&apos;s Expenses</div>
          </div>
          <div className="stat-card" id="stat-profit" style={{ borderLeft: '4px solid var(--success)' }}>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(data?.todayProfit ?? 0)}</div>
            <div className="stat-label">Expected Profit (Today)</div>
            {data?.markupPercent !== undefined && (
              <div style={{ fontSize: '0.75rem', marginTop: 4, opacity: 0.8 }}>
                Markup: {data.markupPercent.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="stat-card" id="stat-channels">
            <div className="stat-value">{data?.activeChannels ?? 0}</div>
            <div className="stat-label">Active Channels</div>
          </div>
          <div className="stat-card" id="stat-low-stock" style={(data?.lowStockItems ?? 0) > 0 ? { borderColor: 'rgba(245, 158, 11, 0.5)' } : {}}>
            <div className="stat-value" style={(data?.lowStockItems ?? 0) > 0 ? {
              background: 'linear-gradient(135deg, var(--warning), #f97316)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            } : {}}>
              {data?.lowStockItems ?? 0}
            </div>
            <div className="stat-label">Low Stock Items</div>
          </div>
          <div className="stat-card" id="stat-transfers">
            <div className="stat-value">{data?.pendingTransfers ?? 0}</div>
            <div className="stat-label">Pending Transfers</div>
          </div>
        </div>
      )}

      {!loading && (data?.lowStockList?.length ?? 0) > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>⚠️ Low Stock Alert</h2>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th><th>SKU</th>
                  <th style={{ textAlign: 'right' }}>Available</th>
                  <th style={{ textAlign: 'right' }}>Reorder Level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.lowStockList.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.name}</strong></td>
                    <td><code style={{ fontSize: '0.8rem' }}>{item.sku}</code></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.availableQty}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{item.reorderLevel}</td>
                    <td>
                      <span className={`badge ${item.severity === 'critical' ? 'badge-danger' : 'badge-warning'}`}>
                        {item.severity === 'critical' ? 'Out of stock' : 'Low'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
              <Link href="/dashboard/stock" style={{ fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>View full stock levels →</Link>
            </div>
          </div>
        </div>
      )}

      {adminData && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>📊 System-Wide Overview (Today)</h2>
          <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
            <div className="stat-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--primary)' }}>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(adminData.aggregateRevenue)}</div>
              <div className="stat-label">System-Wide Revenue</div>
            </div>
            <div className="stat-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--success)' }}>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(adminData.aggregateMargin)}</div>
              <div className="stat-label">System-Wide Gross Margin</div>
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 16, fontSize: '1rem' }}>Channel Breakdown</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Gross Margin</th>
                </tr>
              </thead>
              <tbody>
                {adminData.channelStats.map((c, i) => (
                  <tr key={i}>
                    <td><strong>{c.channelName}</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(c.revenue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: c.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(c.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>🕒 Recent Transactions</h2>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th><th>Channel</th><th>Customer</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentSales && data.recentSales.length > 0 ? (
                data.recentSales.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.receiptNo}</strong></td>
                    <td><span className="badge badge-outline">{s.channel?.name || 'Global'}</span></td>
                    <td>{s.customer?.name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(s.netAmount)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No recent transactions recorded today.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <Link href="/dashboard/sales" style={{ fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>View all sales history →</Link>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/dashboard/pos" className="btn btn-primary">🛒 Open POS Terminal</Link>
          <Link href="/dashboard/items" className="btn btn-ghost">📋 Manage Items</Link>
          <Link href="/dashboard/sales" className="btn btn-ghost">💰 View Sales</Link>
          <Link href="/dashboard/reports" className="btn btn-ghost">📊 Reports</Link>
          <Link href="/dashboard/accounting" className="btn btn-ghost">📒 Accounting</Link>
        </div>
      </div>
    </div>
  )
}
