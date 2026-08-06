'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/lib/api-client'
import { io, Socket } from 'socket.io-client'
import { 
  BarChart, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts'
import { Activity, BarChart2, PieChart as PieIcon } from 'lucide-react'

interface Message {
  id: string
  content: string
  sender: 'USER' | 'AI' | 'HUMAN_AGENT' | 'SYSTEM'
  senderId?: string
  createdAt: string
  isStreaming?: boolean
}

// ... Ticket interface updated ...
interface Ticket {
  id: string
  refCode: string
  subject: string
  category: string
  priority: string
  status: string
  userId: string
  updatedAt: string
  messages: Message[]
  user?: { username: string; role: string }
}

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

function ChartRenderer({ json }: { json: string }) {
  try {
    const config = JSON.parse(json)
    const { type, title, data } = config

    return (
      <div className="chart-container" style={{ 
        marginTop: 15, 
        padding: 15, 
        background: 'var(--bg-card)', 
        borderRadius: 12, 
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        width: '100%',
        minWidth: 400
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 15 }}>
          {type === 'bar' ? <BarChart2 size={18} /> : type === 'pie' ? <PieIcon size={18} /> : <Activity size={18} />}
          <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{title || 'Visual Analysis'}</h4>
        </div>
        
        <div style={{ height: 220, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={35} />
              </BarChart>
            ) : type === 'area' ? (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="var(--primary)" fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Pie data={data} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                  {data.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            ) : (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    )
  } catch (err) {
    return <div style={{ color: 'var(--error)', fontSize: '0.8rem' }}>Invalid chart data</div>
  }
}

export default function SupportPage() {
  const { user, accessToken: token } = useAuthStore()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [newMsg, setNewMsg] = useState('')
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [newTicketData, setNewTicketData] = useState({
    subject: '',
    category: 'GENERAL' as string,
    priority: 'MEDIUM' as string,
    content: '',
  })

  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 1. Socket Setup
  useEffect(() => {
    if (!token) return

    const socket = io(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/support`, {
      auth: { token }
    })

    socket.on('connect', () => console.log('Connected to Support Socket'))
    
    socket.on('message', (msg: Message) => {
      setSelectedTicket(prev => {
        if (!prev) return prev
        // Add message if not already present (avoid duplicates from POST vs Socket if any)
        if (prev.messages.find(m => m.id === msg.id)) return prev
        return { ...prev, messages: [...prev.messages, msg] }
      })
    })

    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [token, selectedTicket?.id])

  // 2. Room Join
  useEffect(() => {
    if (socketRef.current && selectedTicket?.id) {
      socketRef.current.emit('join_ticket', selectedTicket.id)
    }
  }, [selectedTicket?.id])

  const fetchTickets = async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await api.get<{ data: Ticket[] }>('/support/tickets', token)
      setTickets(res.data || [])
    } catch (error) {
      console.error('Failed to load tickets', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTicketDetails = async (id: string) => {
    if (!token) return
    try {
      const data = await api.get<Ticket>(`/support/tickets/${id}`, token)
      setSelectedTicket(data)
    } catch (error) {
      console.error('Failed to load ticket details', error)
    }
  }

  useEffect(() => {
    fetchTickets()
  }, [token])


  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    try {
      await api.post('/support/tickets', newTicketData, token)
      setShowNewTicket(false)
      fetchTickets()
      setNewTicketData({ subject: '', category: 'GENERAL', priority: 'MEDIUM', content: '' })
    } catch (error) {
      alert('Error creating ticket')
    }
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMsg.trim() || !selectedTicket || !socketRef.current) return

    socketRef.current.emit('send_message', {
      ticketId: selectedTicket.id,
      content: newMsg
    })
    setNewMsg('')
    
  }

  const handleDeleteTicket = async () => {
    if (!selectedTicket || !token) return
    if (!confirm('Are you sure you want to delete this support chat? This action cannot be undone.')) return

    try {
      await api.delete(`/support/tickets/${selectedTicket.id}`, token)
      setSelectedTicket(null)
      fetchTickets()
    } catch (err) {
      alert('Failed to delete ticket')
    }
  }

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'OPEN': return 'badge-info'
      case 'IN_PROGRESS': return 'badge-warning'
      case 'RESOLVED': return 'badge-success'
      case 'CLOSED': return 'badge-secondary'
      default: return 'badge-secondary'
    }
  }

  return (
    <div className="support-container" style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 20, padding: 10 }}>
      {/* Sidebar: Ticket List */}
      <div className="card support-sidebar" style={{ width: 320, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Support Center</h2>
            {user?.role !== 'SUPER_ADMIN' && (
              <button 
                className="btn btn-primary btn-sm"
                style={{ padding: '4px 8px' }}
                onClick={() => setShowNewTicket(true)}
              >
                + New Ticket
              </button>
            )}
          </div>
          
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            <>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>Loading...</div>
              ) : tickets.filter(t => t.subject !== 'BraynAI Session' && t.subject !== 'BRAYN AI Session' && t.subject !== 'BraynAI Portal Session' && t.subject !== 'LuxAI Portal Session').length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>No official tickets found</div>
              ) : (
                tickets.filter(t => t.subject !== 'BraynAI Session' && t.subject !== 'BRAYN AI Session' && t.subject !== 'BraynAI Portal Session' && t.subject !== 'LuxAI Portal Session').map((t) => (
                  <div
                    key={t.id}
                    onClick={() => fetchTicketDetails(t.id)}
                    className={`card ${selectedTicket?.id === t.id ? 'active' : ''}`}
                    style={{ 
                      marginBottom: 10, 
                      padding: 12, 
                      cursor: 'pointer',
                      border: selectedTicket?.id === t.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: selectedTicket?.id === t.id ? 'var(--primary-light)' : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={`badge ${getStatusClass(t.status)}`} style={{ fontSize: '0.7rem' }}>
                        {t.status}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.subject}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      {t.user?.role === 'MANAGER_ADMIN' && user?.role === 'MANAGER_ADMIN' ? 'Developer Support' : t.category} • {t.priority}
                    </div>
                  </div>
                ))
              )}
            </>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, position: 'relative' }}>
        {selectedTicket ? (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {selectedTicket.subject}
                  <span className={`badge ${getStatusClass(selectedTicket.status)}`} style={{ fontSize: '0.7rem' }}>
                    {selectedTicket.status}
                  </span>
                </h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                   Ref: {selectedTicket.refCode} • {selectedTicket.category} • From: {selectedTicket.user?.username}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '') && (
                  <button 
                    className="btn btn-ghost btn-sm"
                    style={{ border: '1px solid var(--primary)', color: 'var(--primary)', fontWeight: 600 }}
                    onClick={() => {
                      if (!socketRef.current || !selectedTicket) return
                      socketRef.current.emit('send_message', {
                        ticketId: selectedTicket.id,
                        content: 'Lead Architect, perform a full architectural diagnosis on this channel now.'
                      })
                    }}
                  >
                    🔍 Run Live Diagnosis
                  </button>
                )}
                {['RESOLVED', 'CLOSED'].includes(selectedTicket.status) && (
                  <button 
                    className="btn btn-ghost btn-sm" 
                    style={{ color: 'var(--error)', border: '1px solid var(--error)' }}
                    onClick={handleDeleteTicket}
                  >
                    🗑️ Delete Chat
                  </button>
                )}
                {user?.role === 'SUPER_ADMIN' && (
                   <select 
                    className="input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', width: 'auto' }}
                    value={selectedTicket.status}
                    onChange={async (e) => {
                      const newStatus = e.target.value
                      if (!token) return
                      
                      // Optimistic Update
                      const oldStatus = selectedTicket.status
                      setSelectedTicket({ ...selectedTicket, status: newStatus })
                      setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: newStatus } : t))
                      
                      try {
                        await api.patch(`/support/tickets/${selectedTicket.id}/status`, { status: newStatus }, token)
                        // fetchTicketDetails(selectedTicket.id) // Not needed due to optimistic update
                        // fetchTickets() // Not needed due to optimistic update
                      } catch (err) {
                        alert('Failed to update status')
                        // Rollback
                        setSelectedTicket({ ...selectedTicket, status: oldStatus })
                        setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: oldStatus } : t))
                      }
                    }}
                   >
                     <option value="OPEN">Open</option>
                     <option value="IN_PROGRESS">In Progress</option>
                     <option value="RESOLVED">Resolved</option>
                     <option value="CLOSED">Closed</option>
                   </select>
                )}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {selectedTicket.messages?.map((m) => (
                <div 
                  key={m.id} 
                  style={{ 
                    display: 'flex', 
                    justifyContent: m.sender === 'USER' ? 'flex-end' : 'flex-start' 
                  }}
                >
                  <div style={{ 
                    maxWidth: '75%', 
                    padding: '14px 18px', 
                    borderRadius: 16,
                    backgroundColor: m.sender === 'USER' ? 'var(--primary)' : m.sender === 'SYSTEM' ? '#fff4f4' : 'var(--bg-secondary)',
                    color: m.sender === 'USER' ? 'white' : 'var(--text-primary)',
                    border: m.sender === 'USER' ? 'none' : m.sender === 'SYSTEM' ? '1px solid #ffcfcf' : '1px solid var(--border)',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                    position: 'relative'
                  }}>
                    <div style={{ 
                      fontSize: '0.75rem', 
                      marginBottom: 6, 
                      opacity: 0.8, 
                      fontWeight: 700, 
                      color: m.sender === 'AI' ? 'var(--primary)' : 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      {m.sender === 'AI' ? '◆ LUX CORE' : m.sender === 'SYSTEM' ? '⚠️ SYSTEM' : m.sender === 'HUMAN_AGENT' ? 'Staff' : 'You'}
                      {m.sender === 'AI' && <span style={{ fontSize: '0.6rem', fontWeight: 400, opacity: 0.6 }}> (Lead Systems Architect)</span>}
                    </div>
                    <div style={{ fontSize: '0.95rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {m.content.includes('```chart') ? (
                        <>
                          {m.content.split('```chart')[0]}
                          <ChartRenderer json={m.content.split('```chart')[1].split('```')[0]} />
                          {m.content.split('```chart')[1].split('```').slice(1).join('```')}
                        </>
                      ) : (
                        m.content
                      )}
                    </div>
                    <div style={{ 
                      fontSize: '0.65rem', 
                      marginTop: 8, 
                      textAlign: 'right',
                      opacity: 0.6
                    }}>
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>

            {selectedTicket.status !== 'CLOSED' ? (
              <form onSubmit={handleSendMessage} style={{ padding: 20, borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    type="text"
                    className="input"
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    placeholder="Type your message..."
                    disabled={false}
                    style={{ flex: 1 }}
                  />
                  <button 
                    type="submit" 
                    className="btn btn-primary"
                    disabled={!newMsg.trim()}
                  >
                    Send
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ padding: '15px 20px', backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                🔒 This ticket is <strong>Closed</strong>. No further messages can be sent.
              </div>
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: '4rem', marginBottom: 20 }}>🎧</div>
            <h2 style={{ fontSize: '1.8rem', marginBottom: 10 }}>Support Center</h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 400, marginBottom: 30 }}>
              {user?.role === 'SUPER_ADMIN'
                ? 'Welcome to the Developer Command Center. Resolve issues directly for Shop Owners.'
                : user?.role === 'MANAGER_ADMIN'
                  ? 'Welcome to the Shop Management Support. Resolve staff issues or contact the developer for technical help.'
                  : 'Welcome to the Premium Support Center. Communicate directly with your shop management team.'
              }
            </p>
            {user?.role !== 'SUPER_ADMIN' && (
              <button 
                className="btn btn-primary"
                onClick={() => setShowNewTicket(true)}
              >
                Raise a New Ticket
              </button>
            )}
          </div>
        )}

        {/* New Ticket Modal */}
        {showNewTicket && (
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 100,
            backdropFilter: 'blur(4px)'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: 500, padding: 30 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0 }}>Raise New Support Ticket</h3>
                <button onClick={() => setShowNewTicket(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
              </div>
              <form onSubmit={handleCreateTicket}>
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    required
                    className="input"
                    value={newTicketData.subject}
                    onChange={(e) => setNewTicketData({ ...newTicketData, subject: e.target.value })}
                    placeholder="Brief description of the issue"
                  />
                </div>
                <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Category</label>
                    <select
                      className="input"
                      value={newTicketData.category}
                      onChange={(e) => setNewTicketData({ ...newTicketData, category: e.target.value })}
                    >
                      <option value="GENERAL">General Inquiry</option>
                      <option value="TECHNICAL">Technical Issue</option>
                      <option value="BILLING">Billing/Accounts</option>
                      <option value="BUG_REPORT">Bug Report</option>
                      <option value="FEATURE_REQUEST">Feature Request</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Priority</label>
                    <select
                      className="input"
                      value={newTicketData.priority}
                      onChange={(e) => setNewTicketData({ ...newTicketData, priority: e.target.value })}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent ⚡</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Detailed Content</label>
                  <textarea
                    required
                    className="input"
                    rows={4}
                    value={newTicketData.content}
                    onChange={(e) => setNewTicketData({ ...newTicketData, content: e.target.value })}
                    placeholder="Provide as much detail as possible..."
                    style={{ resize: 'vertical', minHeight: 100 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 15, marginTop: 10 }}>
                  <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setShowNewTicket(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    Submit Ticket
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
