'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'react-hot-toast'

interface GhostItem {
  itemId: string
  channelId: string
  weightedAvgCost: number
  retailPrice: number
  item: { name: string, sku: string, barcode: string | null }
  channel: { name: string }
}

export default function MarginCorrectionPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [items, setItems] = useState<GhostItem[]>([])
  const [loading, setLoading] = useState(true)
  const [repairing, setRepairing] = useState<string | null>(null)

  const [form, setForm] = useState({
    itemId: '',
    channelId: '',
    newCost: '',
    newRetail: '',
    repairRecentSales: true
  })

  const fetchGhostItems = async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await api.get<GhostItem[]>('/audit/margin-correction/ghost-items', token)
      setItems(res)
    } catch (err) {
      toast.error('Failed to load ghost items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGhostItems() }, [token])

  const handleRepair = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    
    setRepairing(form.itemId)
    try {
      const res = await api.post<any>('/audit/margin-correction/repair', {
        ...form,
        newCost: Number(form.newCost),
        newRetail: form.newRetail ? Number(form.newRetail) : undefined
      }, token)
      
      toast.success(`Successfully repaired! ${res.repairedSaleCount} sales updated and ${res.unlockedCommissionCount} commissions unlocked.`)
      fetchGhostItems()
      setForm({ itemId: '', channelId: '', newCost: '', newRetail: '', repairRecentSales: true })
    } catch (err: any) {
      toast.error(err.message || 'Repair failed')
    } finally {
      setRepairing(null)
    }
  }

  const startRepair = (item: GhostItem) => {
    setForm({
      itemId: item.itemId,
      channelId: item.channelId,
      newCost: '',
      newRetail: item.retailPrice.toString(),
      repairRecentSales: true
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="animate-fade-in" style={{ padding: '20px' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 900, letterSpacing: '-0.03em' }}>🛡️ Margin Correction Center</h1>
          <p style={{ color: 'var(--text-muted)' }}>Identify &quot;Ghost Items&quot; with zero cost and retroactively repair historical commission data.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 350px', gap: 24, alignItems: 'start' }}>
        
        {/* List of Ghost Items */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Ghost Items (Zero Cost)</strong>
            <span className="badge badge-warning">{items.length} Vulnerabilities Found</span>
          </div>
          
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Channel</th>
                  <th>Current Cost</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40 }}>Scanning inventory...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--success)' }}>🎉 No ghost items found. All cost data is verified!</td></tr>
                ) : (
                  items.map((item, idx) => (
                    <tr key={`${item.itemId}-${item.channelId}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.item.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SKU: {item.item.sku}</div>
                      </td>
                      <td>📍 {item.channel.name}</td>
                      <td style={{ color: 'var(--danger)', fontWeight: 700 }}>KES 0.00</td>
                      <td>
                        <button className="btn btn-primary btn-sm" onClick={() => startRepair(item)}>Fix Cost</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Repair Form */}
        <div className="card" style={{ padding: 24, position: 'sticky', top: 20 }}>
          <h3 style={{ marginBottom: 20 }}>🛠️ Repair Margin</h3>
          {form.itemId ? (
            <form onSubmit={handleRepair}>
              <div className="form-group">
                <label>Target Item</label>
                <input className="input" value={items.find(i => i.itemId === form.itemId)?.item.name || ''} disabled />
              </div>
              <div className="form-group">
                <label>Target Channel</label>
                <input className="input" value={items.find(i => i.channelId === form.channelId)?.channel.name || ''} disabled />
              </div>
              <div className="form-group">
                <label>Actual Cost Price (KES)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="input" 
                  placeholder="Enter correct cost..." 
                  value={form.newCost} 
                  required
                  onChange={e => setForm({ ...form, newCost: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Retail Price (Optional)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="input" 
                  placeholder="Optional retail price fix..." 
                  value={form.newRetail} 
                  onChange={e => setForm({ ...form, newRetail: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={form.repairRecentSales} 
                    onChange={e => setForm({ ...form, repairRecentSales: e.target.checked })}
                  />
                  <span style={{ fontSize: '0.9rem' }}>Retroactively repair 0-cost sales</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  This will also unlock and recalculate commissions for staff who were skipped due to the missing cost.
                </p>
              </div>

              <button className="btn btn-primary" style={{ width: '100%' }} disabled={!!repairing}>
                {repairing ? 'Repairing Data...' : 'Confirm & Apply Fix'}
              </button>
              <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setForm({ ...form, itemId: '' })}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>☝️</div>
              <p>Select an item from the list to begin the repair process.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
