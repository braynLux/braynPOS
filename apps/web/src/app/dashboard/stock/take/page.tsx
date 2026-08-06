'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface StockTake {
  id: string
  createdAt: string
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED'
  channel: { name: string }
  startedByUser: { username: string }
}

interface Channel {
  id: string
  name: string
}

export default function StockTakePage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const router = useRouter()
  const [takes, setTakes] = useState<StockTake[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [loading, setLoading] = useState(true)
  const canChooseChannel = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(user?.role || '')

  useEffect(() => {
    if (token) {
      Promise.all([
        api.get<StockTake[]>('/stock/take', token),
        canChooseChannel ? api.get<Channel[]>('/channels', token) : Promise.resolve([]),
      ])
        .then(([stockTakes, channelList]) => {
          setTakes(stockTakes)
          setChannels(channelList)
          if (!selectedChannelId && channelList.length > 0) setSelectedChannelId(channelList[0].id)
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [token, canChooseChannel, selectedChannelId])

  const handleStartNew = async () => {
    const channelId = canChooseChannel ? selectedChannelId : user?.channelId
    if (!token || !channelId) return alert('Select a channel before starting a stock take')
    try {
      const res = await api.post<StockTake>('/stock/take', { channelId }, token)
      router.push(`/dashboard/stock/take/${res.id}`)
    } catch (err) {
      alert('Failed to start stock take: ' + (err as Error).message)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>Stock Takes (Physical Count)</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            🛡️ <span>72hr Purge Policy: <strong>Enabled</strong></span>
          </div>
          {canChooseChannel && (
            <select
              className="input"
              value={selectedChannelId}
              onChange={e => setSelectedChannelId(e.target.value)}
              style={{ minWidth: 220 }}
              aria-label="Stock take channel"
            >
              {channels.length === 0 ? (
                <option value="">No channels available</option>
              ) : channels.map(channel => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={handleStartNew}>+ Start New Take</button>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        ℹ️ <strong>System Policy:</strong> To ensure inventory accuracy, any stock take that remains in &quot;OPEN&quot; status for more than 72 hours without completion will be automatically cancelled.
      </div>

      <div className="table-container card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Started By</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center">Loading...</td></tr>
            ) : takes.length === 0 ? (
              <tr><td colSpan={5} className="text-center">No stock takes found</td></tr>
            ) : (
              takes.map(t => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td>{t.channel.name}</td>
                  <td>
                    <span className={`badge badge-${t.status === 'OPEN' ? 'warning' : t.status === 'COMPLETED' ? 'success' : 'danger'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>{t.startedByUser.username}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/dashboard/stock/take/${t.id}`} className="btn btn-ghost btn-sm">View Details</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
