'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Item { id: string; name: string; sku: string; retailPrice: number }
interface Customer { id: string; name: string; phone?: string }
interface Channel { id: string; name: string }
interface Bank { id: string; bankName: string; accountName: string; accountNumber: string }
interface Line {
  key: string; itemId?: string; description: string
  quantity: number; unitPrice: number; discountAmount: number
  search: string; results: Item[]
}

const newLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  description: '', quantity: 1, unitPrice: 0, discountAmount: 0, search: '', results: [],
})

export default function NewInvoicePage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user  = useAuthStore((s) => s.user)
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')

  const [docType, setDocType] = useState<'QUOTATION' | 'PROFORMA' | 'INVOICE'>('QUOTATION')
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState('')

  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)

  const [lines, setLines] = useState<Line[]>([newLine()])
  const [discountAmount, setDiscountAmount] = useState(0)
  const [taxAmount, setTaxAmount] = useState(0)
  const [taxExempt, setTaxExempt] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [customerOrderNo, setCustomerOrderNo] = useState('')
  const [quotationRefNo, setQuotationRefNo] = useState('')
  const [terms, setTerms] = useState('')
  const [banks, setBanks] = useState<Bank[]>([])
  const [selectedBankId, setSelectedBankId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    if (canChooseChannel) {
      api.get<Channel[]>('/channels', token).then(setChannels).catch(() => {})
    } else if (user?.channelId) {
      setChannelId(user.channelId)
    }
  }, [token, canChooseChannel, user?.channelId])

  useEffect(() => {
    if (!token || !channelId) { setBanks([]); return }
    api.get<Bank[]>(`/accounting/bank-deposits/banks?channelId=${channelId}`, token)
      .then(setBanks).catch(() => setBanks([]))
  }, [token, channelId])

  useEffect(() => {
    if (!token || customerSearch.length < 2) { setCustomerResults([]); return }
    const t = setTimeout(() => {
      api.get<{ data: Customer[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=10`, token)
        .then(res => setCustomerResults(res.data ?? []))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [token, customerSearch])

  const searchItems = (key: string, query: string) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, search: query } : l))
    if (!token || query.length < 2) return
    api.get<{ data: Item[] }>(`/items?search=${encodeURIComponent(query)}`, token)
      .then(res => setLines(prev => prev.map(l => l.key === key ? { ...l, results: res.data ?? [] } : l)))
      .catch(() => {})
  }

  const pickItem = (key: string, item: Item) => {
    setLines(prev => prev.map(l => l.key === key ? {
      ...l, itemId: item.id, description: item.name,
      unitPrice: Number(item.retailPrice), search: item.name, results: [],
    } : l))
  }

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  const removeLine = (key: string) => {
    setLines(prev => prev.length > 1 ? prev.filter(l => l.key !== key) : prev)
  }

  const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0)
  const lineDiscountTotal = lines.reduce((s, l) => s + (l.discountAmount || 0), 0)
  const total = Math.max(0, subtotal - lineDiscountTotal - discountAmount + (taxExempt ? 0 : taxAmount))
  const fmt = (n: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n)

  const handleSubmit = async () => {
    if (!channelId) { toast.error('Select a channel'); return }
    if (!customer) { toast.error('Select or create a customer'); return }
    const validLines = lines.filter(l => l.description.trim() && l.quantity > 0)
    if (validLines.length === 0) { toast.error('Add at least one line item'); return }

    setLoading(true)
    try {
      const invoice = await api.post<{ id: string; invoiceNo: string }>('/invoices', {
        type: docType,
        channelId,
        customerId: customer.id,
        lines: validLines.map(l => ({
          itemId: l.itemId, description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount || 0,
        })),
        discountAmount, taxAmount, taxExempt,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes || undefined,
        customerOrderNo: customerOrderNo || undefined,
        quotationRefNo: quotationRefNo || undefined,
        terms: terms || undefined,
        selectedBankId: selectedBankId || undefined,
      }, token!)
      toast.success(`${docType === 'QUOTATION' ? 'Quotation' : docType === 'PROFORMA' ? 'Proforma' : 'Invoice'} ${invoice.invoiceNo} created`)
      router.push(`/dashboard/invoicing/${invoice.id}`)
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>New Quotation / Invoice</h1>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['QUOTATION', 'PROFORMA', 'INVOICE'] as const).map(t => (
            <button
              key={t}
              className={`btn ${docType === t ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDocType(t)}
            >
              {t === 'QUOTATION' ? 'Quotation' : t === 'PROFORMA' ? 'Proforma Invoice' : 'Invoice'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: canChooseChannel ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 14 }}>
          {canChooseChannel && (
            <div className="form-group">
              <label>Channel</label>
              <select className="input" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">Select channel...</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ position: 'relative' }}>
            <label>Customer</label>
            {customer ? (
              <div className="input" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</span>
                <button className="btn-link" onClick={() => { setCustomer(null); setCustomerSearch('') }}>Change</button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Search customer by name or phone..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                />
                {customerResults.length > 0 && (
                  <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                    {customerResults.map(c => (
                      <div key={c.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onClick={() => { setCustomer(c); setCustomerResults([]) }}>
                        {c.name}{c.phone ? ` · ${c.phone}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div className="form-group">
            <label>Customer Order No.</label>
            <input className="input" value={customerOrderNo} onChange={e => setCustomerOrderNo(e.target.value)} placeholder="Customer's PO number..." />
          </div>
          {docType !== 'INVOICE' && (
            <div className="form-group">
              <label>Quotation Ref No.</label>
              <input className="input" value={quotationRefNo} onChange={e => setQuotationRefNo(e.target.value)} placeholder="Internal reference..." />
            </div>
          )}
          {docType === 'INVOICE' && (
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}
          {banks.length > 0 && (
            <div className="form-group">
              <label>Payment To Bank Account</label>
              <select className="input" value={selectedBankId} onChange={e => setSelectedBankId(e.target.value)}>
                <option value="">Not specified</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.bankName} — {b.accountNumber}</option>)}
              </select>
            </div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={taxExempt} onChange={e => setTaxExempt(e.target.checked)} />
          Tax exempt
        </label>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <h3 style={{ marginBottom: 16 }}>Line Items</h3>
        <table className="table">
          <thead>
            <tr><th>Item / Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 130 }}>Unit Price</th><th style={{ width: 110 }}>Discount</th><th style={{ width: 120 }}>Total</th><th style={{ width: 40 }}></th></tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.key} style={{ position: 'relative' }}>
                <td style={{ position: 'relative' }}>
                  <input
                    className="input"
                    placeholder="Search item or type a free-text description..."
                    value={line.search || line.description}
                    onChange={e => {
                      searchItems(line.key, e.target.value)
                      updateLine(line.key, { description: e.target.value, itemId: undefined })
                    }}
                  />
                  {line.results.length > 0 && (
                    <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                      {line.results.map(item => (
                        <div key={item.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                          onClick={() => pickItem(line.key, item)}>
                          {item.name} <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.sku}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <input type="number" min={0.01} step={0.01} className="input" value={line.quantity}
                    onChange={e => updateLine(line.key, { quantity: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" min={0} step={0.01} className="input" value={line.unitPrice}
                    onChange={e => updateLine(line.key, { unitPrice: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" min={0} step={0.01} className="input" value={line.discountAmount}
                    onChange={e => updateLine(line.key, { discountAmount: Number(e.target.value) })} />
                </td>
                <td style={{ fontWeight: 600 }}>{fmt(line.quantity * line.unitPrice - line.discountAmount)}</td>
                <td>
                  <button className="btn-link" onClick={() => removeLine(line.key)} title="Remove line">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setLines(prev => [...prev, newLine()])}>+ Add Line</button>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <div style={{ width: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            {lineDiscountTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: 'var(--text-muted)' }}>
                <span>Line Discounts</span><span>-{fmt(lineDiscountTotal)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <label style={{ margin: 0 }}>Additional Discount</label>
              <input type="number" min={0} step={0.01} className="input" style={{ width: 130, textAlign: 'right' }}
                value={discountAmount} onChange={e => setDiscountAmount(Number(e.target.value))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <label style={{ margin: 0 }}>Tax {taxExempt && '(exempt)'}</label>
              <input type="number" min={0} step={0.01} className="input" disabled={taxExempt} style={{ width: 130, textAlign: 'right' }}
                value={taxAmount} onChange={e => setTaxAmount(Number(e.target.value))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span>Total</span><span>{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>Notes</label>
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this document..." />
        </div>
        <div className="form-group">
          <label>Terms &amp; Conditions</label>
          <textarea className="input" rows={3} value={terms} onChange={e => setTerms(e.target.value)} placeholder="e.g. Payment due within 30 days. Goods remain property of seller until paid in full." />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-ghost" onClick={() => router.push('/dashboard/invoicing')}>Cancel</button>
        <button className="btn btn-primary btn-lg" disabled={loading} onClick={handleSubmit}>
          {loading ? 'Saving...' : `Create ${docType === 'QUOTATION' ? 'Quotation' : docType === 'PROFORMA' ? 'Proforma' : 'Invoice'}`}
        </button>
      </div>
    </div>
  )
}
