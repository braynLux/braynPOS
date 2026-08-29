'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface FleetEnterprise {
  id: string; name: string; slug: string; plan: string; isActive: boolean; createdAt: string
  _count: { channels: number; users: number; items: number }
}
interface FleetStats {
  totalEnterprises: number; activeCount: number; suspendedCount: number
  totalChannels: number; totalUsers: number
  planDistribution: Record<string, number>
  recentOnboards: { id: string; name: string; slug: string; plan: string; createdAt: string }[]
  enterprises: FleetEnterprise[]
}

const PLAN_COLORS: Record<string, string> = {
  STARTER: '#6b7280', PRO: 'var(--primary)', ENTERPRISE: '#f59e0b',
}

export default function FleetAnalyticsPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [stats, setStats]   = useState<FleetStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    api.get<FleetStats>('/enterprises/fleet/stats', token)
      .then(setStats)
      .catch((e: any) => toast.error(e.message || 'Failed to load fleet analytics'))
      .finally(() => setLoading(false))
  }, [token])

  const totalEnterprises = stats?.totalEnterprises ?? 0

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            📈 Fleet Analytics
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
            Cross-enterprise growth, distribution and health metrics
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-ghost btn-sm">← Back to Fleet Dashboard</Link>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading fleet analytics...</div>
      ) : (
        <>
          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {[
              { label: 'Total Enterprises', value: stats?.totalEnterprises ?? 0, color: '#f59e0b' },
              { label: 'Active Tenants',    value: stats?.activeCount ?? 0,      color: 'var(--success)' },
              { label: 'Suspended',         value: stats?.suspendedCount ?? 0,   color: 'var(--danger)' },
              { label: 'Total Channels',    value: stats?.totalChannels ?? 0,    color: 'var(--primary)' },
              { label: 'Total Staff',       value: stats?.totalUsers ?? 0,       color: 'var(--accent)' },
            ].map((k) => (
              <div key={k.label} className="card" style={{ padding: '16px' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Plan Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            <div className="card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 20 }}>📋 Plan Distribution</h2>
              {['ENTERPRISE', 'PRO', 'STARTER'].map((plan) => {
                const count = stats?.planDistribution?.[plan] ?? 0
                const pct   = totalEnterprises > 0 ? Math.round((count / totalEnterprises) * 100) : 0
                return (
                  <div key={plan} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: PLAN_COLORS[plan], fontSize: '0.85rem' }}>{plan}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{count} ({pct}%)</span>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, height: 12, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, background: PLAN_COLORS[plan], height: '100%', borderRadius: 8,
                        transition: 'width 0.6s ease', minWidth: pct > 0 ? 4 : 0,
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Enterprise Status */}
            <div className="card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 20 }}>⚡ Fleet Health Status</h2>
              {[
                { label: 'Active Enterprises',   value: stats?.activeCount ?? 0,   color: 'var(--success)', pct: totalEnterprises > 0 ? Math.round(((stats?.activeCount ?? 0) / totalEnterprises) * 100) : 0 },
                { label: 'Suspended Enterprises', value: stats?.suspendedCount ?? 0, color: 'var(--danger)',  pct: totalEnterprises > 0 ? Math.round(((stats?.suspendedCount ?? 0) / totalEnterprises) * 100) : 0 },
              ].map((s) => (
                <div key={s.label} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.label}</span>
                    <span style={{ color: s.color, fontWeight: 700, fontSize: '0.85rem' }}>{s.value} ({s.pct}%)</span>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, height: 12 }}>
                    <div style={{ width: `${s.pct}%`, background: s.color, height: '100%', borderRadius: 8, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 20, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--success)' }}>
                  {totalEnterprises > 0 ? Math.round(((stats?.activeCount ?? 0) / totalEnterprises) * 100) : 0}%
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Fleet Uptime Rate</div>
              </div>
            </div>
          </div>

          {/* Enterprise Growth Timeline */}
          <div className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>🏢 All Enterprises — Detail View</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px' }}>Enterprise</th>
                    <th style={{ padding: '12px 16px' }}>Plan</th>
                    <th style={{ padding: '12px 16px' }}>Channels</th>
                    <th style={{ padding: '12px 16px' }}>Staff</th>
                    <th style={{ padding: '12px 16px' }}>Items</th>
                    <th style={{ padding: '12px 16px' }}>Onboarded</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.enterprises ?? []).map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 700 }}>{e.name}</div>
                        <code style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.slug}</code>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: PLAN_COLORS[e.plan] }}>{e.plan}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{e._count.channels}</td>
                      <td style={{ padding: '12px 16px' }}>{e._count.users}</td>
                      <td style={{ padding: '12px 16px' }}>{e._count.items}</td>
                      <td style={{ padding: '12px 16px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {new Date(e.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {e.isActive
                          ? <span className="badge badge-success">● Active</span>
                          : <span className="badge badge-danger">● Suspended</span>}
                      </td>
                    </tr>
                  ))}
                  {(stats?.enterprises ?? []).length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No enterprises yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
