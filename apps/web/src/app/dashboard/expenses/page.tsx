'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'

interface Expense { id: string; description: string; amount: unknown; category: string; receiptRef?: string; paymentSource?: string; createdAt: string; channel?: { name: string }; recordedBy?: { username: string } }
interface Channel { id: string; name: string }

const DEFAULT_CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Marketing', 'Maintenance', 'Insurance', 'Meals', 'Bank Charges', 'Repairs', 'Equipment', 'Other']

export default function ExpensesPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Default to today
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])

  const [form, setForm] = useState({ channelId: '', description: '', amount: 0, category: '', receiptRef: '', notes: '', paymentSource: 'CASH' })
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  const allCategories = [...DEFAULT_CATEGORIES, ...customCategories.filter(c => !DEFAULT_CATEGORIES.includes(c))]

  const fetchCategories = async () => {
    if (!token) return
    try {
      const cats = await api.get<{ name: string }[]>('/expenses/categories', token)
      setCustomCategories(cats.map(c => c.name))
    } catch (err) { console.error(err) }
  }

  const fetchAll = async () => {
    if (!token) return
    try {
      // Create start of day and end of day ISO strings
      const start = new Date(startDate)
      start.setHours(0,0,0,0)
      const end = new Date(endDate)
      end.setHours(23,59,59,999)

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate:   end.toISOString(),
      })
      if (selectedChannel) params.append('channelId', selectedChannel)

      const [eRes, cRes] = await Promise.all([
        api.get<{ data: Expense[] }>(`/expenses?${params.toString()}`, token),
        api.get<Channel[]>('/channels', token),
      ])
      setExpenses(eRes.data ?? [])
      setChannels(Array.isArray(cRes) ? cRes : [cRes as unknown as Channel])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const getExportData = async () => {
    return filtered.map(e => [
        e.id.slice(0, 8).toUpperCase(),
        e.description,
        e.category || '—',
        e.channel?.name || '—',
        e.amount,
        new Date(e.createdAt).toLocaleString(),
        e.receiptRef || '—'
    ])
  }

  useEffect(() => {
    fetchAll()
    fetchCategories()
    if (user?.channelId && !form.channelId) setForm(f => ({ ...f, channelId: user.channelId! }))
  }, [token, user?.channelId, startDate, endDate, selectedChannel])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.channelId || !form.description || form.amount <= 0) return alert('Fill in all required fields')
    setSaving(true)
    try {
      const payload = { channelId: form.channelId, description: form.description, amount: form.amount, paymentSource: form.paymentSource, ...(form.category && { category: form.category }), ...(form.receiptRef && { receiptRef: form.receiptRef }), ...(form.notes && { notes: form.notes }) }
      await api.post('/expenses', payload, token!)
      setShowModal(false)
      setForm({ channelId: user?.channelId || '', description: '', amount: 0, category: '', receiptRef: '', notes: '', paymentSource: 'CASH' })
      fetchAll()
    } catch (err) { alert('Failed: ' + (err as Error).message) }
    finally { setSaving(false) }
  }

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))
  
  const filtered = expenses.filter(e => 
    !search || 
    e.description.toLowerCase().includes(search.toLowerCase()) || 
    e.category?.toLowerCase().includes(search.toLowerCase()) ||
    e.receiptRef?.toLowerCase().includes(search.toLowerCase())
  )

  const total = filtered.reduce((s, e) => s + Number(e.amount ?? 0), 0)

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Expenses</h1>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ExportMenu 
            title="Expenses_Report"
            headers={['ID', 'Description', 'Category', 'Channel', 'Amount', 'Date & Time', 'Receipt Ref']}
            getData={getExportData}
          />
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Record Expense</button>
        </div>
      </div>

      {expenses.length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-value">{expenses.length}</div>
            <div className="stat-label">Total Expenses</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{fmt(total)}</div>
            <div className="stat-label">Total Amount</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input 
          className="input" 
          placeholder="🔍 Search descriptions, categories, or receipts..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          style={{ maxWidth: 300, flex: 1 }}
        />
        {['SUPER_ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(user?.role || '') && (
          <select 
            className="input" 
            style={{ width: 180 }} 
            value={selectedChannel} 
            onChange={e => setSelectedChannel(e.target.value)}
          >
            <option value="">All Channels</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>From:</label>
          <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: 150 }} />
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>To:</label>
          <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: 150 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const today = new Date().toISOString().split('T')[0]
            setStartDate(today)
            setEndDate(today)
          }}>Today</button>
        </div>
      </div>

      <div className="card">
        {loading ? <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div> : (
          <table className="table">
            <thead><tr><th>ID</th><th>Description</th><th>Category</th><th>Paid From</th><th>Channel</th><th>Amount</th><th>Date & Time</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No expenses found matching &quot;{search}&quot;.</td></tr>
              ) : filtered.map(e => (
                <tr key={e.id}>
                  <td><code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{e.id.slice(0, 8).toUpperCase()}</code></td>
                  <td><strong>{e.description}</strong>{e.receiptRef && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ref: {e.receiptRef}</div>}</td>
                  <td>{e.category ? <span className="badge badge-info">{e.category}</span> : '—'}</td>
                  <td>{e.paymentSource || 'CASH'}</td>
                  <td>{e.channel?.name || '—'}</td>
                  <td style={{ fontWeight: 600, color: 'var(--danger)' }}>{fmt(e.amount)}</td>
                  <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 460 }}>
            <h3>💸 Record Expense</h3>
            <form onSubmit={handleSubmit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '') && (
                <div className="form-group">
                  <label>Channel *</label>
                  <select className="input" value={form.channelId} onChange={e => setForm({ ...form, channelId: e.target.value })} required>
                    <option value="">Select channel...</option>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Description *</label>
                <input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required placeholder="e.g. Electricity bill - March" />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Amount (KES) *</label>
                  <input type="number" className="input" min="1" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Paid From</label>
                  <select className="input" value={form.paymentSource} onChange={e => setForm({ ...form, paymentSource: e.target.value })}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    <option value="CREDITOR">Creditor (on account)</option>
                    <option value="CAPITAL">Owner Capital</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    Category
                    <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.8rem' }} onClick={() => setShowNewCat(!showNewCat)}>+ New Category</button>
                  </label>
                  {showNewCat ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="input" style={{ flex: 1 }} value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name..." autoFocus />
                      <button type="button" className="btn btn-primary btn-sm" disabled={savingCat} onClick={async () => {
                        const name = newCatName.trim()
                        if (!name) return
                        setSavingCat(true)
                        try {
                          await api.post('/expenses/categories', { name }, token!)
                          await fetchCategories()
                          setForm(f => ({ ...f, category: name }))
                          setNewCatName('')
                          setShowNewCat(false)
                        } catch (err) { alert('Failed: ' + (err as Error).message) }
                        finally { setSavingCat(false) }
                      }}>{savingCat ? '...' : 'Add'}</button>
                    </div>
                  ) : (
                    <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      <option value="">Uncategorized</option>
                      {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Receipt / Reference #</label>
                <input className="input" value={form.receiptRef} onChange={e => setForm({ ...form, receiptRef: e.target.value })} placeholder="e.g. RCPT-001" />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes..." style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Record Expense'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
