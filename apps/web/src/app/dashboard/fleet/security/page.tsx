'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface RecentLogin {
  id: string
  username: string
  role: string
  lastLoginAt: string | null
  status: string
  enterprise?: { id: string; name: string; slug: string } | null
}

interface LockedAccount {
  id: string
  username: string
  role: string
  email: string
  enterprise?: { id: string; name: string } | null
}

interface SecurityOverview {
  recentLogins: RecentLogin[]
  lockedAccounts: LockedAccount[]
  lockedCount: number
  totalActiveUsers: number
  recentAuditActions: any[]
}

const ROLE_COLORS: Record<string, string> = {
  PLATFORM_OWNER: '#f59e0b',
  SUPER_ADMIN:    'var(--danger)',
  MANAGER_ADMIN:  'var(--primary)',
  MANAGER:        'var(--accent)',
  CASHIER:        'var(--success)',
}

export default function FleetSecurityPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [data, setData]     = useState<SecurityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<'logins' | 'locked' | 'actions'>('logins')

  useEffect(() => {
    if (!token) return
    api.get<SecurityOverview>('/enterprises/fleet/security', token)
      .then(setData)
      .catch((e: any) => toast.error(e.message || 'Failed to load security overview'))
      .finally(() => setLoading(false))
  }, [token])

  const securityScore = data ? Math.max(0, 100 - (data.lockedCount * 5)) : null

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            🔒 Platform Security Overview
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
            Cross-enterprise login forensics, locked accounts, and platform-level security events
          </p>
        </div>
        <Link href="/dashboard/enterprises" className="btn btn-ghost btn-sm">← Back to Fleet HQ</Link>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading security data...</div>
      ) : (
        <>
          {/* Security KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div className="card" style={{ padding: 20, borderLeft: `4px solid ${securityScore! >= 90 ? 'var(--success)' : securityScore! >= 70 ? 'var(--warning)' : 'var(--danger)'}` }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: securityScore! >= 90 ? 'var(--success)' : securityScore! >= 70 ? 'var(--warning)' : 'var(--danger)' }}>
                {securityScore}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>
                Security Score /100
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--success)' }}>{data?.totalActiveUsers ?? 0}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>Active Users Fleet-wide</div>
            </div>
            <div className="card" style={{ padding: 20, borderLeft: data?.lockedCount ? '4px solid var(--danger)' : undefined }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: data?.lockedCount ? 'var(--danger)' : 'var(--text-primary)' }}>
                {data?.lockedCount ?? 0}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>
                Locked / Inactive Accounts
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--primary)' }}>{data?.recentLogins.length ?? 0}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>Recent Login Events</div>
            </div>
          </div>

          {/* Warning banner if locked accounts exist */}
          {(data?.lockedCount ?? 0) > 0 && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: '1.3rem' }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--danger)' }}>
                  {data?.lockedCount} locked account{data?.lockedCount !== 1 ? 's' : ''} detected across the fleet
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  These may indicate brute-force attempts or policy violations. Review the Locked Accounts tab.
                </div>
              </div>
              <button className="btn btn-sm" style={{ marginLeft: 'auto', color: 'var(--danger)', border: '1px solid var(--danger)', background: 'transparent' }}
                onClick={() => setTab('locked')}>
                View Locked →
              </button>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            {([
              { id: 'logins',  label: `🕒 Recent Logins (${data?.recentLogins.length ?? 0})` },
              { id: 'locked',  label: `🔐 Locked Accounts (${data?.lockedCount ?? 0})` },
              { id: 'actions', label: `📋 Platform Events (${data?.recentAuditActions.length ?? 0})` },
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Recent Logins Tab */}
          {tab === 'logins' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 14px' }}>User</th>
                      <th style={{ padding: '12px 14px' }}>Enterprise</th>
                      <th style={{ padding: '12px 14px' }}>Role</th>
                      <th style={{ padding: '12px 14px' }}>Status</th>
                      <th style={{ padding: '12px 14px' }}>Last Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentLogins ?? []).map((u) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{u.username}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {u.enterprise ? (
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.enterprise.name}</div>
                              <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{u.enterprise.slug}</code>
                            </div>
                          ) : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Platform</span>}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: ROLE_COLORS[u.role] || 'var(--text-muted)' }}>{u.role}</span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{u.status}</span>
                        </td>
                        <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never'}
                        </td>
                      </tr>
                    ))}
                    {(data?.recentLogins ?? []).length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No login data available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Locked Accounts Tab */}
          {tab === 'locked' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 14px' }}>Username</th>
                      <th style={{ padding: '12px 14px' }}>Email</th>
                      <th style={{ padding: '12px 14px' }}>Enterprise</th>
                      <th style={{ padding: '12px 14px' }}>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.lockedAccounts ?? []).map((u) => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--danger)' }}>🔐 {u.username}</td>
                        <td style={{ padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{u.email}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {u.enterprise?.name || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Platform</span>}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: ROLE_COLORS[u.role] || 'var(--text-muted)' }}>{u.role}</span>
                        </td>
                      </tr>
                    ))}
                    {(data?.lockedAccounts ?? []).length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--success)' }}>✅ No locked accounts detected.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Platform Events Tab */}
          {tab === 'actions' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 14px' }}>Timestamp</th>
                      <th style={{ padding: '12px 14px' }}>Action</th>
                      <th style={{ padding: '12px 14px' }}>Actor Role</th>
                      <th style={{ padding: '12px 14px' }}>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentAuditActions ?? []).map((a) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {new Date(a.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--primary)', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                            {a.action}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: '0.78rem', color: ROLE_COLORS[a.actorRole] || 'var(--text-muted)', fontWeight: 600 }}>{a.actorRole}</span>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.ipAddress || '—'}</td>
                      </tr>
                    ))}
                    {(data?.recentAuditActions ?? []).length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No platform events recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
