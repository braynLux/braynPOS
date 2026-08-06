'use client'
import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'

interface SalaryRun {
  id: string; month: number; year: number; status: string; totalGross: unknown; totalNet: unknown;
  totalDeductions: unknown; totalEmployerCost: unknown; payslipsCount: number; createdAt: string; finalizedAt?: string
  channel?: { name: string }
}
interface Payslip {
  id: string; 
  staffProfile?: { 
    jobTitle: string; hireDate: string;
    user?: { username: string; channel?: { name: string } } 
  }; 
  grossSalary: unknown; netSalary: unknown;
  allowancesTotal: unknown; deductionsTotal: unknown; status: string;
  breakdown?: {
    grossSalary: number; allowancesTotal: number; deductionsTotal: number;
    netSalary: number; employerCostTotal: number;
    commission?: {
      amount: number; totalMargin: number; avgRate: number; saleCount: number; note: string;
    }
  }
}
interface Channel { id: string; name: string }

const MONTHS = ['','January','February','March','April','May','June','July','August','September','October','November','December']
const STATUS_COLORS: Record<string, string> = { DRAFT: 'badge-warning', FINALIZED: 'badge-success', CANCELLED: 'badge-danger' }

export default function PayrollPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [runs, setRuns] = useState<SalaryRun[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewRun, setShowNewRun] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedRun, setSelectedRun] = useState<SalaryRun | null>(null)
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loadingPayslips, setLoadingPayslips] = useState(false)
  const now = new Date()
  const [runForm, setRunForm] = useState({ month: now.getMonth() + 1, year: now.getFullYear(), channelId: '' })
  const [editingPs, setEditingPs] = useState<{ id: string; name: string; deductions: number; reason: string } | null>(null)
  const [authModal, setAuthModal] = useState<{ id: string; type: 'DELETE' | 'REVERSE' } | null>(null)
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const fetchRuns = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [rRes, cRes] = await Promise.all([
        api.get<{ data: SalaryRun[] }>('/payroll/salary-runs', token),
        api.get<Channel[]>('/channels', token),
      ])
      setRuns(rRes.data ?? [])
      const channelList = Array.isArray(cRes) ? cRes : [cRes as unknown as Channel]
      setChannels(channelList)
      setRunForm(prev => ({
        ...prev,
        channelId: prev.channelId || user?.channelId || channelList[0]?.id || '',
      }))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const fetchPayslips = async (runId: string) => {
    if (!token) return
    setLoadingPayslips(true)
    try {
      const res = await api.get<{ payslips: Payslip[] }>(`/payroll/salary-runs/${runId}`, token)
      setPayslips(res.payslips ?? [])
    } catch (e) { console.error(e) }
    finally { setLoadingPayslips(false) }
  }

  const getExportData = async () => {
    if (selectedRun) {
      return payslips.map(ps => [
        ps.staffProfile?.user?.username || 'Unknown',
        ps.staffProfile?.jobTitle || 'Staff',
        ps.staffProfile?.user?.channel?.name || 'HQ',
        Number(ps.grossSalary) + Number(ps.allowancesTotal) + Number(ps.breakdown?.commission?.amount ?? 0),
        ps.deductionsTotal,
        ps.netSalary,
        ps.breakdown?.commission?.amount || 0,
        ps.status || 'DRAFT'
      ])
    } else {
      return runs.map(r => [
        `${MONTHS[r.month]} ${r.year}`,
        r.channel?.name || 'All',
        r.totalGross,
        r.totalNet,
        r.totalDeductions,
        r.status,
        r.payslipsCount,
        r.finalizedAt ? new Date(r.finalizedAt).toLocaleString() : '—'
      ])
    }
  }

  useEffect(() => { 
    if (token) {
      fetchRuns() 
      api.post('/payroll/salary-runs/cleanup', {}, token).catch(console.error)
    }
  }, [token])

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!runForm.channelId) return toast.error('Select a channel for this salary run')
    setSaving(true)
    try {
      const payload = { month: runForm.month, year: runForm.year, channelId: runForm.channelId }
      const res: any = await api.post('/payroll/salary-runs', payload, token!)
      setShowNewRun(false)
      setRunForm({ month: now.getMonth() + 1, year: now.getFullYear(), channelId: user?.channelId || channels[0]?.id || '' })
      
      if (res && res.warnings && res.warnings.length > 0) {
        toast.error(`Run created, but ${res.warnings.length} staff were skipped due to zero/invalid salaries. Check console for details.`, { duration: 6000 })
        console.warn('Salary Run skipped staff:', res.warnings)
      } else {
        toast.success('Salary run created successfully!')
      }
      
      fetchRuns()
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
    finally { setSaving(false) }
  }

  const handleFinalize = async (id: string) => {
    if (!confirm('Finalize this salary run? This will lock all payslips and mark them as paid.')) return
    try {
      await api.post(`/payroll/salary-runs/${id}/finalize`, {}, token!)
      await fetchRuns()
      if (selectedRun?.id === id) {
        setSelectedRun(prev => prev ? { ...prev, status: 'FINALIZED' } : null)
      }
      toast.success('Salary run finalized!')
    } catch (err) { toast.error('Failed to finalize: ' + (err as Error).message) }
  }

  const handleUpdateDeductions = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingPs) return
    setSaving(true)
    try {
      await api.patch(`/payroll/salary-runs/line/${editingPs.id}`, {
        deductionsTotal: editingPs.deductions,
        reason: editingPs.reason.trim(),
      }, token!)
      toast.success('Deductions updated!')
      setEditingPs(null)
      if (selectedRun) fetchPayslips(selectedRun.id)
      fetchRuns()
    } catch (err) { toast.error('Failed to update: ' + (err as Error).message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    setAuthModal({ id, type: 'DELETE' })
  }

  const handleReverse = async (id: string) => {
    setAuthModal({ id, type: 'REVERSE' })
  }

  const confirmAuth = async () => {
    if (!password) return toast.error('Password is required')
    setAuthLoading(true)
    try {
      if (authModal?.type === 'DELETE') {
        await api.delete(`/payroll/salary-runs/${authModal.id}`, token!, { password })
        toast.success('Salary run deleted')
        if (selectedRun?.id === authModal.id) setSelectedRun(null)
      } else if (authModal?.type === 'REVERSE') {
        await api.post(`/payroll/salary-runs/${authModal.id}/reverse`, { password }, token!)
        toast.success('Salary run reversed to draft!')
      }
      setPassword('')
      setAuthModal(null)
      fetchRuns()
    } catch (err) { toast.error('Security Failure: ' + (err as Error).message) }
    finally { setAuthLoading(false) }
  }

  const openRun = async (run: SalaryRun) => {
    setSelectedRun(run)
    fetchPayslips(run.id)
  }

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))
  const totalGross = runs.reduce((s, r) => s + Number(r.totalGross ?? 0), 0)

  return (
    <div className="animate-fade-in" style={{ padding: '0 0 40px' }}>
      <div className="page-header" style={{ marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>💰 Payroll Management</h1>
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px 12px', borderRadius: 8, marginTop: 8 }}>
            <p style={{ color: '#ef4444', fontSize: '0.78rem', fontWeight: '600', margin: 0 }}>
              ⚠️ POLICY: Drafts auto-purge in 72h. Finalized runs reversible within 72h.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ExportMenu 
             title={selectedRun ? `Payroll_${MONTHS[selectedRun.month]}_${selectedRun.year}` : 'Salary_Runs_History'}
             headers={
                selectedRun 
                  ? ['Employee', 'Position', 'Channel', 'Gross Payment', 'Deductions', 'Net Salary', 'Included Commission', 'Status']
                  : ['Period', 'Channel', 'Gross', 'Net', 'Deductions', 'Status', 'Payslips', 'Finalized On']
             }
             getData={getExportData}
          />
          <button className="btn btn-primary" onClick={() => setShowNewRun(true)}>+ New Salary Run</button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-value">{runs.length}</div>
          <div className="stat-label">Salary Runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{runs.filter(r => r.status === 'DRAFT').length}</div>
          <div className="stat-label">Pending Finalization</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{runs.filter(r => r.status === 'FINALIZED').length}</div>
          <div className="stat-label">Finalized Runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(totalGross).split('.')[0]}</div>
          <div className="stat-label">Total Gross Paid</div>
        </div>
      </div>

      <div className="payroll-container" style={{ display: 'grid', gridTemplateColumns: selectedRun ? '1fr 1.6fr' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* Runs List */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '1rem' }}>📋 Salary Runs</strong>
          </div>
          <div className="table-container">
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>
            ) : runs.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No salary runs found.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Period</th><th>Channel</th><th>Gross</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} style={{ cursor: 'pointer', background: selectedRun?.id === run.id ? 'var(--bg-elevated)' : undefined }} onClick={() => openRun(run)}>
                      <td data-label="Period">
                        <strong>{MONTHS[run.month]} {run.year}</strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{run.payslipsCount} payslips</div>
                      </td>
                      <td data-label="Channel">{run.channel?.name || 'All'}</td>
                      <td data-label="Gross" style={{ fontWeight: 600 }}>{fmt(run.totalGross)}</td>
                      <td data-label="Status"><span className={`badge ${STATUS_COLORS[run.status] || 'badge-info'}`}>{run.status}</span></td>
                      <td data-label="Actions" style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          {run.status === 'DRAFT' && (
                            <>
                              <button className="btn btn-success btn-sm" onClick={() => handleFinalize(run.id)}>Finalize</button>
                              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(run.id)}>🗑️</button>
                            </>
                          )}
                          {run.status === 'FINALIZED' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleReverse(run.id)}>🔄 Reverse</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Payslips Detail */}
        {selectedRun && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <h3 style={{ margin: 0 }}>{MONTHS[selectedRun.month]} {selectedRun.year} Run</h3>
                <span className={`badge ${STATUS_COLORS[selectedRun.status] || 'badge-info'}`}>{selectedRun.status}</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                   <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Total Gross</div>
                   <div style={{ fontWeight: 700, color: 'var(--success)' }}>{fmt(payslips.reduce((s, p) => s + Number(p.grossSalary) + Number(p.allowancesTotal) + Number(p.breakdown?.commission?.amount ?? 0), 0))}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                   <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Total Deduct</div>
                   <div style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmt(payslips.reduce((s, p) => s + Number(p.deductionsTotal), 0))}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                   <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Net Payable</div>
                   <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(payslips.reduce((s, p) => s + Number(p.netSalary), 0))}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                   <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Employer Cost</div>
                   <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmt(selectedRun.totalEmployerCost)}</div>
                </div>
              </div>
            </div>

            <div className="table-container">
              {loadingPayslips ? (
                <div style={{ padding: 40, textAlign: 'center' }}>Loading payslips...</div>
              ) : payslips.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No payslips found.</div>
              ) : (
                <table className="table">
                  <thead><tr><th>Employee</th><th>Position</th><th>Channel</th><th style={{ textAlign: 'right' }}>Gross</th><th style={{ textAlign: 'right' }}>Deductions</th><th style={{ textAlign: 'right' }}>Net</th><th>Status</th></tr></thead>
                  <tbody>
                    {payslips.map(ps => (
                      <tr key={ps.id}>
                        <td data-label="Employee">
                          <strong>{ps.staffProfile?.user?.username || 'Unknown'}</strong>
                        </td>
                        <td data-label="Position"><span className="badge badge-primary">{ps.staffProfile?.jobTitle || 'Staff'}</span></td>
                        <td data-label="Channel">{ps.staffProfile?.user?.channel?.name || 'HQ'}</td>
                        <td data-label="Gross" style={{ textAlign: 'right' }}>{fmt(Number(ps.grossSalary) + Number(ps.allowancesTotal) + Number(ps.breakdown?.commission?.amount ?? 0))}</td>
                        <td data-label="Deductions" style={{ textAlign: 'right', color: 'var(--danger)' }}>
                          {selectedRun.status === 'DRAFT' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingPs({ id: ps.id, name: ps.staffProfile?.user?.username || '', deductions: Number(ps.deductionsTotal), reason: '' })}>
                              {fmt(ps.deductionsTotal)} ✏️
                            </button>
                          ) : (
                            fmt(ps.deductionsTotal)
                          )}
                        </td>
                        <td data-label="Net" style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700 }}>{fmt(ps.netSalary)}</div>
                          {ps.breakdown?.commission && ps.breakdown.commission.amount > 0 && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--success)' }}>
                               📈 Comm ({fmt(ps.breakdown.commission.amount)})
                            </div>
                          )}
                        </td>
                        <td data-label="Status"><span className={`badge ${ps.status === 'PAID' ? 'badge-success' : 'badge-warning'}`}>{ps.status || 'DRAFT'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selectedRun.finalizedAt && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
                Finalized by Admin on {new Date(selectedRun.finalizedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Run Modal */}
      {showNewRun && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 450, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px' }}>📅 New Salary Run</h3>
            <form onSubmit={handleCreateRun} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Month *</label>
                  <select className="input" value={runForm.month} onChange={e => setRunForm({ ...runForm, month: Number(e.target.value) })} required>
                    {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Year *</label>
                  <select className="input" value={runForm.year} onChange={e => setRunForm({ ...runForm, year: Number(e.target.value) })} required>
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Channel *</label>
                <select className="input" value={runForm.channelId} onChange={e => setRunForm({ ...runForm, channelId: e.target.value })}>
                  <option value="">Select channel</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ backgroundColor: 'var(--bg-secondary)', padding: 12, borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                ℹ️ Active staff profiles and performance-based commissions for the selected channel will be factored into this run.
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowNewRun(false)}>Back</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={saving}>{saving ? 'Processing...' : 'Generate New Run'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {authModal && (
        <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.92)' }}>
          <div className="modal-content card" style={{ maxWidth: 440, width: '90%', padding: 28, border: '2px solid rgba(255,255,255,0.05)' }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>{authModal.type === 'DELETE' ? '🗑️' : '🔄'}</div>
                <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{authModal.type === 'DELETE' ? 'Delete Payroll' : 'Reverse Payroll'}</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 8 }}>
                   {authModal.type === 'DELETE' 
                    ? 'Security alert: This action will destroy this payroll draft permanently and cannot be undone.' 
                    : 'Security alert: You are reversing an official payroll record. This action is logged for compliance.'}
                </p>
              </div>
              <div className="form-group">
                <label style={{ fontSize: '0.7rem', fontWeight: 800 }}>ADMIN PRIVILEGE PASSWORD</label>
                <input 
                  type="password" 
                  className="input" 
                  autoFocus
                  placeholder="••••••••"
                  style={{ height: 48, fontSize: '1.1rem', textAlign: 'center' }}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmAuth()}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setAuthModal(null); setPassword(''); }} disabled={authLoading}>Cancel</button>
                <button 
                  className="btn btn-primary" 
                  style={{ flex: 2, background: authModal.type === 'DELETE' ? 'var(--danger)' : 'var(--primary)' }} 
                  onClick={confirmAuth} 
                  disabled={authLoading}
                >
                  {authLoading ? 'Verifying...' : 'Authorize Action'}
                </button>
              </div>
          </div>
        </div>
      )}

      {/* Deductions Edit */}
      {editingPs && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 400, padding: 24 }}>
            <h3>✏️ Adjust Deductions</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Staff: <strong>{editingPs.name}</strong></p>
            <form onSubmit={handleUpdateDeductions} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label>Manual Deductions (KES)</label>
                <input 
                  type="number" 
                  className="input" 
                  min="0" 
                  step="0.01" 
                  value={editingPs.deductions} 
                  onChange={e => setEditingPs({ ...editingPs, deductions: Number(e.target.value) })} 
                  required 
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Adjustment Reason *</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editingPs.reason}
                  onChange={e => setEditingPs({ ...editingPs, reason: e.target.value })}
                  placeholder="e.g. Late attendance adjustment approved by HR"
                  minLength={5}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditingPs(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={saving}>Update Line</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
