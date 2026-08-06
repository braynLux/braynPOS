'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'react-hot-toast'

interface FixedAsset {
  id:               string
  name:             string
  code:             string
  category:         string
  purchaseDate:     string
  purchasePrice:    number
  depreciationRate: number
  currentValue:     number
  bookValue:        number
  notes?:           string
}
interface Channel { id: string; name: string }

export default function FixedAssetsPage() {
  const token = useAuthStore(s => s.accessToken)
  const user = useAuthStore(s => s.user)
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState(user?.channelId || '')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const isHQ = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')
  
  const [form, setForm] = useState({
    name: '',
    code: '',
    category: 'GENERAL',
    purchaseDate: new Date().toISOString().split('T')[0],
    purchasePrice: 0,
    depreciationRate: 12.5, // Standard default
    channelId: user?.channelId || '',
    notes: ''
  })

  useEffect(() => {
    if (!token) return
    if (isHQ) {
      api.get<Channel[]>('/channels', token)
        .then(res => {
          const list = Array.isArray(res) ? res : [res as unknown as Channel]
          setChannels(list)
          setSelectedChannelId(prev => prev || user?.channelId || list[0]?.id || '')
        })
        .catch(console.error)
    } else {
      setSelectedChannelId(user?.channelId || '')
    }
  }, [token, isHQ, user?.channelId])

  useEffect(() => {
    if (!token) return
    if (isHQ && !selectedChannelId) return
    fetchAssets()
  }, [token, isHQ, selectedChannelId])

  const fetchAssets = async () => {
    try {
      const query = isHQ && selectedChannelId ? `?channelId=${selectedChannelId}` : ''
      const res = await api.get<FixedAsset[]>(`/accounting/assets${query}`, token!)
      setAssets(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const channelId = isHQ ? selectedChannelId : user?.channelId
    if (!channelId) return toast.error('Select a channel before registering an asset')
    setSaving(true)
    try {
      await api.post('/accounting/assets', { ...form, channelId }, token!)
      toast.success('Asset registered successfully')
      setShowAdd(false)
      fetchAssets()
      setForm({
        name: '', code: '', category: 'GENERAL',
        purchaseDate: new Date().toISOString().split('T')[0],
        purchasePrice: 0, depreciationRate: 12.5, channelId, notes: ''
      })
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n)

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1>Fixed Asset Register</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Track equipment, furniture, and machinery depreciation</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Register New Asset</button>
      </div>

      {showAdd && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', padding: 24 }}>
            <h2 style={{ marginBottom: 20 }}>Register New Asset</h2>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isHQ && (
                <div className="form-group">
                  <label>Channel *</label>
                  <select className="input" required value={selectedChannelId} onChange={e => setSelectedChannelId(e.target.value)}>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Asset Name *</label>
                <input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Delivery Van KCA 123X" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label>Asset Code (Tag) *</label>
                  <input className="input" required value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="FA-001" />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="input" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                    <option value="GENERAL">General</option>
                    <option value="FURNITURE">Furniture & Fittings</option>
                    <option value="COMPUTER">IT & Computer Equipment</option>
                    <option value="MACHINERY">Plant & Machinery</option>
                    <option value="MOTOR_VEHICLE">Motor Vehicles</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label>Purchase Date *</label>
                  <input type="date" className="input" required value={form.purchaseDate} onChange={e => setForm({...form, purchaseDate: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Depreciation Rate (%) *</label>
                  <input type="number" step="0.01" className="input" required value={form.depreciationRate} onChange={e => setForm({...form, depreciationRate: Number(e.target.value)})} />
                </div>
              </div>
              <div className="form-group">
                <label>Purchase Price (Cost) *</label>
                <input type="number" className="input" required value={form.purchasePrice} onChange={e => setForm({...form, purchasePrice: Number(e.target.value)})} />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Supplier, Warranty details, etc." />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'Processing...' : 'Register Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading asset register...</div>
      ) : (
        <div className="card" style={{ marginTop: 24 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Asset Details</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Initial Cost</th>
                <th style={{ textAlign: 'right' }}>Annual Depr. %</th>
                <th style={{ textAlign: 'right' }}>Current Book Value</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No fixed assets registered yet.</td></tr>
              ) : (
                assets.map(a => (
                  <tr key={a.id}>
                    <td><span className="badge badge-outline">{a.code}</span></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Purchased: {new Date(a.purchaseDate).toLocaleDateString()}</div>
                    </td>
                    <td><span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>{a.category.replace('_', ' ')}</span></td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(a.purchasePrice)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--warning)' }}>{a.depreciationRate}%</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--success)' }}>{formatCurrency(a.bookValue)}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>Accumulated: {formatCurrency(a.purchasePrice - a.bookValue)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{ padding: '16px 20px', background: 'rgba(99, 102, 241, 0.03)', borderTop: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            💡 <strong>Note:</strong> Book value is calculated automatically using the straight-line depreciation method from the date of purchase.
          </div>
        </div>
      )}
    </div>
  )
}
