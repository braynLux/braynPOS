'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Item {
  id: string
  name: string
  sku: string
  weightedAvgCost: number
}

interface Supplier {
  id: string
  name: string
}

interface Channel {
  id: string
  name: string
}

interface LPOLine {
  id: string
  itemId: string
  itemSearch: string
  quantity: number
  unitCost: number
  items: Item[]
}

export default function NewLPOPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [lines, setLines] = useState<LPOLine[]>([])
  const [notes, setNotes] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '')

  useEffect(() => {
    if (!token) return
    Promise.all([
      api.get<Supplier[]>('/items/suppliers', token),
      canChooseChannel ? api.get<Channel[]>('/channels', token) : Promise.resolve([]),
    ])
      .then(([supplierList, channelList]) => {
        setSuppliers(supplierList)
        setChannels(channelList)
        if (!selectedChannelId) {
          const defaultChannel = user?.channelId || channelList[0]?.id || ''
          if (defaultChannel) setSelectedChannelId(defaultChannel)
        }
      })
      .catch(console.error)
  }, [token, canChooseChannel, selectedChannelId, user?.channelId])

  const addLine = () => {
    setLines([...lines, { 
      id: Math.random().toString(36).substr(2, 9), 
      itemId: '', 
      itemSearch: '', 
      quantity: 1, 
      unitCost: 0,
      items: [] 
    }])
  }

  const removeLine = (id: string) => {
    setLines(lines.filter(l => l.id !== id))
  }

  const searchItems = async (index: number, query: string) => {
    if (!token || query.length < 2) return
    try {
      const res = await api.get<{ data: Item[] }>(`/items?search=${encodeURIComponent(query)}`, token)
      setLines(prev => {
        const newLines = [...prev]
        newLines[index].items = res.data || []
        return newLines
      })
    } catch (err) {
      console.error(err)
    }
  }

  const updateLine = (index: number, field: keyof LPOLine, value: any) => {
    const newLines = [...lines]
    // @ts-ignore
    newLines[index][field] = value
    setLines(newLines)
  }

  const handleSubmit = async () => {
    if (!token || !user) return
    if (!selectedSupplierId) return toast.error('Please select a supplier')
    if (lines.length === 0) return toast.error('Add at least one item')
    const channelId = canChooseChannel ? selectedChannelId : user.channelId
    if (!channelId) return toast.error('Please select a channel')
    
    for (const line of lines) {
      if (!line.itemId) return toast.error('Please select an item for all lines')
      if (line.quantity <= 0) return toast.error('Quantity must be greater than 0')
    }

    setSubmitting(true)
    try {
      await api.post('/purchases/lpo', {
        supplierId: selectedSupplierId,
        channelId,
        notes,
        ...(expectedDate && { expectedDate: new Date(expectedDate).toISOString() }),
        lines: lines.map(l => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitCost: l.unitCost
        }))
      }, token)
      toast.success('LPO draft saved successfully')
      router.push('/dashboard/purchases/lpo')
    } catch (err) {
      console.error(err)
      toast.error('Failed to create LPO: ' + (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const total = lines.reduce((sum, l) => sum + (l.quantity * l.unitCost), 0)

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>New Purchase Order (LPO)</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => router.back()}>Cancel</button>
          <button 
            className="btn btn-primary" 
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Draft LPO'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Order Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {canChooseChannel && (
                <div className="form-group">
                  <label>Channel</label>
                  <select
                    className="input"
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                  >
                    <option value="">Select Channel</option>
                    {channels.map(channel => (
                      <option key={channel.id} value={channel.id}>{channel.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Supplier</label>
                <select 
                  className="input" 
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Expected Delivery Date</label>
                <input 
                  type="datetime-local" 
                  className="input" 
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>Line Items</h3>
              <button className="btn btn-sm btn-ghost" onClick={addLine}>+ Add Item</button>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={line.id} className="grid grid-cols-12 gap-3 items-end border-b pb-3 border-border">
                  <div className="col-span-12 md:col-span-5">
                    <label className="text-xs text-muted">Search & Select Item</label>
                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                      <input 
                        type="text" 
                        className="input" 
                        style={{ width: '40%' }}
                        placeholder="Search item..."
                        value={line.itemSearch}
                        onChange={(e) => {
                          updateLine(idx, 'itemSearch', e.target.value)
                          searchItems(idx, e.target.value)
                        }}
                      />
                      <select 
                        className="input"
                        style={{ width: '60%', borderColor: line.itemId ? 'var(--primary)' : 'var(--danger)' }}
                        value={line.itemId}
                        onChange={(e) => {
                          const val = e.target.value
                          const item = line.items.find(it => it.id === val)
                          updateLine(idx, 'itemId', val)
                          if (item) updateLine(idx, 'unitCost', Number(item.weightedAvgCost))
                        }}
                      >
                        <option value="">Status: {line.itemId ? '✅ Selected' : '❌ Required'}</option>
                        {line.items.map(it => (
                          <option key={it.id} value={it.id}>{it.sku} - {it.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="text-xs text-muted">Quantity</label>
                    <input 
                      type="number" 
                      className="input" 
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-3">
                    <label className="text-xs text-muted">Unit Cost</label>
                    <input 
                      type="number" 
                      className="input" 
                      value={line.unitCost}
                      onChange={(e) => updateLine(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-2 text-right">
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => removeLine(line.id)}>Remove</button>
                  </div>
                </div>
              ))}

              {lines.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                  No items added yet. Click &quot;+ Add Item&quot; to begin.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Summary</h3>
            <div className="space-y-3">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Total Amount:</span>
                <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>KES {total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <label style={{ display: 'block', marginBottom: 8 }}>Internal Notes</label>
            <textarea 
              className="input" 
              rows={4} 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter any additional information..."
            ></textarea>
          </div>
        </div>
      </div>
    </div>
  )
}
