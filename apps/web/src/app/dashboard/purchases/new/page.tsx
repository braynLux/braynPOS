'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface Item { id: string; name: string; sku: string; weightedAvgCost: number }
interface Supplier { id: string; name: string }
interface Channel { id: string; name: string }
interface LPO { id: string; orderNo: string; supplierId: string; channelId?: string; channel?: Channel; lines: any[] }

export default function NewPurchasePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preFilledLpoId = searchParams.get('lpoId')
  
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)

  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [lpos, setLpos] = useState<LPO[]>([])
  const [loading, setLoading] = useState(false)
  const [itemSearch, setItemSearch] = useState<string[]>([]) // For filtering item selects
  
  const [showQuickSup, setShowQuickSup] = useState(false)
  const [quickSupName, setQuickSupName] = useState('')
  const [quickSupPhone, setQuickSupPhone] = useState('')

  
  const [supplierId, setSupplierId] = useState('')
  const [lpoId, setLpoId] = useState(preFilledLpoId || '')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ id: string; itemId: string; quantity: number; unitCost: number; retailPrice: number; wholesalePrice: number; search: string; items: Item[]; serialNumbers?: string; isSerialized?: boolean }[]>([])
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '')

  const searchItems = async (index: number, query: string) => {
    if (!token || query.length < 2) return
    try {
      const res = await api.get<{ data: Item[] }>(`/items?search=${encodeURIComponent(query)}`, token)
      setLines(prev => {
        const newLines = [...prev]
        newLines[index].items = res.data || []
        return newLines
      })
    } catch (err) { console.error(err) }
  }



  useEffect(() => {
    if (!token) return
    
    const fetchData = async () => {
      try {
        const [itemsRes, suppRes, lposRes, channelsRes] = await Promise.all([
          api.get<{ data: Item[] }>('/items?limit=100', token),
          api.get<Supplier[]>('/items/suppliers', token),
          api.get<{ data: LPO[] }>('/purchases/lpo?limit=100', token).catch(() => ({ data: [] })),
          canChooseChannel ? api.get<Channel[]>('/channels', token) : Promise.resolve([]),
        ])
        
        setItems(itemsRes.data)
        setSuppliers(suppRes)
        setLpos(lposRes.data || [])
        setChannels(channelsRes)

        if (!selectedChannelId) {
          const defaultChannel = user?.channelId || channelsRes[0]?.id || ''
          if (defaultChannel) setSelectedChannelId(defaultChannel)
        }

        if (preFilledLpoId) {
          const lpoDetails = await api.get<LPO>(`/purchases/lpo/${preFilledLpoId}`, token)
          if (lpoDetails) {
            setSupplierId(lpoDetails.supplierId)
            setLpoId(lpoDetails.id)
            setSelectedChannelId(lpoDetails.channelId || lpoDetails.channel?.id || selectedChannelId)
            setLines(lpoDetails.lines.map((l: any) => ({
              id: Math.random().toString(36).slice(2),
              itemId: l.itemId,
              quantity: l.quantity - (l.receivedQty || 0),
              unitCost: Number(l.unitCost),
              retailPrice: 0,
              wholesalePrice: 0,
              search: l.item.sku,
              items: [l.item]
            })))
          }
        } else if (suppRes.length > 0) {
          setSupplierId(suppRes[0].id)
        }
      } catch (err) {
        console.error('Fetch failed:', err)
      }
    }

    fetchData()
  }, [token, preFilledLpoId, canChooseChannel, selectedChannelId, user?.channelId])

  const handleQuickSup = async () => {
    if (!quickSupName.trim()) return
    setLoading(true)
    try {
      const res = await api.post<Supplier>('/items/suppliers', { name: quickSupName, phone: quickSupPhone }, token!)
      // Refresh suppliers list
      const suppRes = await api.get<Supplier[]>('/items/suppliers', token!)
      setSuppliers(suppRes)
      setSupplierId(res.id)
      setShowQuickSup(false)
      setQuickSupName('')
      setQuickSupPhone('')
      toast.success('Supplier created!')
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
    finally { setLoading(false) }
  }

  const addLine = () => {
    setLines([...lines, { id: Math.random().toString(36).slice(2), itemId: '', quantity: 1, unitCost: 0, retailPrice: 0, wholesalePrice: 0, search: '', items: [] }])
  }
  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx))
  }

  const updateLine = (idx: number, field: string, val: string | number) => {
    const newLines = [...lines]
    newLines[idx] = { ...newLines[idx], [field]: val }
    setLines(newLines)
  }

  const handleItemChange = (idx: number, itemId: string) => {
    const item = lines[idx].items.find(i => i.id === itemId) || items.find(i => i.id === itemId)
    const newLines = [...lines]
    newLines[idx] = { 
      ...newLines[idx], 
      itemId, 
      unitCost: item ? Number(item.weightedAvgCost || 0) : 0,
      retailPrice: item ? Number((item as any).retailPrice || 0) : 0,
      wholesalePrice: item ? Number((item as any).wholesalePrice || 0) : 0,
      isSerialized: (item as any)?.isSerialized || false
    }
    setLines(newLines)
  }

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Clear validation check
    const invalidLines = lines.filter(l => !l.itemId)
    if (invalidLines.length > 0) return toast.error('Error: At least one line has no item selected.')
    if (!supplierId) return toast.error('Error: Please select a supplier.')
    if (lines.length === 0) return toast.error('Error: Please add at least one line item.')
    const channelId = canChooseChannel ? selectedChannelId : user?.channelId
    if (!channelId) return toast.error('Error: Please select a channel.')

    // Serial number validation
    for (const line of lines) {
      if (line.isSerialized) {
        const sns = line.serialNumbers?.split('\n').map(s => s.trim()).filter(Boolean) || []
        if (sns.length !== Number(line.quantity)) {
          return toast.error(`Error: Item ${line.search} is serialized. Expected ${line.quantity} serial numbers, but found ${sns.length}. Please enter each serial on a new line.`)
        }
      }
    }

    setLoading(true)
    
    try {
      await api.post('/purchases/commit', {
        supplierId,
        channelId,
        purchaseOrderId: lpoId || undefined,
        lines: lines.map(l => ({ 
          itemId: l.itemId, 
          quantity: Number(l.quantity), 
          unitCost: Number(l.unitCost),
          retailPrice: Number(l.retailPrice) || undefined,
          wholesalePrice: Number(l.wholesalePrice) || undefined,
          serialNumbers: l.isSerialized ? l.serialNumbers?.split('\n').map(s => s.trim()).filter(Boolean) : undefined
        })),
        notes: notes || undefined
      }, token!)

      toast.success('Purchase committed successfully!')
      router.push('/dashboard/purchases')
    } catch (err) {
      console.error('Commit failed:', err)
      toast.error('Failed to commit purchase: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) * Number(l.unitCost)), 0)

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1>Receive New Purchase</h1>
        <button className="btn btn-ghost" onClick={() => router.back()}>← Back</button>
      </div>

      <form onSubmit={handleCommit} className="card" style={{ padding: 24, maxWidth: 800 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {canChooseChannel && (
            <div className="form-group" style={{ flex: 1 }}>
              <label>Channel</label>
              <select className="input" value={selectedChannelId} onChange={e => setSelectedChannelId(e.target.value)} required>
                <option value="">Select Channel...</option>
                {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ marginBottom: 0 }}>Supplier</label>
              <Link href="/dashboard/items/suppliers" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: '0.75em', color: 'var(--accent)' }}>
                + New
              </Link>
            </div>
            <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
              <option value="">Select Supplier...</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>LPO Reference (Optional)</label>
            <select className="input" value={lpoId} onChange={e => setLpoId(e.target.value)}>
              <option value="">No LPO Reference</option>
              {lpos.map(l => <option key={l.id} value={l.id}>{l.orderNo}</option>)}
            </select>
          </div>
        </div>

        <h3 style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          Items Received
          <Link href="/dashboard/items" style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 400 }}>+ Create New Item</Link>
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {lines.map((line, idx) => (
            <div key={line.id} style={{ border: line.itemId ? '1px solid var(--border)' : '1px solid var(--danger)', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <input 
                  className="input" 
                  style={{ flex: 1 }} 
                  placeholder="🔍 Search SKU or Name..." 
                  value={line.search} 
                  onChange={e => {
                    updateLine(idx, 'search', e.target.value)
                    searchItems(idx, e.target.value)
                  }}
                />
                <select 
                  className="input" 
                  style={{ flex: 3, border: line.itemId ? undefined : '1px solid var(--danger)' }}
                  value={line.itemId} 
                  onChange={e => handleItemChange(idx, e.target.value)}
                >
                  <option value="">Status: {line.itemId ? '✅ Selected' : '❌ Required'}</option>
                  {(line.items.length > 0 ? line.items : items.filter(i => !line.search || i.name.toLowerCase().includes(line.search) || i.sku.toLowerCase().includes(line.search))).map((i: Item) => <option key={i.id} value={i.id}>{i.sku} - {i.name}</option>)}
                </select>
                <button 
                  type="button" 
                  className="btn btn-ghost btn-sm" 
                  style={{ color: 'var(--danger)' }} 
                  onClick={() => removeLine(idx)}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Quantity</span>
                  <input 
                    type="number" 
                    className="input" 
                    min="1" 
                    value={line.quantity} 
                    onChange={e => updateLine(idx, 'quantity', e.target.value)} 
                    required 
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Buy Price</span>
                  <input 
                    type="number" 
                    className="input" 
                    min="0"
                    step="0.01" 
                    value={line.unitCost} 
                    onChange={e => updateLine(idx, 'unitCost', e.target.value)} 
                    required 
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Retail</span>
                  <input 
                    type="number" 
                    className="input" 
                    min="0"
                    step="0.01" 
                    value={line.retailPrice || ''} 
                    onChange={e => updateLine(idx, 'retailPrice', e.target.value)} 
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Wholesale</span>
                  <input 
                    type="number" 
                    className="input" 
                    min="0"
                    step="0.01" 
                    value={line.wholesalePrice || ''} 
                    onChange={e => updateLine(idx, 'wholesalePrice', e.target.value)} 
                  />
                </div>
                <div style={{ width: 100, textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>
                  {new Intl.NumberFormat('en-KE').format(Number(line.quantity) * Number(line.unitCost))}
                </div>
              </div>
              
              {line.isSerialized && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Serial Numbers (one per line, expected: {line.quantity})
                  </label>
                  <textarea 
                    className="input" 
                    placeholder="Enter serial numbers here..." 
                    style={{ minHeight: 80, fontSize: '0.9rem', fontFamily: 'monospace' }}
                    value={line.serialNumbers || ''}
                    onChange={e => updateLine(idx, 'serialNumbers', e.target.value)}
                    required
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>+ Add Line Item</button>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
            Total: {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(total)}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 24 }}>
          <label>Internal Notes</label>
          <textarea 
            className="input" 
            rows={3} 
            value={notes} 
            onChange={e => setNotes(e.target.value)} 
            placeholder="Delivery note numbers, remarks, etc." 
          />
        </div>

        <button 
          type="submit" 
          className="btn btn-primary btn-lg" 
          disabled={loading || lines.length === 0} 
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? 'Committing...' : '✅ Commit Purchase to Ledger'}
        </button>
      </form>
    </div>
  )
}
