'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Invoice {
  id: string; invoiceNo: string; type: string; status: string
  totalAmount: unknown; amountPaid: unknown; createdAt: string; dueDate?: string
  customer?: { id: string; name: string; phone?: string }
  channel?: { id: string; name: string }
  _count?: { lines: number }
}
interface Channel { id: string; name: string }

const typeLabel: Record<string, string> = { QUOTATION: 'Quotation', PROFORMA: 'Proforma', INVOICE: 'Invoice' }
const typeBadge: Record<string, string> = { QUOTATION: 'badge-info', PROFORMA: 'badge-warning', INVOICE: 'badge-success' }
const statusBadge: Record<string, string> = {
  DRAFT: 'badge-info', SENT: 'badge-warning', PARTIALLY_PAID: 'badge-warning',
  PAID: 'badge-success', VOID: 'badge-danger',
}

export default function InvoicingPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('')

  const fetchAll = async (p = 1) => {
    if (!token) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '20', page: p.toString() })
      if (search) params.append('search', search)
      if (type) params.append('type', type)
      if (status) params.append('status', status)
      if (selectedChannel) params.append('channelId', selectedChannel)

      const [iRes, cRes] = await Promise.all([
        api.get<{ data: Invoice[]; meta: typeof meta }>(`/invoices?${params.toString()}`, token),
        canChooseChannel ? api.get<Channel[]>('/channels', token) : Promise.resolve([]),
      ])
      setInvoices(iRes.data ?? [])
      setMeta(iRes.meta ?? { total: 0, page: 1, totalPages: 1 })
      setChannels(Array.isArray(cRes) ? cRes : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchAll(page) }, [token, page])
  useEffect(() => { setPage(1); fetchAll(1) }, [search, type, status, selectedChannel])

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))
  const fmtDT = (d: string) => new Date(d).toLocaleDateString()

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Invoicing</h1>
        <Link href="/dashboard/invoicing/new" className="btn btn-primary">+ New Quotation / Invoice</Link>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-value">{meta.total}</div>
          <div className="stat-label">Documents (this view)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0))}</div>
          <div className="stat-label">Total Value (this page)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{invoices.filter(i => i.status === 'SENT' || i.status === 'PARTIALLY_PAID').length}</div>
          <div className="stat-label">Outstanding</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          placeholder="🔍 Search by document # or customer..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 300, flex: 1 }}
        />
        <select className="input" style={{ width: 160 }} value={type} onChange={e => setType(e.target.value)}>
          <option value="">All Types</option>
          <option value="QUOTATION">Quotation</option>
          <option value="PROFORMA">Proforma</option>
          <option value="INVOICE">Invoice</option>
        </select>
        <select className="input" style={{ width: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </select>
        {canChooseChannel && (
          <select className="input" style={{ width: 180 }} value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}>
            <option value="">All Channels</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="card">
        {loading ? <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div> : (
          <table className="table">
            <thead>
              <tr><th>Doc No</th><th>Type</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No documents found.</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/dashboard/invoicing/${inv.id}`}>
                  <td><strong>{inv.invoiceNo}</strong></td>
                  <td><span className={`badge ${typeBadge[inv.type] || 'badge-info'}`}>{typeLabel[inv.type] || inv.type}</span></td>
                  <td>{inv.customer?.name || '—'}</td>
                  <td>{inv._count?.lines ?? '—'} lines</td>
                  <td style={{ fontWeight: 600 }}>{fmt(inv.totalAmount)}</td>
                  <td>{fmt(inv.amountPaid)}</td>
                  <td><span className={`badge ${statusBadge[inv.status] || 'badge-info'}`}>{inv.status.replace('_', ' ')}</span></td>
                  <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{fmtDT(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {meta.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
            <span style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Page {page} / {meta.totalPages}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))} disabled={page === meta.totalPages}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
