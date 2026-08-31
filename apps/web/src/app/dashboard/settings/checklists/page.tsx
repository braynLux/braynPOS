'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'react-hot-toast'

interface ChecklistField {
  label:    string
  type:     'CHECKBOX' | 'TEXT' | 'NUMBER'
  required: boolean
}

interface ServiceChecklist {
  id:        string
  name:      string
  channelId: string
  fields:    ChecklistField[]
  createdAt: string
}

interface Channel {
  id: string
  name: string
}

export default function ChecklistDesignerPage() {
  const token = useAuthStore(s => s.accessToken)
  const user = useAuthStore(s => s.user)
  const [checklists, setChecklists] = useState<ServiceChecklist[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name:     '',
    fields:   [] as ChecklistField[]
  })
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')

  useEffect(() => {
    if (!token) return
    fetchChecklists()
    if (canChooseChannel) {
      api.get<Channel[]>('/channels', token)
        .then(channelList => {
          setChannels(channelList)
          if (!selectedChannelId && channelList.length > 0) setSelectedChannelId(channelList[0].id)
        })
        .catch(console.error)
    }
  }, [token, canChooseChannel, selectedChannelId])

  const fetchChecklists = async () => {
    try {
      const res = await api.get<ServiceChecklist[]>('/settings/checklists', token!)
      setChecklists(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const addField = () => {
    setForm({
      ...form,
      fields: [...form.fields, { label: '', type: 'CHECKBOX', required: false }]
    })
  }

  const removeField = (index: number) => {
    setForm({
      ...form,
      fields: form.fields.filter((_, i) => i !== index)
    })
  }

  const updateField = (index: number, updates: Partial<ChecklistField>) => {
    const newFields = [...form.fields]
    newFields[index] = { ...newFields[index], ...updates }
    setForm({ ...form, fields: newFields })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.fields.length === 0) {
      toast.error('Add at least one field to the checklist')
      return
    }
    const channelId = canChooseChannel ? selectedChannelId : user?.channelId
    if (!channelId) {
      toast.error('Select a channel for this checklist')
      return
    }
    setSaving(true)
    try {
      await api.post('/settings/checklists', { 
        ...form, 
        channelId,
      }, token!)
      toast.success('Checklist template created')
      setShowAdd(false)
      fetchChecklists()
      setForm({ name: '', fields: [] })
    } catch (err: any) {
      toast.error('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this checklist?')) return
    try {
      await api.delete(`/settings/checklists/${id}`, token!)
      toast.success('Checklist removed')
      fetchChecklists()
    } catch (err) {
       toast.error('Failed to delete')
    }
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: 60 }}>
      <div className="page-header">
        <div>
          <h1>Service Checklist Designer</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Define custom intake forms for repairs and services</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Create Checklist</button>
      </div>

      {showAdd && (
        <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: 600, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginBottom: 20 }}>New Checklist Template</h2>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="form-group">
                <label>Checklist Name *</label>
                <input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Car Intake Form" />
              </div>
              {canChooseChannel && (
                <div className="form-group">
                  <label>Channel *</label>
                  <select className="input" required value={selectedChannelId} onChange={e => setSelectedChannelId(e.target.value)}>
                    <option value="">Select channel...</option>
                    {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                  </select>
                </div>
              )}
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0 }}>Fields & Inspections</h4>
                  <button type="button" className="btn btn-ghost" onClick={addField}>+ Add Field</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {form.fields.map((f, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 40px', gap: 12, alignItems: 'center', padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <input className="input" placeholder="Field Label (e.g. Fuel Level)" value={f.label} onChange={e => updateField(i, { label: e.target.value })} required />
                      <select className="input" value={f.type} onChange={e => updateField(i, { type: e.target.value as any })}>
                        <option value="CHECKBOX">Checkbox</option>
                        <option value="TEXT">Text</option>
                        <option value="NUMBER">Number</option>
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                        <input type="checkbox" checked={f.required} onChange={e => updateField(i, { required: e.target.checked })} />
                        Req.
                      </label>
                      <button type="button" onClick={() => removeField(i)} style={{ color: 'var(--danger)', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                  {form.fields.length === 0 && (
                     <div style={{ textAlign: 'center', padding: 20, border: '2px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
                        No fields added yet. Click &quot;Add Field&quot; to start.
                     </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'Creating Template...' : 'Save Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading checklist templates...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24, marginTop: 24 }}>
          {checklists.length === 0 ? (
            <div style={{
              gridColumn: '1/-1',
              textAlign: 'center',
              padding: '60px 24px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}>
              <span style={{ fontSize: '2.5rem' }}>📋</span>
              <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>No Service Checklists Defined</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 460 }}>
                Create custom intake forms for repairs, vehicle inspections, or equipment diagnostic workflows.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)} style={{ marginTop: 8 }}>
                + Create First Checklist
              </button>
            </div>
          ) : (
            checklists.map(c => (
              <div key={c.id} className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{c.name}</h3>
                  <button style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => handleDelete(c.id)}>🗑️</button>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {c.fields.length} inspection fields defined
                </div>
                <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {c.fields.slice(0, 3).map((f, i) => (
                    <span key={i} className="badge badge-outline" style={{ fontSize: '0.65rem' }}>{f.label}</span>
                  ))}
                  {c.fields.length > 3 && <span className="badge badge-outline" style={{ fontSize: '0.65rem' }}>+{c.fields.length - 3} more</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
