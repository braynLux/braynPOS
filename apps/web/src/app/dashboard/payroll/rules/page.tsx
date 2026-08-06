'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface DeductionBracket { incomeFrom: number; incomeTo: number | null; ratePercentage: number; fixedDeduction: number }
interface DeductionRule {
  id: string; name: string; type: string; rate: unknown; isPreTaxDeduction: boolean
  isEmployerContribution: boolean; calculationSequence: number
  brackets: DeductionBracket[]
}
interface AllowanceRule { id: string; name: string; type: string; amount: unknown }
interface JobLevel { id: string; name: string; basicSalary: unknown; overtimeRatePerHour: unknown }

const DEDUCTION_TYPES = ['FIXED_AMOUNT', 'PERCENTAGE_OF_GROSS', 'BRACKET_TABLE', 'PERCENTAGE_OF_TAXABLE'] as const

export default function PayrollRulesPage() {
  const token = useAuthStore((s) => s.accessToken)
  const [tab, setTab] = useState<'deductions' | 'allowances' | 'joblevels'>('deductions')

  const [deductions, setDeductions] = useState<DeductionRule[]>([])
  const [allowances, setAllowances] = useState<AllowanceRule[]>([])
  const [jobLevels, setJobLevels] = useState<JobLevel[]>([])
  const [loading, setLoading] = useState(true)

  const [showDeductionForm, setShowDeductionForm] = useState(false)
  const [dedForm, setDedForm] = useState({
    name: '', type: 'FIXED_AMOUNT' as typeof DEDUCTION_TYPES[number], rate: 0,
    isPreTaxDeduction: false, isEmployerContribution: false, calculationSequence: 100,
  })
  const [brackets, setBrackets] = useState<DeductionBracket[]>([{ incomeFrom: 0, incomeTo: null, ratePercentage: 0, fixedDeduction: 0 }])

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n ?? 0))

  const loadAll = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [d, a, j] = await Promise.all([
        api.get<DeductionRule[]>('/payroll/rules/deductions', token),
        api.get<AllowanceRule[]>('/payroll/rules/allowances', token),
        api.get<JobLevel[]>('/payroll/rules/job-levels', token),
      ])
      setDeductions(d); setAllowances(a); setJobLevels(j)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [token])

  const createDeduction = async () => {
    try {
      await api.post('/payroll/rules/deductions', {
        ...dedForm,
        rate: dedForm.type === 'BRACKET_TABLE' ? undefined : dedForm.rate,
        brackets: dedForm.type === 'BRACKET_TABLE' ? brackets : undefined,
      }, token!)
      toast.success('Deduction rule created')
      setShowDeductionForm(false)
      setDedForm({ name: '', type: 'FIXED_AMOUNT', rate: 0, isPreTaxDeduction: false, isEmployerContribution: false, calculationSequence: 100 })
      setBrackets([{ incomeFrom: 0, incomeTo: null, ratePercentage: 0, fixedDeduction: 0 }])
      loadAll()
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
  }

  const removeDeduction = async (id: string) => {
    if (!confirm('Deactivate this deduction rule?')) return
    await api.delete(`/payroll/rules/deductions/${id}`, token!).catch(e => toast.error((e as Error).message))
    loadAll()
  }

  const addAllowance = async () => {
    const name = prompt('Allowance name?')
    if (!name) return
    const amount = Number(prompt('Amount (KES)?'))
    if (isNaN(amount) || amount < 0) return
    try {
      await api.post('/payroll/rules/allowances', { name, type: 'FIXED_AMOUNT', amount }, token!)
      toast.success('Allowance rule created')
      loadAll()
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
  }

  const removeAllowance = async (id: string) => {
    if (!confirm('Deactivate this allowance rule?')) return
    await api.delete(`/payroll/rules/allowances/${id}`, token!).catch(e => toast.error((e as Error).message))
    loadAll()
  }

  const addJobLevel = async () => {
    const name = prompt('Job level name (e.g. Sales Supervisor)?')
    if (!name) return
    const basicSalary = Number(prompt('Basic salary (KES)?'))
    if (isNaN(basicSalary) || basicSalary < 0) return
    const overtimeRatePerHour = Number(prompt('Overtime rate per hour (KES, optional — 0 if none)?') || 0)
    try {
      await api.post('/payroll/rules/job-levels', { name, basicSalary, overtimeRatePerHour }, token!)
      toast.success('Job level created')
      loadAll()
    } catch (err) { toast.error('Failed: ' + (err as Error).message) }
  }

  const removeJobLevel = async (id: string) => {
    if (!confirm('Deactivate this job level?')) return
    await api.delete(`/payroll/rules/job-levels/${id}`, token!).catch(e => toast.error((e as Error).message))
    loadAll()
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1>Payroll Rules</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Deductions, allowances, and job levels used across payroll calculations</p>
        </div>
        <Link href="/dashboard/payroll" className="btn btn-ghost">← Back to Payroll</Link>
      </div>

      <div className="tab-group" style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
        {(['deductions', 'allowances', 'joblevels'] as const).map(t => (
          <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}>
            {t === 'deductions' ? 'Deduction Rules' : t === 'allowances' ? 'Allowances' : 'Job Levels'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>Loading...</div>
      ) : tab === 'deductions' ? (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Deduction Rules</strong>
            <button className="btn btn-primary btn-sm" onClick={() => setShowDeductionForm(s => !s)}>
              {showDeductionForm ? 'Cancel' : '+ Add Deduction Rule'}
            </button>
          </div>

          {showDeductionForm && (
            <div style={{ padding: 20, borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div className="form-group">
                  <label>Name</label>
                  <input className="input" value={dedForm.name} onChange={e => setDedForm({ ...dedForm, name: e.target.value })} placeholder="e.g. PAYE, NSSF, SHIF" />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select className="input" value={dedForm.type} onChange={e => setDedForm({ ...dedForm, type: e.target.value as any })}>
                    {DEDUCTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>

              {dedForm.type !== 'BRACKET_TABLE' ? (
                <div className="form-group" style={{ maxWidth: 240, marginBottom: 14 }}>
                  <label>{dedForm.type === 'FIXED_AMOUNT' ? 'Amount (KES)' : 'Rate (%)'}</label>
                  <input type="number" min={0} step={0.01} className="input" value={dedForm.rate} onChange={e => setDedForm({ ...dedForm, rate: Number(e.target.value) })} />
                </div>
              ) : (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', marginBottom: 8 }}>Brackets</label>
                  {brackets.map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input type="number" className="input" placeholder="From" value={b.incomeFrom}
                        onChange={e => setBrackets(prev => prev.map((br, idx) => idx === i ? { ...br, incomeFrom: Number(e.target.value) } : br))} />
                      <input type="number" className="input" placeholder="To (blank = no cap)" value={b.incomeTo ?? ''}
                        onChange={e => setBrackets(prev => prev.map((br, idx) => idx === i ? { ...br, incomeTo: e.target.value ? Number(e.target.value) : null } : br))} />
                      <input type="number" className="input" placeholder="Rate %" value={b.ratePercentage}
                        onChange={e => setBrackets(prev => prev.map((br, idx) => idx === i ? { ...br, ratePercentage: Number(e.target.value) } : br))} />
                      <input type="number" className="input" placeholder="Fixed" value={b.fixedDeduction}
                        onChange={e => setBrackets(prev => prev.map((br, idx) => idx === i ? { ...br, fixedDeduction: Number(e.target.value) } : br))} />
                      <button className="btn-link" onClick={() => setBrackets(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => setBrackets(prev => [...prev, { incomeFrom: 0, incomeTo: null, ratePercentage: 0, fixedDeduction: 0 }])}>+ Add Bracket</button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={dedForm.isPreTaxDeduction} onChange={e => setDedForm({ ...dedForm, isPreTaxDeduction: e.target.checked })} />
                  Pre-tax deduction
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={dedForm.isEmployerContribution} onChange={e => setDedForm({ ...dedForm, isEmployerContribution: e.target.checked })} />
                  Employer contribution
                </label>
              </div>

              <button className="btn btn-primary" disabled={!dedForm.name} onClick={createDeduction}>Create Rule</button>
            </div>
          )}

          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Rate/Amount</th><th>Pre-tax</th><th>Sequence</th><th></th></tr></thead>
            <tbody>
              {deductions.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No deduction rules configured yet.</td></tr>
              ) : deductions.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.type.replace(/_/g, ' ')}</td>
                  <td>{d.type === 'BRACKET_TABLE' ? `${d.brackets.length} brackets` : (d.type === 'FIXED_AMOUNT' ? fmt(d.rate) : `${Number(d.rate)}%`)}</td>
                  <td>{d.isPreTaxDeduction ? '✓' : '—'}</td>
                  <td>{d.calculationSequence}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn-link" onClick={() => removeDeduction(d.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'allowances' ? (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Allowances</strong>
            <button className="btn btn-primary btn-sm" onClick={addAllowance}>+ Add Allowance</button>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>
              {allowances.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No allowances configured yet.</td></tr>
              ) : allowances.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong></td>
                  <td>{a.type.replace(/_/g, ' ')}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.amount)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn-link" onClick={() => removeAllowance(a.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Job Levels</strong>
            <button className="btn btn-primary btn-sm" onClick={addJobLevel}>+ Add Job Level</button>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th style={{ textAlign: 'right' }}>Basic Salary</th><th style={{ textAlign: 'right' }}>Overtime Rate/Hr</th><th></th></tr></thead>
            <tbody>
              {jobLevels.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No job levels configured yet.</td></tr>
              ) : jobLevels.map(j => (
                <tr key={j.id}>
                  <td><strong>{j.name}</strong></td>
                  <td style={{ textAlign: 'right' }}>{fmt(j.basicSalary)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(j.overtimeRatePerHour)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn-link" onClick={() => removeJobLevel(j.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
