'use client'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'

interface Customer { id: string; name: string; phone?: string; email?: string }
interface CreditBalance { 
  customerId: string; 
  customerName: string; 
  customerPhone?: string; 
  totalOutstanding: number; 
  unpaidCount: number;
  earliestDueDate: string | null;
}
interface CreditSale { id: string; saleNo: string; totalAmount: unknown; paidAmount: unknown; createdAt: string; dueDate?: string }

export default function CreditPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [balances, setBalances] = useState<CreditBalance[]>([])
  const [loadingBalances, setLoadingBalances] = useState(true)
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const [creditSales, setCreditSales] = useState<any[]>([]) // Using any for faster iteration on mismatches
  const [loadingSales, setLoadingSales] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [paying, setPaying] = useState(false)
  const [pay, setPay] = useState({ saleId: '', amount: 0, method: 'CASH', reference: '' })
  const [payStep, setPayStep] = useState(1) // 1: Entry, 2: Agreement, 3: Final Confirm
  const [sortBy, setSortBy] = useState<'name' | 'dueDate' | 'amount'>('dueDate')

  // Fetch all credit customers using the sales endpoint with credit filter
  const fetchBalances = async () => {
    if (!token) return
    setLoadingBalances(true)
    try {
      const res = await api.get<{ 
        data: { 
          id: string; 
          netAmount: unknown; 
          paidAmount: unknown; 
          customer?: { id: string; name: string; phone?: string }; 
          createdAt: string;
          dueDate?: string;
          payments?: any[];
        }[] 
      }>('/sales?saleType=CREDIT&limit=100', token)
      const sales = res.data ?? []
      
      const byCustomer: Record<string, CreditBalance> = {}
      sales.forEach(s => {
        const c = s.customer
        if (!c) return
        const totalPaid = (s.payments as any[])?.filter(p => p.method !== 'CREDIT').reduce((sum, p) => sum + Number(p.amount), 0) ?? 0
        const outstandingAmount = Number(s.netAmount ?? 0) - totalPaid
        
        if (!byCustomer[c.id]) {
          byCustomer[c.id] = { customerId: c.id, customerName: c.name, customerPhone: c.phone, totalOutstanding: 0, unpaidCount: 0, earliestDueDate: null }
        }
        byCustomer[c.id].totalOutstanding += outstandingAmount
        if (outstandingAmount > 0) {
          byCustomer[c.id].unpaidCount += 1
          if (s.dueDate && (!byCustomer[c.id].earliestDueDate || new Date(s.dueDate) < new Date(byCustomer[c.id].earliestDueDate!))) {
            byCustomer[c.id].earliestDueDate = s.dueDate
          }
        }
      })
      setBalances(Object.values(byCustomer).filter(b => b.totalOutstanding > 0))
    } catch (err) { console.error(err) }
    finally { setLoadingBalances(false) }
  }

  const getExportData = async () => {
    if (selected) {
      return creditSales.map(s => [
        s.receiptNo,
        s.totalAmount,
        s.totalPaid,
        s.outstanding,
        fmtDate(s.saleDate),
        fmtDate(s.dueDate)
      ])
    }
    return balances.map(b => [
        b.customerName,
        b.customerPhone || '—',
        b.unpaidCount,
        fmtDate(b.earliestDueDate),
        b.totalOutstanding
    ])
  }

  const searchCustomers = async (q: string) => {
    if (!token || q.length < 2) { setCustomers([]); return }
    try {
      const res = await api.get<{ data: Customer[] }>(`/customers?search=${encodeURIComponent(q)}&limit=10`, token)
      setCustomers(res.data ?? [])
    } catch (err) { console.error(err) }
  }

  const selectCustomer = async (id: string, name: string) => {
    setSelected({ id, name })
    setCustomers([])
    setSearch(name)
    setLoadingSales(true)
    try {
      const res = await api.get<{ outstandingSales: any[] }>(`/credit/outstanding/${id}`, token!)
      setCreditSales(res.outstandingSales ?? [])
    } catch (err) { console.error(err) }
    finally { setLoadingSales(false) }
  }

  useEffect(() => { fetchBalances() }, [token])

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected || !pay.saleId || pay.amount <= 0) return toast.error('Fill all required fields')
    setPaying(true)
    try {
      await api.post('/credit/repay', {
        customerId: selected.id, saleId: pay.saleId, amount: pay.amount, method: pay.method,
        ...(pay.reference && { reference: pay.reference }),
      }, token!)
      toast.success('Payment recorded successfully!')
      setShowPayModal(false)
      setPay({ saleId: '', amount: 0, method: 'CASH', reference: '' })
      setPayStep(1)
      await selectCustomer(selected.id, selected.name)
      await fetchBalances()
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
    finally { setPaying(false) }
  }

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))
  const outstanding = (s: any) => Number(s.outstanding ?? 0)
  const totalDue = creditSales.reduce((sum, s) => sum + outstanding(s), 0)

  const isOverdue = (date: string | null) => {
    if (!date) return false
    return new Date(date) < new Date()
  }

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : '—'

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Credit Management</h1>
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu 
            title={selected ? `Credit_History_${selected.name}` : 'Debtors_List'}
            headers={selected ? ['Receipt #', 'Total', 'Paid', 'Outstanding', 'Date', 'Due Date'] : ['Customer', 'Phone', 'Unpaid Count', 'Earliest Due', 'Outstanding Total']}
            getData={getExportData}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>📋 Debtors Management</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Sort by:</span>
            <select className="input" style={{ padding: '4px 8px', fontSize: '0.85rem', width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="name">Customer Name</option>
              <option value="dueDate">⚡ Earliest Due Date</option>
              <option value="amount">Outstanding Amount</option>
            </select>
          </div>
        </div>

        {loadingBalances ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading debtor balances...</div>
        ) : balances.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
             No outstanding credit balances found. All customers are currently up to date! 🎉
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Customer</th><th>Phone</th><th>Unpaid</th><th>Earliest Due</th><th>Outstanding Total</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {balances
                .sort((a, b) => {
                  if (sortBy === 'name') return a.customerName.localeCompare(b.customerName)
                  if (sortBy === 'amount') return b.totalOutstanding - a.totalOutstanding
                  if (sortBy === 'dueDate') {
                    if (!a.earliestDueDate) return 1
                    if (!b.earliestDueDate) return -1
                    return new Date(a.earliestDueDate).getTime() - new Date(b.earliestDueDate).getTime()
                  }
                  return 0
                })
                .map(b => (
                  <tr key={b.customerId} style={{ cursor: 'pointer' }} onClick={() => selectCustomer(b.customerId, b.customerName)}>
                    <td><strong>{b.customerName}</strong></td>
                    <td>{b.customerPhone || '—'}</td>
                    <td><span className="badge badge-warning">{b.unpaidCount}</span></td>
                    <td>
                       {b.earliestDueDate ? (
                         <span style={{ color: isOverdue(b.earliestDueDate) ? 'var(--danger)' : 'inherit', fontWeight: isOverdue(b.earliestDueDate) ? 600 : 400 }}>
                           {fmtDate(b.earliestDueDate)}
                           {isOverdue(b.earliestDueDate) && <span style={{ marginLeft: 6 }}>🚨</span>}
                         </span>
                       ) : '—'}
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmt(b.totalOutstanding)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm">View / Pay</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Customer Search */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>🔍 Search Customer</h3>
        <div style={{ position: 'relative', maxWidth: 460 }}>
          <input
            className="input"
            placeholder="Type customer name or phone..."
            value={search}
            onChange={e => { setSearch(e.target.value); searchCustomers(e.target.value) }}
          />
          {customers.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', zIndex: 50, maxHeight: 200, overflowY: 'auto' }}>
              {customers.map(c => (
                <div key={c.id} onClick={() => selectCustomer(c.id, c.name)}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                  <strong>{c.name}</strong>
                  {c.phone && <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}> · {c.phone}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selected Customer Detail */}
      {selected && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <h3 style={{ margin: 0 }}>{selected.name}</h3>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Outstanding: <strong style={{ color: totalDue > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(totalDue)}</strong></span>
            </div>
            {totalDue > 0 && <button className="btn btn-primary" onClick={() => setShowPayModal(true)}>💰 Record Payment</button>}
          </div>
          {loadingSales ? <div style={{ padding: 32, textAlign: 'center' }}>Loading...</div> : (
            <table className="table">
              <thead><tr><th>Receipt #</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Date</th><th>Due Date</th></tr></thead>
              <tbody>
                {creditSales.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No credit sales found.</td></tr>
                ) : creditSales
                    .sort((a, b) => {
                      if (!a.dueDate) return 1
                      if (!b.dueDate) return -1
                      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
                    })
                    .map(s => (
                  <tr key={s.saleId}>
                    <td><code>{s.receiptNo}</code></td>
                    <td>{fmt(s.totalAmount)}</td>
                    <td style={{ color: 'var(--success)' }}>{fmt(s.totalPaid)}</td>
                    <td style={{ fontWeight: 700, color: s.outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(s.outstanding)}</td>
                    <td style={{ fontSize: '0.85rem' }}>{fmtDate(s.saleDate)}</td>
                    <td style={{ fontSize: '0.85rem', color: isOverdue(s.dueDate) ? 'var(--danger)' : 'inherit' }}>
                      {fmtDate(s.dueDate)}
                      {isOverdue(s.dueDate) && <span style={{ marginLeft: 4, fontSize: '0.7rem', verticalAlign: 'middle' }}>⚠️ OVERDUE</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}


      {showPayModal && selected && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 460 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>💰 Record Payment — {selected.name}</h3>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {[1, 2, 3].map(s => (
                  <div key={s} style={{ height: 4, flex: 1, borderRadius: 2, background: payStep >= s ? 'var(--primary)' : 'var(--border)' }} />
                ))}
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); if (payStep < 3) setPayStep(prev => prev + 1); else handlePayment(e); }} style={{ padding: '0 20px 20px' }}>
              {payStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="form-group">
                    <label>Invoice *</label>
                    <select className="input" value={pay.saleId} onChange={e => setPay({ ...pay, saleId: e.target.value })} required>
                      <option value="">Select invoice...</option>
                      {creditSales.filter(s => outstanding(s) > 0).map(s => (
                        <option key={s.saleId} value={s.saleId}>{s.receiptNo} — {fmt(outstanding(s))} due</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Amount (KES) *</label>
                      <input type="number" className="input" min="0.01" step="0.01" value={pay.amount || ''} onChange={e => setPay({ ...pay, amount: Number(e.target.value) })} required />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label>Method</label>
                      <select className="input" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}>
                        <option value="CASH">Cash</option>
                        <option value="MOBILE_MONEY">M-Pesa</option>
                        <option value="CARD">Card</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Reference #</label>
                    <input className="input" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} placeholder="Transaction ID / Receipt #" />
                  </div>
                </div>
              )}

              {payStep === 2 && (
                <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <h4 style={{ marginBottom: 12, color: 'var(--primary)' }}>📜 Settlement Agreement</h4>
                  <p style={{ fontSize: '0.9rem', marginBottom: 12 }}>You are about to record a payment for <strong>{creditSales.find(s => s.saleId === pay.saleId)?.receiptNo}</strong>.</p>
                  <table style={{ width: '100%', fontSize: '0.85rem' }}>
                    <tbody>
                      <tr><td style={{ padding: '4px 0' }}>Current Due:</td><td style={{ textAlign: 'right' }}>{fmt(outstanding(creditSales.find(s => s.saleId === pay.saleId)))}</td></tr>
                      <tr><td style={{ padding: '4px 0' }}>Payment Amount:</td><td style={{ textAlign: 'right', color: 'var(--success)' }}>- {fmt(pay.amount)}</td></tr>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 0', fontWeight: 700 }}>New Balance:</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{fmt(outstanding(creditSales.find(s => s.saleId === pay.saleId)) - pay.amount)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ℹ️ This will update the customer&apos;s credit limit and clear the invoice if settled in full.
                  </div>
                </div>
              )}

              {payStep === 3 && (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚠️</div>
                  <h4>Final Confirmation</h4>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 8 }}>
                    Has the payment of <strong>{fmt(pay.amount)}</strong> via <strong>{pay.method}</strong> been verified and confirmed?
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
                <button type="button" className="btn btn-ghost" onClick={() => { if (payStep > 1) setPayStep(s => s - 1); else setShowPayModal(false); }}>{payStep === 1 ? 'Cancel' : 'Back'}</button>
                <button type="submit" className="btn btn-primary" disabled={paying}>
                  {payStep === 1 ? 'Next' : payStep === 2 ? 'I Agree, Proceed' : paying ? 'Recording...' : 'Fully Confirmed - Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
