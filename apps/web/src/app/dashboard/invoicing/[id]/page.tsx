'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface InvoiceLine {
  id: string; description: string; quantity: unknown; unitPrice: unknown; discountAmount: unknown; lineTotal: unknown
  item?: { id: string; name: string; sku: string }
}
interface InvoiceDetail {
  id: string; invoiceNo: string; type: string; status: string
  subtotal: unknown; discountAmount: unknown; taxAmount: unknown; totalAmount: unknown; amountPaid: unknown
  dueDate?: string; notes?: string; createdAt: string
  customerOrderNo?: string; quotationRefNo?: string; taxExempt: boolean; terms?: string
  customer: { id: string; name: string; phone?: string; email?: string }
  channel: { id: string; name: string }
  creator: { id: string; username: string }
  bank?: { bankName: string; accountName: string; accountNumber: string; paybill?: string }
  lines: InvoiceLine[]
  convertedFrom?: { id: string; invoiceNo: string; type: string }
  convertedTo?: { id: string; invoiceNo: string; type: string }
}

const typeLabel: Record<string, string> = { QUOTATION: 'Quotation', PROFORMA: 'Proforma Invoice', INVOICE: 'Invoice' }
const statusBadge: Record<string, string> = {
  DRAFT: 'badge-info', SENT: 'badge-warning', PARTIALLY_PAID: 'badge-warning',
  PAID: 'badge-success', VOID: 'badge-danger',
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')

  const load = useCallback(() => {
    if (!token || !id) return
    setLoading(true)
    api.get<InvoiceDetail>(`/invoices/${id}`, token)
      .then(setInvoice)
      .catch(err => toast.error('Failed to load: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [token, id])

  useEffect(() => { load() }, [load])

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))

  const runAction = async (fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(successMsg)
      load()
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const convert = (targetType: 'PROFORMA' | 'INVOICE') =>
    runAction(async () => {
      const res = await api.post<{ id: string }>(`/invoices/${id}/convert`, { targetType }, token!)
      router.push(`/dashboard/invoicing/${res.id}`)
    }, `Converted to ${typeLabel[targetType]}`)

  const markSent = () => runAction(() => api.post(`/invoices/${id}/send`, {}, token!), 'Marked as sent')
  const voidDoc  = () => {
    if (!confirm('Void this document? This cannot be undone.')) return
    runAction(() => api.post(`/invoices/${id}/void`, {}, token!), 'Document voided')
  }
  const recordPayment = () => {
    const amount = Number(paymentAmount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    runAction(() => api.post(`/invoices/${id}/payments`, { amount }, token!), 'Payment recorded')
      .then(() => setPaymentAmount(''))
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
  if (!invoice) return <div style={{ padding: 40, textAlign: 'center' }}>Document not found.</div>

  const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid)

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>{invoice.invoiceNo}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {typeLabel[invoice.type]} · <span className={`badge ${statusBadge[invoice.status]}`}>{invoice.status.replace('_', ' ')}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/dashboard/invoicing" className="btn btn-ghost">← Back</Link>
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      {invoice.convertedFrom && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 16, fontSize: '0.85rem' }}>
          Converted from <Link href={`/dashboard/invoicing/${invoice.convertedFrom.id}`}>{invoice.convertedFrom.invoiceNo}</Link> ({typeLabel[invoice.convertedFrom.type]})
        </div>
      )}
      {invoice.convertedTo && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 16, fontSize: '0.85rem' }}>
          Converted to <Link href={`/dashboard/invoicing/${invoice.convertedTo.id}`}>{invoice.convertedTo.invoiceNo}</Link> ({typeLabel[invoice.convertedTo.type]})
        </div>
      )}

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bill To</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>{invoice.customer.name}</div>
            {invoice.customer.phone && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{invoice.customer.phone}</div>}
            {invoice.customer.email && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{invoice.customer.email}</div>}
          </div>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Details</div>
            <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Channel: {invoice.channel.name}</div>
            <div style={{ fontSize: '0.85rem' }}>Issued: {new Date(invoice.createdAt).toLocaleDateString()}</div>
            {invoice.dueDate && <div style={{ fontSize: '0.85rem' }}>Due: {new Date(invoice.dueDate).toLocaleDateString()}</div>}
            <div style={{ fontSize: '0.85rem' }}>By: {invoice.creator.username}</div>
            {invoice.customerOrderNo && <div style={{ fontSize: '0.85rem' }}>Customer Order No: {invoice.customerOrderNo}</div>}
            {invoice.quotationRefNo && <div style={{ fontSize: '0.85rem' }}>Quotation Ref: {invoice.quotationRefNo}</div>}
            {invoice.taxExempt && <div style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Tax Exempt</div>}
            {invoice.bank && (
              <div style={{ fontSize: '0.85rem' }}>
                Pay to: {invoice.bank.bankName} — {invoice.bank.accountNumber} ({invoice.bank.accountName})
              </div>
            )}
          </div>
        </div>

        <table className="table">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Line Total</th></tr></thead>
          <tbody>
            {invoice.lines.map(l => (
              <tr key={l.id}>
                <td>{l.description}{l.item && <code style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l.item.sku}</code>}</td>
                <td>{Number(l.quantity)}</td>
                <td>{fmt(l.unitPrice)}</td>
                <td>{Number(l.discountAmount) > 0 ? `-${fmt(l.discountAmount)}` : '—'}</td>
                <td style={{ fontWeight: 600 }}>{fmt(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <div style={{ width: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Subtotal</span><span>{fmt(invoice.subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Discount</span><span>-{fmt(invoice.discountAmount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>Tax</span><span>{fmt(invoice.taxAmount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span>Total</span><span>{fmt(invoice.totalAmount)}</span>
            </div>
            {invoice.type === 'INVOICE' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--success, #4ade80)' }}>
                  <span>Paid</span><span>{fmt(invoice.amountPaid)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Balance</span><span>{fmt(balance)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {invoice.notes && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Notes</div>
            <p style={{ fontSize: '0.9rem' }}>{invoice.notes}</p>
          </div>
        )}
        {invoice.terms && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Terms &amp; Conditions</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{invoice.terms}</p>
          </div>
        )}
      </div>

      {invoice.status !== 'VOID' && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>Actions</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {invoice.status === 'DRAFT' && (
              <button className="btn btn-ghost" disabled={busy} onClick={markSent}>Mark as Sent</button>
            )}
            {invoice.type === 'QUOTATION' && !invoice.convertedTo && (
              <>
                <button className="btn btn-ghost" disabled={busy} onClick={() => convert('PROFORMA')}>Convert to Proforma</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => convert('INVOICE')}>Convert to Invoice</button>
              </>
            )}
            {invoice.type === 'PROFORMA' && !invoice.convertedTo && (
              <button className="btn btn-primary" disabled={busy} onClick={() => convert('INVOICE')}>Convert to Invoice</button>
            )}
            {invoice.type === 'INVOICE' && balance > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" min={0} step={0.01} className="input" style={{ width: 140 }}
                  placeholder="Amount" value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                />
                <button className="btn btn-primary" disabled={busy} onClick={recordPayment}>Record Payment</button>
              </div>
            )}
            {Number(invoice.amountPaid) === 0 && (
              <button className="btn btn-ghost" style={{ color: 'var(--danger, #ef4444)' }} disabled={busy} onClick={voidDoc}>Void Document</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
