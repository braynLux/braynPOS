'use client'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Sale { id: string; receiptNo: string; netAmount: number; createdAt: string; customer?: { name: string } }
interface SaleItem { id: string; itemId: string; quantity: number; unitPrice: unknown; item?: { name: string; sku: string } }
interface ReturnRecord {
  id: string; itemId: string; quantityChange: number; createdAt: string; notes?: string
  receiptNo?: string | null
  item?: { name: string; sku: string }
  channel?: { name: string }
}

export default function ReturnsPage() {
  const token = useAuthStore((s) => s.accessToken)

  const [search, setSearch] = useState('')
  const [recentSales, setRecentSales] = useState<Sale[]>([])
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [returnQty, setReturnQty] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [returns, setReturns] = useState<ReturnRecord[]>([])
  const [loadingReturns, setLoadingReturns] = useState(true)

  const loadReturns = () => {
    if (!token) return
    setLoadingReturns(true)
    api.get<{ data: ReturnRecord[] }>('/sales/returns?limit=25', token)
      .then(res => setReturns(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingReturns(false))
  }

  useEffect(() => { loadReturns() }, [token])

  useEffect(() => {
    if (!token || search.length < 2) { setRecentSales([]); return }
    const t = setTimeout(() => {
      const start = new Date(); start.setDate(start.getDate() - 60)
      api.get<{ data: Sale[] }>(`/sales?limit=100&startDate=${start.toISOString()}`, token)
        .then(res => setRecentSales((res.data ?? []).filter(s => s.receiptNo.toLowerCase().includes(search.toLowerCase()))))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [token, search])

  const pickSale = async (sale: Sale) => {
    setSelectedSale(sale)
    setRecentSales([])
    setSearch(sale.receiptNo)
    try {
      const items = await api.get<SaleItem[]>(`/sales/${sale.id}/items`, token!)
      setSaleItems(items)
      setReturnQty({})
    } catch (err) {
      toast.error('Failed to load sale items: ' + (err as Error).message)
    }
  }

  const submitReturn = async () => {
    if (!selectedSale) return
    const lines = saleItems
      .filter(si => (returnQty[si.id] ?? 0) > 0)
      .map(si => ({ saleItemId: si.id, quantity: returnQty[si.id], reason: returnReason || undefined }))

    if (lines.length === 0) { toast.error('Enter a quantity for at least one item'); return }

    setSubmitting(true)
    try {
      await api.post(`/sales/returns/${selectedSale.id}`, { lines }, token!)
      toast.success('Return processed — stock restocked')
      setSelectedSale(null)
      setSaleItems([])
      setReturnQty({})
      setReturnReason('')
      setSearch('')
      loadReturns()
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const fmtDT = (d: string) => new Date(d).toLocaleString()

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>Returns</h1>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16 }}>Process a Return</h3>

        <div className="form-group" style={{ position: 'relative', maxWidth: 360 }}>
          <label>Receipt Number</label>
          <input
            className="input"
            placeholder="Search receipt no..."
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedSale(null); setSaleItems([]) }}
          />
          {recentSales.length > 0 && (
            <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
              {recentSales.map(s => (
                <div key={s.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  onClick={() => pickSale(s)}>
                  <strong>{s.receiptNo}</strong> · {s.customer?.name || 'Walk-in'} · {new Date(s.createdAt).toLocaleDateString()}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedSale && saleItems.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <table className="table">
              <thead><tr><th>Item</th><th>SKU</th><th>Sold Qty</th><th style={{ width: 120 }}>Return Qty</th></tr></thead>
              <tbody>
                {saleItems.map(si => (
                  <tr key={si.id}>
                    <td>{si.item?.name || si.itemId}</td>
                    <td><code style={{ fontSize: '0.8rem' }}>{si.item?.sku || '—'}</code></td>
                    <td>{si.quantity}</td>
                    <td>
                      <input
                        type="number" min={0} max={si.quantity} className="input"
                        value={returnQty[si.id] ?? 0}
                        onChange={e => setReturnQty(prev => ({ ...prev, [si.id]: Math.max(0, Math.min(si.quantity, Number(e.target.value))) }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="form-group" style={{ marginTop: 14, maxWidth: 400 }}>
              <label>Reason (optional)</label>
              <input className="input" value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder="e.g. Defective, wrong item..." />
            </div>

            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={submitting} onClick={submitReturn}>
              {submitting ? 'Processing...' : 'Process Return & Restock'}
            </button>
          </div>
        )}

        {selectedSale && saleItems.length === 0 && (
          <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Loading sale items...</p>
        )}
      </div>

      <div className="card">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>Return Log</div>
        {loadingReturns ? (
          <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Item</th><th>Channel</th><th style={{ textAlign: 'right' }}>Qty Returned</th><th>Reason</th></tr></thead>
            <tbody>
              {returns.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No returns recorded yet.</td></tr>
              ) : returns.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: '0.82rem' }}>{fmtDT(r.createdAt)}</td>
                  <td><strong>{r.receiptNo || '—'}</strong></td>
                  <td>{r.item?.name || r.itemId}</td>
                  <td>{r.channel?.name || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.quantityChange}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
