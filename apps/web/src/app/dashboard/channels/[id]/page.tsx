'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Channel { id: string; name: string; code: string; type: string; address?: string; phone?: string; isMainWarehouse: boolean; featureFlags?: Record<string, any> }
interface User {
  id: string; username: string; email: string; role: string; isActive: boolean; createdAt: string
  staffProfile?: { grossSalary: unknown; hireDate: string }
}
interface StockBalance { itemId: string; itemName?: string; sku?: string; availableQty: number; weightedAvgCost?: number }
interface SalesSummary { sales: { count: number; netAmount: number }; expenses: { totalAmount: number }; profit: number }
interface StaffPerformance { userId: string; revenue: number; margin: number; marginPercent: number }

const PERIODS = [
  { label: 'Today', startDate: () => new Date().toISOString().slice(0, 10), endDate: () => new Date().toISOString().slice(0, 10) },
  { label: 'This Week', startDate: () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10) }, endDate: () => new Date().toISOString().slice(0, 10) },
  { label: 'This Month', startDate: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }, endDate: () => new Date().toISOString().slice(0, 10) },
]

export default function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [stock, setStock] = useState<StockBalance[]>([])
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [performance, setPerformance] = useState<StaffPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(2) // default: this month
  const [tab, setTab] = useState<'overview'|'stock'|'users'|'sales'>('overview')
  const [editingSalaryFor, setEditingSalaryFor] = useState<string | null>(null)
  const [newSalaryValue, setNewSalaryValue] = useState('')
  const [savingSalary, setSavingSalary] = useState(false)

  const fetchSummary = async (p: number) => {
    if (!token || !id) return
    try {
      const { startDate, endDate } = PERIODS[p]
      const [sRes, pRes] = await Promise.all([
        api.get<SalesSummary>(`/reports/sales-summary?channelId=${id}&startDate=${startDate()}&endDate=${endDate()}`, token!),
        api.get<{ performance: StaffPerformance[] }>(`/reports/staff-performance?channelId=${id}&startDate=${startDate()}&endDate=${endDate()}`, token!)
      ])
      setSummary(sRes)
      setPerformance(pRes.performance || [])
    } catch (e) {
      console.error(e)
      setSummary(null)
      setPerformance([])
    }
  }

  useEffect(() => {
    if (!token || !id) return
    setLoading(true)
    setChannel(null)
    setSummary(null)
    setPerformance([])
    setUsers([])
    setStock([])
    
    // Core channel fetch
    api.get<Channel>(`/channels/${id}`, token)
      .then(setChannel)
      .catch(err => {
        console.error('Channel fetch failed:', err)
      })
      .finally(() => setLoading(false))

    // Supplementary data (graceful failure)
    api.get<{ data: User[] }>(`/users?channelId=${id}&limit=50`, token)
      .then(uRes => setUsers(uRes.data ?? []))
      .catch(err => console.error('Users fetch failed:', err))

    api.get<StockBalance[]>(`/stock/balances?channelId=${id}`, token)
      .then(st => setStock(Array.isArray(st) ? st : []))
      .catch(err => console.error('Stock fetch failed:', err))

    fetchSummary(period)
  }, [token, id])

  useEffect(() => { fetchSummary(period) }, [period, id])

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))
  const totalItems = stock.length
  const totalUnits = stock.reduce((s, b) => s + b.availableQty, 0)
  const lowStockCount = stock.filter(b => b.availableQty <= 5).length

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}>Loading channel details...</div>
  if (!channel) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--danger)' }}>Channel not found.</div>

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => router.back()}>←</button>
          <div>
            <h1 style={{ margin: 0 }}>{channel.name}</h1>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{channel.type} · Code: {channel.code}</span>
          </div>
          {channel.isMainWarehouse && <span className="badge badge-success">Main Warehouse</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Period:</label>
          <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {PERIODS.map((p, i) => (
              <button key={i} onClick={() => setPeriod(i)}
                style={{ padding: '6px 14px', background: period === i ? 'var(--accent)' : 'transparent', color: period === i ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: '0.82rem' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Key Stats */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value">{users.filter(u => u.isActive).length}</div>
          <div className="stat-label">Active Staff</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalItems}</div>
          <div className="stat-label">Item SKUs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary?.sales?.netAmount)}</div>
          <div className="stat-label">Net Revenue ({PERIODS[period].label})</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary?.sales?.count ?? 0}</div>
          <div className="stat-label">Sales ({PERIODS[period].label})</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: Number(summary?.profit ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {fmt(summary?.profit)}
          </div>
          <div className="stat-label">Net Profit</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: lowStockCount > 0 ? 'var(--warning)' : 'inherit' }}>{lowStockCount}</div>
          <div className="stat-label">Low Stock Items</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['overview', 'stock', 'users', 'sales'] as const).map(t => (
          <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}>
            {t === 'overview' ? '📊 Overview' : t === 'stock' ? '📦 Inventory' : t === 'users' ? '👥 Staff' : '🧾 Sales'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 16 }}>🏪 Channel Info</h3>
            <table style={{ width: '100%', fontSize: '0.9rem' }}>
              <tbody>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Name</td><td><strong>{channel.name}</strong></td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Code</td><td><code>{channel.code}</code></td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Type</td><td>{channel.type}</td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Address</td><td>{channel.address || '—'}</td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Phone</td><td>{channel.phone || '—'}</td></tr>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ paddingTop: 12, color: 'var(--text-muted)' }}>Inventory Settings</td>
                  <td style={{ paddingTop: 12 }}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={!!channel.featureFlags?.openingStockWindowActive} 
                        onChange={async (e) => {
                          const active = e.target.checked
                          try {
                            const newFlags = { ...channel.featureFlags, openingStockWindowActive: active }
                            await api.patch(`/channels/${channel.id}`, { featureFlags: newFlags }, token!)
                            setChannel({ ...channel, featureFlags: newFlags })
                            toast.success(`Opening Stock Window ${active ? 'Enabled' : 'Disabled'}`)
                          } catch (err) {
                            toast.error('Failed to update window: ' + (err as Error).message)
                          }
                        }} 
                      />
                      <span style={{ fontWeight: 600 }}>Opening Stock Window Active</span>
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Allows managers to input initial stock without accounting impact.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 16 }}>💰 Financial Summary ({PERIODS[period].label})</h3>
            <table style={{ width: '100%', fontSize: '0.9rem' }}>
              <tbody>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Sales Count</td><td><strong>{summary?.sales?.count ?? 0}</strong></td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Net Revenue</td><td><strong style={{ color: 'var(--success)' }}>{fmt(summary?.sales?.netAmount)}</strong></td></tr>
                <tr><td style={{ color: 'var(--text-muted)', paddingBottom: 8 }}>Expenses</td><td style={{ color: 'var(--danger)' }}>{fmt(summary?.expenses?.totalAmount)}</td></tr>
                <tr style={{ borderTop: '1px solid var(--border)' }}><td style={{ paddingTop: 8, color: 'var(--text-muted)' }}>Net Profit</td><td style={{ paddingTop: 8, fontWeight: 700, color: Number(summary?.profit ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(summary?.profit)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{totalItems} items · {totalUnits} total units</strong>
              {lowStockCount > 0 && <span style={{ marginLeft: 12, color: 'var(--warning)', fontSize: '0.85rem' }}>⚠️ {lowStockCount} low stock</span>}
            </div>
            <div style={{ textAlign: 'right' }}>
               <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>STOCK VALUATION:</span>
               <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent)' }}>
                 {fmt(stock.reduce((acc, b) => acc + (b.availableQty * (b.weightedAvgCost ?? 0)), 0))}
               </div>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Item</th><th>SKU</th><th style={{ textAlign: 'center' }}>Available Qty</th><th style={{ textAlign: 'right' }}>Avg. Cost</th><th style={{ textAlign: 'right' }}>Valuation</th><th>Status</th></tr></thead>
            <tbody>
              {stock.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No inventory data.</td></tr>
              ) : stock.map((b, i) => (
                <tr key={b.itemId + i}>
                  <td><strong>{b.itemName || b.itemId}</strong></td>
                  <td><code>{b.sku || '—'}</code></td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: b.availableQty <= 0 ? 'var(--danger)' : b.availableQty <= 5 ? 'var(--warning)' : 'inherit' }}>{b.availableQty}</td>
                  <td style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{fmt(b.weightedAvgCost)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(b.availableQty * (b.weightedAvgCost ?? 0))}</td>
                  <td><span className={`badge ${b.availableQty <= 0 ? 'badge-danger' : b.availableQty <= 5 ? 'badge-warning' : 'badge-success'}`}>{b.availableQty <= 0 ? 'Out of Stock' : b.availableQty <= 5 ? 'Low Stock' : 'OK'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Staff Member</th><th>Position</th><th>Employed On</th><th>Salary</th><th>Sales (period)</th><th>Status</th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No staff assigned to this channel.</td></tr>
              ) : users.map(u => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                  </td>
                  <td><span className="badge badge-primary">{u.role.replace('_', ' ')}</span></td>
                  <td>{new Date(u.staffProfile?.hireDate || u.createdAt).toLocaleDateString()}</td>
                  <td>
                    {editingSalaryFor === u.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          className="input"
                          style={{ width: 100, padding: '4px 8px' }}
                          value={newSalaryValue}
                          onChange={e => setNewSalaryValue(e.target.value)}
                          autoFocus
                        />
                        <button className="btn btn-success btn-sm" disabled={savingSalary} onClick={async () => {
                          setSavingSalary(true)
                          try {
                            await api.patch(`/users/${u.id}/salary`, { grossSalary: Number(newSalaryValue) }, token!)
                            setUsers(users.map(user => user.id === u.id ? { ...user, staffProfile: { ...user.staffProfile, grossSalary: Number(newSalaryValue), hireDate: user.staffProfile?.hireDate || new Date().toISOString() } } as any : user))
                            setEditingSalaryFor(null)
                            toast.success('Salary updated successfully')
                          } catch (e) { toast.error('Failed to update salary: ' + (e as Error).message) }
                          finally { setSavingSalary(false) }
                        }}>✓</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingSalaryFor(null)}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{u.staffProfile?.grossSalary ? fmt(u.staffProfile.grossSalary) : '—'}</span>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem' }} onClick={() => { setEditingSalaryFor(u.id); setNewSalaryValue(String(u.staffProfile?.grossSalary || '')) }}>✎</button>
                      </div>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const perf = performance.find(p => p.userId === u.id)
                      return (
                        <>
                          <div style={{ fontWeight: 600, color: 'var(--success)' }}>{fmt(perf?.revenue || 0)}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Margin: {Math.round(perf?.marginPercent || 0)}%</div>
                        </>
                      )
                    })()}
                  </td>
                  <td>{u.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 16 }}>* Sales and margins per staff member are estimated for the current period.</p>
        </div>
      )}

      {tab === 'sales' && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-muted)' }}>View detailed sales for this channel in the <Link href="/dashboard/sales" style={{ color: 'var(--accent)' }}>Sales History</Link> section with channel filter.</p>
        </div>
      )}
    </div>
  )
}
