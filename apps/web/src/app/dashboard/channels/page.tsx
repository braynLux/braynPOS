'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { PasswordConfirmModal } from '@/components/shared/PasswordConfirmModal'
import { PhoneInput } from '@/components/shared/PhoneInput'

interface Channel { id: string; name: string; code: string; type: string; isMainWarehouse: boolean; address?: string; phone?: string }

export default function ChannelsPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', type: 'RETAIL_SHOP', address: '', phone: '', isMainWarehouse: false })
  const [error, setError] = useState('')
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null)

  const fetchChannels = async () => {
    if (!token) return
    try {
      const res = await api.get<Channel | Channel[]>('/channels', token)
      // API may return a single object or array
      if (Array.isArray(res)) setChannels(res)
      else if (res && typeof res === 'object' && 'id' in res) setChannels([res as Channel])
      else setChannels([])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchChannels() }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.code) return setError('Name and Code are required')
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name, code: form.code, type: form.type,
        isMainWarehouse: form.isMainWarehouse,
        ...(form.address && { address: form.address }),
        ...(form.phone && { phone: form.phone }),
      }
      await api.post('/channels', payload, token!)
      setShowModal(false)
      setForm({ name: '', code: '', type: 'RETAIL_SHOP', address: '', phone: '', isMainWarehouse: false })
      fetchChannels()
    } catch (err: any) {
      const requestId = err.approvalId ? ` Request ID: ${err.approvalId}` : ''
      setError(`${err.message || 'Failed to create channel.'}${requestId}`)
    }
    finally { setSaving(false) }
  }

  const handleDelete = async (password: string) => {
    if (!channelToDelete) return
    try {
      await api.delete(`/channels/${channelToDelete.id}`, token!, { password })
      setChannels(prev => prev.filter(ch => ch.id !== channelToDelete.id))
      setChannelToDelete(null)
    } catch (err: any) {
      const requestId = err.approvalId ? ` Request ID: ${err.approvalId}` : ''
      throw new Error(`${err.message || 'Deletion failed'}${requestId}`)
    }
  }

  const typeColor = (t: string) => t === 'RETAIL_SHOP' ? 'badge-primary' : t === 'WAREHOUSE' ? 'badge-warning' : 'badge-info'
  const typeLabel = (t: string) => t.replace('_', ' ')

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>Channels</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Channel</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading channels...</div>
      ) : channels.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ color: 'var(--text-muted)' }}>No channels created yet. Click &quot;+ Add Channel&quot; to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {channels.map(ch => (
            <Link key={ch.id} href={`/dashboard/channels/${ch.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ padding: 20, cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{ch.name}</h3>
                  <span className={`badge ${typeColor(ch.type)}`}>{typeLabel(ch.type)}</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0' }}>Code: <code>{ch.code}</code></p>
                {ch.address && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0' }}>📍 {ch.address}</p>}
                {ch.phone && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0' }}>📞 {ch.phone}</p>}
                {ch.isMainWarehouse && <span className="badge badge-success" style={{ marginTop: 8, display: 'inline-block' }}>Main Warehouse</span>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div style={{ color: 'var(--accent)', fontSize: '0.82rem' }}>Click to view details →</div>
                  <button 
                    className="btn btn-ghost btn-sm text-danger" 
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setChannelToDelete(ch)
                    }}
                    title="Delete Channel"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content card" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h3>🏪 Add New Channel</h3>
            {error && <p style={{ color: 'var(--danger)', fontSize: '0.9rem', marginTop: 8 }}>{error}</p>}
            <form onSubmit={handleSubmit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Channel Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Nairobi CBD Store" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Code *</label>
                  <input className="input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="NBI" maxLength={10} />
                </div>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="RETAIL_SHOP">Retail Store</option>
                  <option value="WAREHOUSE">Warehouse</option>
                  <option value="WHOLESALE_SHOP">Wholesale</option>
                  <option value="ONLINE">Online</option>
                </select>
              </div>
              <div className="form-group">
                <label>Address</label>
                <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Physical address" />
              </div>
              <PhoneInput 
                label="Phone *" 
                value={form.phone} 
                onChange={val => setForm({ ...form, phone: val })} 
              />
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isMainWarehouse} onChange={e => setForm({ ...form, isMainWarehouse: e.target.checked })} />
                <span>Set as Main Warehouse</span>
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Channel'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {channelToDelete && (
        <PasswordConfirmModal
          title="🗑️ Delete Channel"
          message={`Are you sure you want to delete ${channelToDelete.name}? This action is irreversible.`}
          onConfirm={handleDelete}
          onCancel={() => setChannelToDelete(null)}
        />
      )}
    </div>
  )
}
