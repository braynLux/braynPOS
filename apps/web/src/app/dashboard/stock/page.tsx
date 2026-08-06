'use client'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { api, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import Link from 'next/link'
import { StockAdjustmentModal } from '@/components/shared/StockAdjustmentModal'
import { OpeningStockAgreement } from '@/components/shared/OpeningStockAgreement'
import { ExportMenu } from '@/components/shared/ExportMenu'

interface StockBalance {
  itemId: string
  itemName?: string
  sku?: string
  category?: string
  availableQty: number
  incomingQty: number
  reservedQty?: number
  reorderLevel?: number
  lastMovementAt?: string
}
interface Channel { id: string; name: string; featureFlags?: { openingStockWindowActive?: boolean } }

export default function StockPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<{id: string; name: string}[]>([])
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [lowStock, setLowStock] = useState<StockBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all'|'low'>('all')
  const [adjustingItem, setAdjustingItem] = useState<StockBalance | null>(null)
  
  const [globalWindowActive, setGlobalWindowActive] = useState(false)
  const [hasAgreed, setHasAgreed] = useState(false)
  const [globalThreshold, setGlobalThreshold] = useState<number | null>(null)
  
  const isAdmin = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')

  const fetchData = () => {
    if (!token) return
    setLoading(true)
    const chanParam = selectedChannel ? `channelId=${selectedChannel}` : ''
    const catParam  = categoryId ? `categoryId=${categoryId}` : ''
    const query     = [chanParam, catParam].filter(Boolean).join('&')
    const urlSuffix = query ? `?${query}` : ''

    Promise.all([
      api.get<StockBalance[]>(`/stock/balances${urlSuffix}`, token),
      api.get<StockBalance[]>(`/stock/low-stock${urlSuffix}`, token),
    ])
      .then(([b, ls]) => {
        setBalances(Array.isArray(b) ? b : [])
        setLowStock(Array.isArray(ls) ? ls : [])
      })
      .catch(err => {
        const msg = (err as Error).message
        if ((err as any).status === 403) {
          toast.error('Access Restricted: HQ clearance required for this view.', { id: 'security-block', icon: '🛡️' })
        } else {
          toast.error('Failed to load stock: ' + msg)
        }
      })
      .finally(() => setLoading(false))
  }

  const getExportData = async () => {
    return filtered.map(b => [
        b.itemName || b.itemId,
        b.sku || '—',
        b.category || '—',
        b.availableQty,
        b.incomingQty,
        b.reservedQty || 0,
        b.reorderLevel || '—',
        stockStatus(b).label,
        b.lastMovementAt ? new Date(b.lastMovementAt).toLocaleString() : '—'
    ])
  }

  useEffect(() => {
    if (!token) return
    api.get<Channel[]>('/channels', token)
      .then(res => {
        const chs = Array.isArray(res) ? res : [res as unknown as Channel]
        setChannels(chs)
        const ch = user?.channelId || (chs.length > 0 ? chs[0].id : '')
        if (!selectedChannel) setSelectedChannel(ch)
      })
      .catch(console.error)

    api.get<{id: string; name: string}[]>('/items/categories', token)
      .then(res => setCategories(res))
      .catch(console.error)
  }, [token, user?.channelId])

  useEffect(() => {
    const fetchGlobal = async () => {
      try {
        const res = await api.get<Record<string, any>>('/dashboard/settings', token as string)
        setGlobalThreshold(res.notifSettings?.lowStockThreshold ?? 5)
        const agreed = localStorage.getItem(`opening_stock_agreed_${(user as any)?.id}`) === 'true'
        setHasAgreed(agreed)
      } catch (err) { console.error(err) }
    }

    const syncOpeningStockState = () => {
      const chan = channels.find(c => c.id === selectedChannel)
      setGlobalWindowActive(!!chan?.featureFlags?.openingStockWindowActive)
    }
    
    fetchData()
    fetchGlobal()
    syncOpeningStockState()
  }, [token, selectedChannel, categoryId, user?.id, channels])

  const fmt = (n: unknown) => Number(n ?? 0).toLocaleString()
  const source   = tab === 'low' ? lowStock : balances
  const filtered = source.filter(b => {
    const q = search.toLowerCase()
    return !q || (b.itemName || '').toLowerCase().includes(q) || (b.sku || '').toLowerCase().includes(q) || b.itemId.toLowerCase().includes(q)
  })

  const stockStatus = (b: StockBalance) => {
    if (b.availableQty <= 0) return { label: 'Out of Stock', cls: 'badge-danger', color: 'var(--danger)' }
    const threshold = globalThreshold ?? 5
    if (b.availableQty <= threshold) return { label: 'Critical Stock', cls: 'badge-danger', color: 'var(--danger)' }
    if (b.reorderLevel && b.availableQty <= b.reorderLevel) return { label: 'Reorder Suggested', cls: 'badge-warning', color: 'var(--warning)' }
    return { label: 'In Stock', cls: 'badge-success', color: 'inherit' }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Stock Levels</h1>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ExportMenu 
            title="Stock_Levels_Report"
            headers={['Item', 'SKU', 'Category', 'Available', 'Incoming', 'Reserved', 'Reorder At', 'Status', 'Last Movement']}
            getData={getExportData}
          />
          <Link href="/dashboard/stock/take" className="btn btn-ghost">📊 Physical Counts</Link>
          {isAdmin && (
            <select 
              className="input" 
              style={{ width: 140 }} 
              value={selectedChannel} 
              onChange={e => setSelectedChannel(e.target.value)}
            >
              <option value="">All Channels</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select 
            className="input" 
            style={{ width: 140 }} 
            value={categoryId} 
            onChange={e => setCategoryId(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {globalWindowActive && (
        <OpeningStockAgreement 
          isAgreed={hasAgreed} 
          onAgree={() => {
            setHasAgreed(true)
            localStorage.setItem(`opening_stock_agreed_${user?.id}`, 'true')
          }} 
        />
      )}

      {/* Summary Stats */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-value">{balances.length}</div>
          <div className="stat-label">Total Items</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            {balances.filter(b => b.availableQty > 0 && b.availableQty <= (globalThreshold ?? 5)).length}
          </div>
          <div className="stat-label">Low Stock Alerts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--warning)' }}>
            {balances.filter(b => b.availableQty > (globalThreshold ?? 5) && b.availableQty <= (b.reorderLevel ?? 0)).length}
          </div>
          <div className="stat-label">Suggested Reorders</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            {balances.filter(b => b.availableQty <= 0).length}
          </div>
          <div className="stat-label">Out of Stock</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{balances.reduce((s, b) => s + b.availableQty, 0)}</div>
          <div className="stat-label">Total Units</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('all')}>All Stock</button>
        <button className={`btn ${tab === 'low' ? 'btn-warning' : 'btn-ghost'}`} onClick={() => setTab('low')}>Attention Required ({lowStock.length})</button>
      </div>

      {/* Search */}
      <input className="input" placeholder="🔍 Search by item name or SKU..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, maxWidth: 360 }} />

      <div className="card">
        {loading ? <div style={{ padding: 40, textAlign: 'center' }}>Loading stock data...</div> : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Category</th>
                <th style={{ textAlign: 'center' }}>Available</th>
                <th style={{ textAlign: 'center' }}>Incoming</th>
                <th style={{ textAlign: 'center' }}>Reserved</th>
                <th style={{ textAlign: 'center' }}>Reorder At</th>
                <th>Status</th>
                <th>Last Movement</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                    No stock data found.
                  </td>
                </tr>
              ) : filtered.map((b, i) => {
                const s = stockStatus(b)
                return (
                  <tr key={b.itemId + i}>
                    <td><strong>{b.itemName || b.itemId}</strong></td>
                    <td><code>{b.sku || '—'}</code></td>
                    <td>{b.category || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: s.color }}>
                      {fmt(b.availableQty)}
                    </td>
                    <td style={{ textAlign: 'center', color: b.incomingQty > 0 ? 'var(--info)' : 'inherit' }}>
                      {fmt(b.incomingQty)}
                    </td>
                    <td style={{ textAlign: 'center' }}>{fmt(b.reservedQty)}</td>
                    <td style={{ textAlign: 'center' }}>{b.reorderLevel ?? '—'}</td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {b.lastMovementAt ? new Date(b.lastMovementAt).toLocaleString() : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER'].includes(user?.role || '') && (
                        <button className="btn btn-ghost btn-sm" onClick={() => selectedChannel ? setAdjustingItem(b) : toast.error('Select a channel before adjusting stock')} style={{ marginRight: 4 }}>⚙️ Adjust</button>
                      )}
                      {globalWindowActive && hasAgreed && (
                        <button 
                          className="btn btn-ghost btn-sm" 
                          onClick={() => {
                            // This would be replaced with actual initialStock logic
                            // But for now we allow adjustment as opening stock if authorised
                            selectedChannel ? setAdjustingItem(b) : toast.error('Select a channel before opening stock')
                          }}
                          style={{ color: 'var(--accent)' }}
                        >📥 Opening</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {adjustingItem && (
        <StockAdjustmentModal 
          item={adjustingItem}
          channelId={selectedChannel}
          isOpen={!!adjustingItem}
          onClose={() => setAdjustingItem(null)}
          onSuccess={fetchData}
        />
      )}
    </div>
  )
}
