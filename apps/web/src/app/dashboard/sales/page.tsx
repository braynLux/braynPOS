'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { toast } from 'react-hot-toast'

interface Sale {
  id: string; receiptNo: string; saleType: string; totalAmount: unknown; netAmount: unknown;
  paidAmount: unknown; status: string; createdAt: string;
  customer?: { id: string; name: string; phone?: string }
  channel?: { name: string }
  payments?: { method: string; amount: unknown }[]
  items?: { quantity: number; unitPrice: unknown; item?: { name: string } }[]
}

const saleTypeColor: Record<string, string> = {
  RETAIL: 'badge-primary', WHOLESALE: 'badge-info', CREDIT: 'badge-warning',
  PRE_ORDER: 'badge-secondary', LAYAWAY: 'badge-secondary'
}

export default function SalesPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  
  const [sales, setSales] = useState<Sale[]>([])
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [stats, setStats] = useState({ totalRevenue: 0, totalNet: 0, totalMargin: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [saleType, setSaleType] = useState('')
  const today = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [channelId, setChannelId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [performedBy, setPerformedBy] = useState('')
  const [users, setUsers] = useState<{ id: string; username: string }[]>([])
  const [mySalesOnly, setMySalesOnly] = useState(false)
  
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reversalModal, setReversalModal] = useState<Sale | null>(null)
  const [adminPass, setAdminPass] = useState('')
  const [reversing, setReversing] = useState(false)

  const isHigherRole = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(user?.role || '')
  const canFilterChannels = ['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '')

  const buildQuery = (p: number, limit: string = '25') => {
    const params = new URLSearchParams({ limit, page: String(p) })
    if (saleType) params.set('saleType', saleType)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (channelId) params.set('channelId', channelId)
    if (paymentMethod) params.set('paymentMethod', paymentMethod)
    
    if (performedBy) {
      params.set('performedBy', performedBy)
    } else if (mySalesOnly && user?.id) {
      params.set('performedBy', user.id)
    }
    return params
  }

  const fetchSales = async (p = 1) => {
    if (!token) return
    setLoading(true)
    const params = buildQuery(p)

    try {
      const res = await api.get<{ data: Sale[]; meta: typeof meta; stats: typeof stats }>(`/sales?${params}`, token)
      setSales(res.data)
      setMeta(res.meta)
      if (res.stats) setStats(res.stats)
    } catch (e) { 
      console.error('[Sales Fetch Error]:', e)
      if ((e as any).status === 403) {
        toast.error('Access Restricted: HQ clearance required for global sales history.', { id: 'security-block', icon: '🛡️' })
      } else {
        toast.error('Failed to load sales.')
      }
    }
    finally { setLoading(false) }
  }

  const getExportData = async () => {
    const allSales: Sale[] = []
    let currentPage = 1
    let totalPages = 1

    // Fetch all records in batches of 100 (backend max)
    do {
      const params = buildQuery(currentPage, '100')
      const res = await api.get<{ data: Sale[]; meta: { totalPages: number } }>(`/sales?${params}`, token!)
      allSales.push(...res.data)
      totalPages = res.meta.totalPages
      currentPage++
    } while (currentPage <= totalPages)

    return allSales.map(sale => [
      sale.receiptNo,
      sale.saleType,
      fmtDateTime(sale.createdAt),
      sale.customer?.name || 'Walk-in',
      sale.items?.reduce((sum, i) => sum + i.quantity, 0) || 0,
      sale.totalAmount,
      sale.payments?.map(p => p.method).join(', ') || '—',
      sale.channel?.name || '—'
    ])
  }

  const fetchChannels = async () => {
    try {
      const res = await api.get<{ id: string, name: string }[]>('/channels', token!)
      setChannels(res)
    } catch (e) { console.error(e) }
  }

  const fetchUsers = async () => {
    if (!isHigherRole) return
    try {
      const res = await api.get<{ data: { id: string, username: string }[] }>('/users', token!)
      setUsers(res.data)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { 
    if (token) {
      if (canFilterChannels) fetchChannels()
      fetchUsers()
    }
  }, [token])

  useEffect(() => { fetchSales(page) }, [token, page, saleType, startDate, endDate, channelId, paymentMethod, performedBy, mySalesOnly])

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(n ?? 0))
  const fmtDateTime = (d: string) => {
    const dt = new Date(d)
    return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const handleReversal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reversalModal || !adminPass) return
    setReversing(true)
    try {
      await api.post(`/sales/${reversalModal.id}/reverse`, { password: adminPass }, token!)
      toast.success('Sale reversed successfully!')
      setReversalModal(null)
      setAdminPass('')
      fetchSales(page)
    } catch (err) {
      const msg = (err as Error).message
      if ((err as any).status === 403) {
        toast.error('Invalid manager password or insufficient permissions.', { icon: '🛡️' })
      } else {
        toast.error('Reversal failed: ' + msg)
      }
    }
    finally { setReversing(false) }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1>{isHigherRole ? 'Sales History' : 'My Sales Record'}</h1>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ExportMenu 
            title="Sales Report"
            headers={['Receipt No', 'Type', 'Date', 'Customer', 'Items Sold', 'Total Amount', 'Payments', 'Channel']}
            getData={getExportData}
          />
          {user?.role === 'MANAGER' && (
            <button 
              className={`btn ${mySalesOnly ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => { setMySalesOnly(!mySalesOnly); setPage(1); setPerformedBy('') }}
            >
              {mySalesOnly ? '✓ My Sales' : 'All Channel Sales'}
            </button>
          )}
          <Link href="/dashboard/sales/returns" className="btn btn-ghost">↩️ Returns</Link>
          <Link href="/dashboard/pos" className="btn btn-primary">+ New Sale</Link>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Total Revenue</div>
          <div className="stat-value" style={{ color: 'var(--primary)' }}>{fmt(stats.totalRevenue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sales Count</div>
          <div className="stat-value">{meta.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg. Sale</div>
          <div className="stat-value">{fmt(meta.total > 0 ? stats.totalRevenue / meta.total : 0)}</div>
        </div>
        {isHigherRole && (
          <div className="stat-card">
            <div className="stat-label">Net Margin</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{fmt(stats.totalMargin)}</div>
          </div>
        )}
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, padding: '14px 20px', marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Filter Staff</label>
          <select 
            className="input" 
            value={performedBy} 
            onChange={e => { setPerformedBy(e.target.value); setMySalesOnly(false); setPage(1) }}
            disabled={!isHigherRole}
          >
            <option value="">{isHigherRole ? 'All Users' : user?.username || 'Me'}</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label>Type</label>
          <select className="input" value={saleType} onChange={e => { setSaleType(e.target.value); setPage(1) }}>
            <option value="">All Types</option>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="CREDIT">Credit</option>
            <option value="PRE_ORDER">Pre-Order</option>
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label>Payment</label>
          <select className="input" value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setPage(1) }}>
            <option value="">All Payments</option>
            <option value="CASH">Cash</option>
            <option value="MOBILE_MONEY">M-Pesa</option>
            <option value="CARD">Card</option>
            <option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="LOYALTY_POINTS">Loyalty Points</option>
            <option value="CREDIT">Credit</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>From Date</label>
          <input type="date" className="input" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1) }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>To Date</label>
          <input type="date" className="input" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1) }} />
        </div>
        
        {canFilterChannels && (
          <div className="form-group" style={{ margin: 0 }}>
            <label>Channel</label>
            <select className="input" value={channelId} onChange={e => { setChannelId(e.target.value); setPage(1) }}>
              <option value="">All Channels</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {(saleType || startDate !== today || endDate !== today || channelId || paymentMethod || performedBy || mySalesOnly) && (
          <button className="btn btn-ghost" onClick={() => { 
            setSaleType(''); setStartDate(today); setEndDate(today); setChannelId(''); setPaymentMethod(''); setPerformedBy(''); setMySalesOnly(false); setPage(1) 
          }}>Clear Filters</button>
        )}
      </div>

      <div className="card">
        {loading ? <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div> : (
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th><th>Type</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Date & Time</th><th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No sales found.</td></tr>
              ) : sales.map(sale => (
                <React.Fragment key={sale.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}>
                    <td><strong>{sale.receiptNo}</strong></td>
                    <td><span className={`badge ${saleTypeColor[sale.saleType] || 'badge-secondary'}`}>{sale.saleType}</span></td>
                    <td>{sale.customer?.name || '—'}</td>
                    <td>{sale.items?.length || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(sale.totalAmount)}</td>
                    <td style={{ fontSize: '0.8rem' }}>{sale.payments?.map(p => p.method).join(', ') || '—'}</td>
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{fmtDateTime(sale.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isHigherRole && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={e => { e.stopPropagation(); setReversalModal(sale) }}>↩ Reverse</button>
                      )}
                    </td>
                  </tr>
                  {expandedId === sale.id && (
                    <tr style={{ backgroundColor: 'var(--bg-elevated)' }}>
                      <td colSpan={8} style={{ padding: '12px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <div>
                            <strong style={{ display: 'block', marginBottom: 8 }}>Items Sold</strong>
                            {sale.items?.map((line, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}>
                                <span>{line.item?.name} × {line.quantity}</span>
                                <span>{fmt(Number(line.unitPrice) * line.quantity)}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <strong style={{ display: 'block', marginBottom: 8 }}>Payment Details</strong>
                            {sale.payments?.map((p, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}>
                                <span>{p.method}</span><span>{fmt(p.amount)}</span>
                              </div>
                            ))}
                            {sale.customer && <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Customer: {sale.customer.name} {sale.customer.phone ? `· ${sale.customer.phone}` : ''}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {meta.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Page {page} of {meta.totalPages}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages}>Next →</button>
        </div>
      )}

      {reversalModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 420 }}>
            <h3 style={{ color: 'var(--danger)' }}>↩ Reverse Sale</h3>
            <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>You are reversing sale <strong>{reversalModal.receiptNo}</strong> ({fmt(reversalModal.totalAmount)}). This requires admin authorization.</p>
            <form onSubmit={handleReversal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label>Admin Password *</label>
                <input type="password" className="input" value={adminPass} onChange={e => setAdminPass(e.target.value)} required placeholder="Enter admin password to confirm" autoFocus />
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--warning)' }}>⚠️ This action creates a credit note and reverses inventory. It cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => { setReversalModal(null); setAdminPass('') }}>Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={reversing}>{reversing ? 'Processing...' : '↩ Confirm Reversal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
