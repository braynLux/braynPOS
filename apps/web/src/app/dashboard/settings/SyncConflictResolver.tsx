'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'react-hot-toast'

interface SyncConflict {
  id: string
  type: 'SERIAL_COLLISION' | 'INVENTORY_MISMATCH' | 'LOYALTY_ERROR'
  errorMessage: string
  totalAmount: number
  status: 'PENDING' | 'RESOLVED' | 'VOIDED'
  salePayload: any
  createdAt: string
}

export function SyncConflictResolver() {
  const token = useAuthStore((s) => s.accessToken)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (token) fetchConflicts()
  }, [token])

  const fetchConflicts = async () => {
    setLoading(true)
    try {
      const channelId = useAuthStore.getState().user?.channelId
      const url = `/sales/conflicts${channelId ? `?channelId=${channelId}` : ''}`
      const data = await api.get<SyncConflict[]>(url, token!)
      setConflicts(data)
    } catch (err) {
      toast.error('Failed to load sync conflicts')
    } finally {
      setLoading(false)
    }
  }

  const handleResolve = async (id: string, action: 'FORCE_SYNC' | 'VOID') => {
    if (!notes.trim()) {
      toast.error('A resolution note is mandatory for overrides.')
      return
    }

    setResolvingId(id)
    try {
      await api.post(`/sales/conflicts/${id}/resolve`, { action, notes }, token!)
      toast.success(action === 'FORCE_SYNC' ? 'Sale force-synced successfully' : 'Sale voided')
      setNotes('')
      fetchConflicts()
    } catch (err: any) {
      toast.error(err.message || 'Resolution failed')
    } finally {
      setResolvingId(null)
    }
  }

  if (loading) return <div className="p-8 text-center">Loading conflicts...</div>

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0 }}>🛡️ Offline Sync Conflicts</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
            These sales occurred offline but cannot be automatically reconciled due to integrity rules.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchConflicts}>🔄 Refresh</button>
      </div>

      {conflicts.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px dashed var(--border)' }}>
          <span style={{ fontSize: '2rem' }}>✅</span>
          <p style={{ marginTop: 12, fontWeight: 600 }}>No pending conflicts</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>All offline data is perfectly in sync.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Occurred</th>
                <th>Type</th>
                <th>Issue</th>
                <th>Amount</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map(c => (
                <tr key={c.id}>
                  <td style={{ fontSize: '0.85rem' }}>
                    {new Date(c.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <span className={`badge ${c.type === 'SERIAL_COLLISION' ? 'badge-warning' : 'badge-danger'}`}>
                      {c.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.errorMessage}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      Receipt: {c.salePayload?.offlineReceiptNo || 'N/A'}
                    </div>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'KES' }).format(c.totalAmount)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input 
                        className="input input-sm" 
                        placeholder="Mandatory reason..."
                        value={resolvingId === c.id ? notes : ''}
                        onChange={(e) => {
                          setResolvingId(c.id)
                          setNotes(e.target.value)
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button 
                          className="btn btn-primary btn-xs"
                          disabled={resolvingId === c.id && !notes}
                          onClick={() => handleResolve(c.id, 'FORCE_SYNC')}
                        >
                          Force Sync
                        </button>
                        <button 
                          className="btn btn-ghost btn-xs"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => handleResolve(c.id, 'VOID')}
                        >
                          Void
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, background: 'rgba(245,158,11,0.05)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.85rem' }}>
        <strong>💡 Manager Note:</strong> 
        &quot;Force Sync&quot; trusts the physical sale over the digital count. It will bypass stock checks and serial availability to ensure financial records match physical reality, automatically creating a forensic audit trail of the override.
      </div>
    </div>
  )
}
