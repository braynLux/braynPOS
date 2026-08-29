'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { FiPlus, FiCopy, FiCheck, FiTrash2, FiBriefcase, FiUsers, FiLayers, FiShield, FiKey, FiExternalLink, FiZap, FiPause, FiPlay } from 'react-icons/fi'

interface EnterpriseItem {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  plan: string
  isActive: boolean
  createdAt: string
  _count?: {
    channels: number
    users: number
    items: number
  }
}

interface InviteItem {
  id: string
  code: string
  businessName: string | null
  plan: string
  createdBy: string
  isUsed: boolean
  usedAt: string | null
  expiresAt: string
  createdAt: string
  enterprise?: {
    id: string
    name: string
    slug: string
  } | null
}

export default function PlatformEnterprisesPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace)

  const [tab, setTab] = useState<'enterprises' | 'invites'>('enterprises')
  const [enterprises, setEnterprises] = useState<EnterpriseItem[]>([])
  const [invites, setInvites] = useState<InviteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [switchingId,   setSwitchingId]   = useState<string | null>(null)
  const [suspendingId,  setSuspendingId]  = useState<string | null>(null)
  const [planChangingId, setPlanChangingId] = useState<string | null>(null)

  const handleSwitchWorkspace = async (enterpriseId: string) => {
    if (!token) return
    setSwitchingId(enterpriseId)
    try {
      const res = await api.post<{
        enterprise: { id: string; name: string; slug: string; plan?: string }
        channel: { id: string; name: string; code: string; type?: string; isMainWarehouse?: boolean }
        accessToken: string
        refreshToken: string
      }>(`/enterprises/${enterpriseId}/switch`, {}, token)

      switchWorkspace(res.enterprise, res.channel, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      })

      toast.success(`Entered ${res.enterprise.name} workspace!`, { icon: '🏢' })
      router.push('/dashboard')
    } catch (err: any) {
      toast.error(err.message || 'Failed to enter enterprise workspace')
    } finally {
      setSwitchingId(null)
    }
  }

  const handleToggleSuspend = async (e: EnterpriseItem) => {
    if (!token) return
    if (!confirm(e.isActive
      ? `Suspend "${e.name}"? All users will be locked out immediately.`
      : `Reactivate "${e.name}"? All users will regain access.`)) return
    setSuspendingId(e.id)
    try {
      const endpoint = e.isActive ? `/enterprises/${e.id}/suspend` : `/enterprises/${e.id}/reactivate`
      const res = await api.post<{ message: string }>(endpoint, {}, token)
      toast.success(res.message)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Action failed')
    } finally {
      setSuspendingId(null)
    }
  }

  const handlePlanChange = async (enterpriseId: string, plan: string) => {
    if (!token) return
    setPlanChangingId(enterpriseId)
    try {
      const res = await api.patch<{ message: string }>(`/enterprises/${enterpriseId}/plan`, { plan }, token)
      toast.success(res.message)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Plan change failed')
    } finally {
      setPlanChangingId(null)
    }
  }

  // Invite Generator Modal
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    businessName: '',
    plan: 'STARTER' as 'STARTER' | 'PRO' | 'ENTERPRISE',
    expiresInDays: 7,
  })
  const [generating, setGenerating] = useState(false)
  const [generatedInvite, setGeneratedInvite] = useState<{ code: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchData = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [ents, invs] = await Promise.all([
        api.get<EnterpriseItem[]>('/enterprises', token),
        api.get<InviteItem[]>('/enterprises/invites', token),
      ])
      setEnterprises(ents || [])
      setInvites(invs || [])
    } catch (err: any) {
      toast.error(err.message || 'Failed to fetch enterprise data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [token])

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setGenerating(true)
    try {
      const invite = await api.post<InviteItem>('/enterprises/invites', inviteForm, token)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const url = `${baseUrl}/onboard?code=${invite.code}`
      setGeneratedInvite({ code: invite.code, url })
      toast.success(`Invite code ${invite.code} generated!`)
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate invite')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Onboarding link copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevokeInvite = async (id: string) => {
    if (!token || !confirm('Are you sure you want to revoke this invite code?')) return
    try {
      await api.delete(`/enterprises/invites/${id}`, token)
      toast.success('Invite code revoked.')
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke invite')
    }
  }

  const totalChannels = enterprises.reduce((sum, e) => sum + (e._count?.channels || 0), 0)
  const totalUsers = enterprises.reduce((sum, e) => sum + (e._count?.users || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
            🏢 Enterprise Fleet Master
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
            Platform Owner control center: manage all isolated enterprise tenants and generate onboarding invite links.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => {
            setGeneratedInvite(null)
            setInviteForm({ businessName: '', plan: 'STARTER', expiresInDays: 7 })
            setShowInviteModal(true)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <FiKey /> Generate One-Time Onboard Link
        </button>
      </div>

      {/* Metrics Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Total Enterprises
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, color: 'var(--primary)' }}>
            {enterprises.length}
          </div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Channels / Stores
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, color: 'var(--success)' }}>
            {totalChannels}
          </div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Total Staff Across Fleet
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, color: 'var(--accent)' }}>
            {totalUsers}
          </div>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Unused Invites
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, color: '#f59e0b' }}>
            {invites.filter(i => !i.isUsed && new Date(i.expiresAt) > new Date()).length}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        <button
          className={`btn btn-sm ${tab === 'enterprises' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('enterprises')}
        >
          🏢 Enterprises ({enterprises.length})
        </button>
        <button
          className={`btn btn-sm ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('invites')}
        >
          🔑 One-Time Invites ({invites.length})
        </button>
      </div>

      {/* Tab 1: Enterprises Fleet Table */}
      {tab === 'enterprises' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px' }}>Enterprise</th>
                  <th style={{ padding: '12px 16px' }}>Workspace Slug</th>
                  <th style={{ padding: '12px 16px' }}>Plan</th>
                  <th style={{ padding: '12px 16px' }}>Channels</th>
                  <th style={{ padding: '12px 16px' }}>Staff</th>
                  <th style={{ padding: '12px 16px' }}>Created</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enterprises.map((e) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 700 }}>{e.name}</div>
                      {e.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{e.email}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8rem' }}>
                        {e.slug}
                      </code>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className="badge badge-primary">{e.plan}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>{e._count?.channels || 0}</td>
                    <td style={{ padding: '12px 16px' }}>{e._count?.users || 0}</td>
                    <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {e.isActive ? (
                        <span className="badge badge-success">● Active</span>
                      ) : (
                        <span className="badge badge-danger">● Suspended</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {/* Inline Plan Change */}
                        <select
                          disabled={planChangingId === e.id}
                          value={e.plan}
                          onChange={(ev) => handlePlanChange(e.id, ev.target.value)}
                          style={{
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            borderRadius: 6, padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer',
                            color: e.plan === 'ENTERPRISE' ? '#f59e0b' : e.plan === 'PRO' ? 'var(--primary)' : 'var(--text-muted)',
                            fontWeight: 700,
                          }}
                        >
                          <option value="STARTER">STARTER</option>
                          <option value="PRO">PRO</option>
                          <option value="ENTERPRISE">ENTERPRISE</option>
                        </select>
                        {/* Suspend / Reactivate */}
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={suspendingId === e.id}
                          onClick={() => handleToggleSuspend(e)}
                          title={e.isActive ? 'Suspend enterprise' : 'Reactivate enterprise'}
                          style={{ padding: '4px 8px', color: e.isActive ? 'var(--warning)' : 'var(--success)' }}
                        >
                          {suspendingId === e.id ? '...' : e.isActive ? <FiPause /> : <FiPlay />}
                        </button>
                        {/* Enter Workspace */}
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={switchingId === e.id || !e.isActive}
                          onClick={() => handleSwitchWorkspace(e.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700 }}
                        >
                          <FiZap /> {switchingId === e.id ? 'Entering...' : 'Log In →'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {enterprises.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No enterprises registered yet. Generate an invite link to onboard your first client!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: One-Time Invites Table */}
      {tab === 'invites' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px' }}>Invite Code</th>
                  <th style={{ padding: '12px 16px' }}>Pre-set Business</th>
                  <th style={{ padding: '12px 16px' }}>Plan</th>
                  <th style={{ padding: '12px 16px' }}>Created</th>
                  <th style={{ padding: '12px 16px' }}>Expires</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const isExpired = new Date(inv.expiresAt) < new Date()
                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>
                            {inv.code}
                          </code>
                          {!inv.isUsed && !isExpired && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
                                handleCopyLink(`${baseUrl}/onboard?code=${inv.code}`)
                              }}
                              title="Copy URL"
                              style={{ padding: '2px 6px' }}
                            >
                              <FiCopy size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{inv.businessName || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="badge badge-info">{inv.plan}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {inv.isUsed ? (
                          <span className="badge badge-success">
                            ✓ Redeemed ({inv.enterprise?.name || 'Used'})
                          </span>
                        ) : isExpired ? (
                          <span className="badge badge-danger">⚠ Expired</span>
                        ) : (
                          <span className="badge badge-warning">● Ready to Redeem</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {!inv.isUsed && !isExpired && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--danger)', padding: '4px 8px' }}
                            onClick={() => handleRevokeInvite(inv.id)}
                          >
                            <FiTrash2 /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {invites.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No invite codes generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Generate Invite Modal ────────────────────────────────────── */}
      {showInviteModal && (
        <div className="modal-overlay">
          <div className="card modal-content" style={{ maxWidth: 480, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                🔑 Generate One-Time Onboard Link
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowInviteModal(false)}>✕</button>
            </div>

            {!generatedInvite ? (
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label>Business Name (Optional Pre-set)</label>
                  <input
                    className="input"
                    placeholder="e.g. Apex Retailers Ltd"
                    value={inviteForm.businessName}
                    onChange={e => setInviteForm(f => ({ ...f, businessName: e.target.value }))}
                  />
                  <small style={{ color: 'var(--text-muted)' }}>
                    If provided, the business name will be locked or pre-filled for the client.
                  </small>
                </div>

                <div className="form-group">
                  <label>Subscription Plan</label>
                  <select
                    className="select"
                    value={inviteForm.plan}
                    onChange={e => setInviteForm(f => ({ ...f, plan: e.target.value as any }))}
                  >
                    <option value="STARTER">Starter Tier</option>
                    <option value="PRO">Professional Tier</option>
                    <option value="ENTERPRISE">Enterprise Tier</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Invite Link Expiration</label>
                  <select
                    className="select"
                    value={inviteForm.expiresInDays}
                    onChange={e => setInviteForm(f => ({ ...f, expiresInDays: Number(e.target.value) }))}
                  >
                    <option value={1}>24 Hours (1 day)</option>
                    <option value={3}>3 Days</option>
                    <option value={7}>7 Days (Standard)</option>
                    <option value={30}>30 Days</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowInviteModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={generating}>
                    {generating ? 'Generating...' : '✨ Generate Invite Link'}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>ONE-TIME CODE</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--success)' }}>
                    {generatedInvite.code}
                  </div>
                </div>

                <div style={{ textAlign: 'left' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Shareable Onboarding URL:
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input"
                      readOnly
                      value={generatedInvite.url}
                      style={{ fontSize: '0.85rem', background: 'var(--bg-elevated)' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => handleCopyLink(generatedInvite.url)}
                      style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {copied ? <FiCheck /> : <FiCopy />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Send this one-time link to your client. Once they complete registration, this link is immediately consumed and cannot be reused.
                </p>

                <button
                  className="btn btn-ghost"
                  onClick={() => setShowInviteModal(false)}
                  style={{ marginTop: 8 }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
