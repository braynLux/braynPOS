'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface AuditLog {
  id: string
  enterpriseId: string | null
  action: string
  actorId: string
  actorRole: string
  targetType: string | null
  targetId: string | null
  oldValues: any
  newValues: any
  ipAddress: string | null
  createdAt: string
  enterprise?: { id: string; name: string; slug: string } | null
}

const ACTION_COLORS: Record<string, string> = {
  CREATE:     'var(--success)',
  UPDATE:     'var(--primary)',
  DELETE:     'var(--danger)',
  LOGIN:      'var(--accent)',
  SALE_VOID:  'var(--warning)',
  SUSPEND:    'var(--danger)',
  REACTIVATE: 'var(--success)',
}

function actionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color
  }
  return 'var(--text-muted)'
}

export default function FleetAuditPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [logs, setLogs]       = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterAction,     setFilterAction]     = useState('')

  useEffect(() => {
    if (!token) return
    // Use the existing audit route but without enterprise scoping (PLATFORM_OWNER)
    api.get<AuditLog[]>('/audit?limit=100', token)
      .then((res) => setLogs(Array.isArray(res) ? res : (res as any).logs ?? []))
      .catch((e: any) => toast.error(e.message || 'Failed to load audit trail'))
      .finally(() => setLoading(false))
  }, [token])

  const enterprises = Array.from(new Set(logs.map((l) => l.enterprise?.name).filter(Boolean))) as string[]
  const actions     = Array.from(new Set(logs.map((l) => l.action))).slice(0, 30)

  const filtered = logs.filter((l) => {
    if (filterEnterprise && l.enterprise?.name !== filterEnterprise) return false
    if (filterAction     && !l.action.includes(filterAction.toUpperCase())) return false
    return true
  })

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            📜 Fleet Audit Trail
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
            Cross-enterprise audit log — all tenant actions in one view
          </p>
        </div>
        <Link href="/dashboard/enterprises" className="btn btn-ghost btn-sm">← Back to Fleet HQ</Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="select"
          value={filterEnterprise}
          onChange={(e) => setFilterEnterprise(e.target.value)}
          style={{ minWidth: 180, fontSize: '0.85rem' }}
        >
          <option value="">All Enterprises</option>
          {enterprises.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input
          className="input"
          placeholder="Filter by action…"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          style={{ minWidth: 200, fontSize: '0.85rem' }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {filtered.length} of {logs.length} entries
        </span>
      </div>

      {/* Audit Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading audit trail...</div>
          ) : (
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 14px' }}>Timestamp</th>
                  <th style={{ padding: '12px 14px' }}>Enterprise</th>
                  <th style={{ padding: '12px 14px' }}>Action</th>
                  <th style={{ padding: '12px 14px' }}>Actor Role</th>
                  <th style={{ padding: '12px 14px' }}>Target</th>
                  <th style={{ padding: '12px 14px' }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {log.enterprise ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{log.enterprise.name}</div>
                          <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{log.enterprise.slug}</code>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Platform</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontWeight: 700, fontSize: '0.75rem',
                        color: actionColor(log.action),
                        background: `${actionColor(log.action)}18`,
                        padding: '2px 8px', borderRadius: 4,
                      }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className="badge" style={{ fontSize: '0.7rem' }}>{log.actorRole}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      {log.targetType ? `${log.targetType}${log.targetId ? ` #${log.targetId.slice(0, 8)}` : ''}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {log.ipAddress || '—'}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No audit logs found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
