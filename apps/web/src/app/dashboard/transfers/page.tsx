'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { toast } from 'react-hot-toast'

interface Channel { id: string; name: string; code: string }
interface Item { id: string; name: string; sku: string }
interface TransferLine { itemId: string; quantity: number }
interface Transfer {
  id: string; transferNo: string; status: string; notes?: string; createdAt: string
  fromChannelId: string; toChannelId: string
  fromChannel: { name: string }; toChannel: { name: string }
  lines: { id: string; itemId: string; sentQuantity: number; receivedQuantity?: number; item?: { name: string; sku: string } }[]
}

export default function TransfersPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user  = useAuthStore((s) => s.user)

  const [transfers, setTransfers]   = useState<Transfer[]>([])
  const [channels, setChannels]     = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [items, setItems]           = useState<Item[]>([])
  const [search, setSearch]         = useState('')
  const [loading, setLoading]       = useState(true)
  const [showModal, setShowModal]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Default to today
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])

  const [form, setForm]   = useState({ fromChannelId: '', toChannelId: '', notes: '' })
  const [lines, setLines] = useState<TransferLine[]>([{ itemId: '', quantity: 1 }])

  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null)
  const [loadingReceive, setLoadingReceive]      = useState(false)
  const [receiving, setReceiving]                = useState(false)
  const [receiveLines, setReceiveLines]          = useState<{
    itemId: string; name: string; sentQuantity: number; receivedQuantity: number; disputeReason: string
  }[]>([])

  const fetchAll = async () => {
    if (!token) return
    try {
      const start = new Date(startDate)
      start.setHours(0,0,0,0)
      const end = new Date(endDate)
      end.setHours(23,59,59,999)

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate:   end.toISOString(),
      })
      if (selectedChannel) params.append('channelId', selectedChannel)

      const [tRes, cRes, iRes] = await Promise.all([
        api.get<{ data: Transfer[] }>(`/transfers?${params.toString()}`, token),
        api.get<Channel[]>('/channels', token),
        api.get<{ data: Item[] }>('/items?limit=100', token),
      ])
      setTransfers(tRes.data ?? [])
      setChannels(Array.isArray(cRes) ? cRes : [cRes as unknown as Channel])
      setItems(iRes.data ?? [])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const getExportData = async () => {
    return filtered.map(t => [
        t.transferNo,
        t.fromChannel?.name,
        t.toChannel?.name,
        t.lines?.map(l => `${l.item?.name} (${l.sentQuantity})`).join(', '),
        t.status,
        new Date(t.createdAt).toLocaleDateString()
    ])
  }

  useEffect(() => { fetchAll() }, [token, startDate, endDate, selectedChannel])

  const addLine    = () => setLines([...lines, { itemId: '', quantity: 1 }])
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i))
  const setLine    = (i: number, field: keyof TransferLine, val: string | number) =>
    setLines(lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.fromChannelId || !form.toChannelId) {
      if (channels.length <= 1) return toast.error('You need at least 2 channels to create a transfer.')
      return toast.error('Select both From and To channels')
    }
    if (lines.some(l => !l.itemId || l.quantity < 1)) return toast.error('Complete all line items')
    setSaving(true)
    try {
      const result = await api.post<{ id: string; transferNo: string }>('/transfers', { ...form, lines }, token!)
      setShowModal(false)
      setForm({ fromChannelId: '', toChannelId: '', notes: '' })
      setLines([{ itemId: '', quantity: 1 }])
      setSuccessMsg(`✅ Transfer ${result.transferNo || 'created'} successfully!`)
      toast.success('Transfer created successfully')
      setTimeout(() => setSuccessMsg(''), 6000)
      fetchAll()
    } catch (err) { toast.error('Transfer failed: ' + (err as Error).message) }
    finally { setSaving(false) }
  }

  // FIX: Fetch the full transfer detail when clicking Receive.
  // The list endpoint may return transfers with empty or partial lines
  // depending on query depth. Fetching by ID guarantees we get all
  // line items with their sentQuantity populated before building receiveLines.
  const startReceive = async (t: Transfer) => {
    setLoadingReceive(true)
    try {
      const full = await api.get<Transfer>(`/transfers/${t.id}`, token!)
      const transferLines = full.lines ?? []

      if (transferLines.length === 0) {
        toast.error('This transfer has no line items — cannot receive.')
        return
      }

      setSelectedTransfer(full)
      setReceiveLines(transferLines.map(l => ({
        itemId:           l.itemId,
        name:             l.item?.name || 'Item',
        sentQuantity:     l.sentQuantity ?? 0,
        receivedQuantity: l.sentQuantity ?? 0,  // default to full receipt
        disputeReason:    '',
      })))
    } catch (err) {
      toast.error('Could not load transfer details: ' + (err as Error).message)
    } finally {
      setLoadingReceive(false)
    }
  }

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTransfer) return

    // FIX: Guard — never send an empty lines array
    if (receiveLines.length === 0) {
      toast.error('No line items to receive. Please reload the transfer.')
      return
    }

    setReceiving(true)
    try {
      await api.post(`/transfers/${selectedTransfer.id}/receive`, {
        lines: receiveLines.map(l => ({
          itemId:           l.itemId,
          receivedQuantity: l.receivedQuantity,
          ...(l.disputeReason && { disputeReason: l.disputeReason }),
        })),
      }, token!)
      toast.success('Transfer received successfully')
      setSelectedTransfer(null)
      setReceiveLines([])
      fetchAll()
    } catch (err) {
      toast.error('Failed to receive: ' + (err as Error).message)
    } finally {
      setReceiving(false)
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'RECEIVED': return 'badge-success'
      case 'SENT':     return 'badge-warning'
      case 'DISPUTED': return 'badge-danger'
      case 'REJECTED': return 'badge-danger'
      default:         return 'badge-info'
    }
  }

  const filtered = transfers.filter(t =>
    !search ||
    t.transferNo.toLowerCase().includes(search.toLowerCase()) ||
    t.fromChannel?.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.toChannel?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const userChannelId = user?.channelId
  const isAdmin       = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'PLATFORM_OWNER'].includes(user?.role || '')
  const isStorekeeper  = user?.role === 'STOREKEEPER'

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Transfers</h1>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ExportMenu 
            title="Transfers_Report"
            headers={['Transfer #', 'From Channel', 'To Channel', 'Items (Qty)', 'Status', 'Date']}
            getData={getExportData}
          />
          {['SUPER_ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'PLATFORM_OWNER'].includes(user?.role || '') && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Transfer</button>
          )}
        </div>
      </div>

      {successMsg && (
        <div style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid var(--success)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input 
          className="input" 
          placeholder="🔍 Search Transfer # or Channel..." 
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
            <thead>
              <tr>
                <th>Ref</th><th>From</th><th>To</th><th>Items</th>
                <th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No transfers{search ? ` matching "${search}"` : ' yet'}.
                </td></tr>
              ) : filtered.map(t => (
                <tr key={t.id}>
                  <td data-label="Ref"><code style={{ fontSize: '0.78rem' }}>{t.transferNo}</code></td>
                  <td data-label="From">{t.fromChannel?.name}</td>
                  <td data-label="To">{t.toChannel?.name}</td>
                  <td data-label="Items">
                    {t.lines?.map((l, i) => (
                      <div key={i} style={{ fontSize: '0.8rem' }}>
                        {l.item?.name || 'Item'} × {l.sentQuantity}
                      </div>
                    ))}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${statusColor(t.status)}`}>{t.status}</span>
                  </td>
                  <td data-label="Date" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td data-label="Actions" style={{ textAlign: 'right' }}>
                    {t.status === 'SENT' && (isAdmin || t.toChannelId === userChannelId) && (
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => startReceive(t)}
                        disabled={loadingReceive}
                      >
                        {loadingReceive ? '...' : 'Receive'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── New Transfer Modal ───────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>🔄 New Transfer</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 180px' }}>
                  <label>From Channel *</label>
                  <select className="input" value={form.fromChannelId}
                    onChange={e => setForm({ ...form, fromChannelId: e.target.value, toChannelId: '' })} required>
                    <option value="">Select source...</option>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: '1 1 180px' }}>
                  <label>To Channel *</label>
                  <select className="input" value={form.toChannelId}
                    onChange={e => setForm({ ...form, toChannelId: e.target.value })} required>
                    <option value="">Select destination...</option>
                    {channels.filter(c => c.id !== form.fromChannelId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {channels.length <= 1 && <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: 4 }}>⚠️ Add a second channel to enable transfers.</p>}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong>Items to Transfer</strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>+ Add Item</button>
                </div>
                {lines.map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <select className="input" style={{ flex: 3 }} value={line.itemId}
                      onChange={e => setLine(i, 'itemId', e.target.value)} required>
                      <option value="">Select item...</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>)}
                    </select>
                    <input type="number" className="input" style={{ flex: 1 }} min="1"
                      value={line.quantity} onChange={e => setLine(i, 'quantity', Number(e.target.value))}
                      placeholder="Qty" required />
                    {lines.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => removeLine(i)} style={{ color: 'var(--danger)' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label>Notes</label>
                <input className="input" value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional transfer notes..." />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || channels.length <= 1}>
                  {saving ? 'Creating...' : 'Create Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Receive Transfer Modal ───────────────────────────────── */}
      {selectedTransfer && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>📥 Receive: {selectedTransfer.transferNo}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedTransfer(null); setReceiveLines([]) }}>✕</button>
            </div>

            <form onSubmit={handleReceiveSubmit}>
              <p style={{ marginBottom: 16, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Verify quantities received at <strong>{selectedTransfer.toChannel?.name}</strong>.
              </p>

              {receiveLines.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No line items found for this transfer.
                </div>
              ) : (
                <table className="table" style={{ marginBottom: 20 }}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ textAlign: 'center' }}>Sent</th>
                      <th style={{ width: 110 }}>Received</th>
                      <th>Dispute Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiveLines.map((line, idx) => (
                      <tr key={line.itemId}>
                        <td data-label="Item">{line.name}</td>
                        <td data-label="Sent" style={{ textAlign: 'center' }}>{line.sentQuantity}</td>
                        <td data-label="Received">
                          <input
                            type="number"
                            className="input"
                            min="0"
                            max={line.sentQuantity}
                            value={line.receivedQuantity}
                            onChange={e => {
                              const val = Number(e.target.value)
                              setReceiveLines(prev => prev.map((l, i) => i === idx ? { ...l, receivedQuantity: val } : l))
                            }}
                            required
                            style={{ minHeight: 40 }}
                          />
                        </td>
                        <td data-label="Dispute">
                          <input
                            className="input"
                            value={line.disputeReason}
                            onChange={e => {
                              const val = e.target.value
                              setReceiveLines(prev => prev.map((l, i) => i === idx ? { ...l, disputeReason: val } : l))
                            }}
                            placeholder={line.receivedQuantity < line.sentQuantity ? 'Reason for shortage...' : ''}
                            required={line.receivedQuantity < line.sentQuantity}
                            style={{ minHeight: 40 }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost"
                  onClick={() => { setSelectedTransfer(null); setReceiveLines([]) }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-success"
                  disabled={receiving || receiveLines.length === 0}>
                  {receiving ? 'Processing...' : 'Confirm Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
