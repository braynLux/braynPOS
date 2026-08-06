'use client'
import React, { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ExportMenu } from '@/components/shared/ExportMenu'
import { toast } from 'react-hot-toast'

export default function AccountingPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<'chart' | 'trial' | 'pnl' | 'balance' | 'assets' | 'deposits'>('chart')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Date Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10))

  const loadTab = async (t: string) => {
    if (!token) return
    setLoading(true)
    setData(null)
    try {
      const params = new URLSearchParams()
      // Automatic Channel Scoping for non-admins
      if (!['SUPER_ADMIN', 'ADMIN'].includes(user?.role || '')) {
        params.set('channelId', user?.channelId || '')
      }

      let res: any
      switch (t) {
        case 'chart':
          res = await api.get('/accounting/accounts', token)
          break
        case 'trial':
          params.set('asOfDate', asOfDate)
          res = await api.get(`/accounting/trial-balance?${params}`, token)
          break
        case 'pnl':
          params.set('startDate', startDate)
          params.set('endDate', endDate)
          res = await api.get(`/accounting/profit-loss?${params}`, token)
          break
        case 'balance':
          params.set('asOfDate', asOfDate)
          res = await api.get(`/accounting/balance-sheet?${params}`, token)
          break
        case 'assets':
          res = await api.get(`/accounting/assets?${params}`, token)
          break
        case 'deposits': {
          const [deposits, banks, cashPosition] = await Promise.all([
            api.get(`/accounting/bank-deposits?${params}`, token),
            api.get(`/accounting/bank-deposits/banks?${params}`, token),
            api.get(`/accounting/bank-deposits/cash-position?${params}`, token),
          ])
          res = { deposits: (deposits as any).data ?? [], banks, cashPosition }
          break
        }
      }
      setData(res)
    } catch (e) { 
      const msg = (e as Error).message
      console.error('[Accounting Load Error]:', e)
      
      if ((e as any).status === 403) {
        toast.error('Access Restricted: HQ clearance required for this financial report.', { id: 'security-block', icon: '🛡️' })
        setData({ error: 'Access Restricted: You do not have permission to view global financial state.' })
      } else {
        toast.error('Failed to load accounting data: ' + msg)
        setData({ error: 'Failed to load financial data.' })
      }
    }
    finally { setLoading(false) }
  }

  const getExportHeaders = () => {
    switch(tab) {
      case 'chart': return ['Code', 'Name', 'Type', 'Level', 'Status']
      case 'trial': return ['Account Code', 'Account Name', 'Debit', 'Credit']
      case 'pnl': return ['Category', 'Account', 'Amount']
      case 'balance': return ['Category', 'Account', 'Amount']
      default: return []
    }
  }

  const getExportData = async () => {
    switch(tab) {
      case 'chart': {
        const flatten = (accs: any[], depth = 0): any[] => {
            return accs.flatMap(a => [
                [a.code, a.name, a.type, depth === 0 ? 'Primary' : depth === 1 ? 'Sub-account' : 'Detail', a.isActive ? 'Active' : 'Inactive'],
                ...flatten(a.children || [], depth + 1)
            ])
        }
        return flatten(data || [])
      }
      case 'trial': {
        if (!data || !data.rows) return []
        return data.rows.map((r: any) => [
          r.accountCode, r.accountName, r.totalDebit || 0, r.totalCredit || 0
        ])
      }
      case 'pnl': {
        if (!data) return []
        const rows: any[] = []
        data.revenue?.forEach((r: any) => rows.push(['Revenue', r.accountName, r.amount]))
        data.expenses?.forEach((e: any) => rows.push(['Expense', e.accountName, e.amount]))
        rows.push(['Total Revenue', '—', data.totalRevenue])
        rows.push(['Total Expenses', '—', data.totalExpenses])
        rows.push(['Net Profit', '—', data.netProfit])
        return rows
      }
      case 'balance': {
         if (!data) return []
         const rows: any[] = []
         data.assets?.forEach((a: any) => rows.push(['Asset', a.accountName, a.balance]))
         data.liabilities?.forEach((l: any) => rows.push(['Liability', l.accountName, l.balance]))
         data.equity?.forEach((e: any) => rows.push(['Equity', e.accountName, e.balance]))
         rows.push(['Total Assets', '—', data.totalAssets])
         rows.push(['Total Liabilities', '—', data.totalLiabilities])
         rows.push(['Total Equity', '—', data.totalEquity])
         return rows
      }
      default: return []
    }
  }

  useEffect(() => { loadTab(tab) }, [tab, token])

  const fmt = (n: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n)

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Accounting</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <ExportMenu 
            title={`Accounting_Report_${tab}`}
            headers={getExportHeaders()}
            getData={getExportData}
          />
          {tab === 'pnl' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <span>to</span>
              <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              <button className="btn btn-secondary" onClick={() => loadTab('pnl')}>Refresh</button>
            </div>
          )}
          {(tab === 'trial' || tab === 'balance') && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>As of:</span>
              <input type="date" className="input" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
              <button className="btn btn-secondary" onClick={() => loadTab(tab)}>Refresh</button>
            </div>
          )}
        </div>
      </div>

      <div className="tab-group" style={{ marginBottom: 24 }}>
        {(['chart', 'trial', 'pnl', 'balance', 'assets', 'deposits'] as const).map(t => (
          <button
            key={t}
            className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t)}
          >
            {t === 'chart' ? 'Chart of Accounts' :
             t === 'trial' ? 'Trial Balance' :
             t === 'pnl' ? 'Profit & Loss' :
             t === 'balance' ? 'Balance Sheet' :
             t === 'assets' ? 'Fixed Assets' :
             'Bank Deposits'}
          </button>
        ))}
      </div>

      {data?.error && (
        <div className="alert alert-danger" style={{ marginBottom: 24 }}>{data.error}</div>
      )}

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div className="animate-pulse">Loading Financial Data...</div>
        </div>
      ) : (
        <div className="animate-scale-in">
          {tab === 'chart' && renderChart(data)}
          {tab === 'trial' && renderTrialBalance(data)}
          {tab === 'pnl' && renderProfitLoss(data)}
          {tab === 'balance' && renderBalanceSheet(data)}
          {tab === 'assets' && renderAssets(data)}
          {tab === 'deposits' && renderDeposits(data)}
        </div>
      )}
    </div>
  )

  function renderChart(accounts: any[]) {
    if (!accounts || !Array.isArray(accounts)) return null

    const renderAccountRow = (acc: any, depth = 0) => (
      <React.Fragment key={acc.id}>
        <tr>
          <td style={{ paddingLeft: depth * 24 }}><code>{acc.code}</code></td>
          <td style={{ paddingLeft: depth * 24 }}>
            {depth === 0 ? <strong>{acc.name}</strong> : acc.name}
          </td>
          <td><span className="badge badge-outline">{acc.type}</span></td>
          <td>{depth === 0 ? 'Primary' : depth === 1 ? 'Sub-account' : 'Detail'}</td>
          <td>
            <span className={`badge ${acc.isActive ? 'badge-success' : 'badge-danger'}`}>
              {acc.isActive ? 'Active' : 'Inactive'}
            </span>
          </td>
        </tr>
        {acc.children?.map((child: any) => renderAccountRow(child, depth + 1))}
      </React.Fragment>
    )

    return (
      <div className="animate-scale-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <input 
            className="input" 
            placeholder="🔍 Search accounts..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            style={{ maxWidth: 400 }}
          />
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => renderAccountRow(acc))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderTrialBalance(tb: any) {
    if (!tb) return null
    return (
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Debit</th>
                <th style={{ textAlign: 'right' }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows?.map((row: any) => (
                <tr key={row.accountId}>
                  <td>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.accountCode}</div>
                    <strong>{row.accountName}</strong>
                  </td>
                  <td style={{ textAlign: 'right', color: row.totalDebit > 0 ? 'var(--success)' : 'inherit' }}>
                    {row.totalDebit > 0 ? fmt(row.totalDebit) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: row.totalCredit > 0 ? 'var(--danger)' : 'inherit' }}>
                    {row.totalCredit > 0 ? fmt(row.totalCredit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot style={{ borderTop: '2px solid var(--border)' }}>
              <tr>
                <td><strong>TOTAL</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(tb.totalDebit)}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(tb.totalCredit)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {tb.variance !== 0 && (
          <div className="alert alert-danger" style={{ marginTop: 20 }}>
            ⚠️ Imbalance Detected: {fmt(tb.variance)}
          </div>
        )}
      </div>
    )
  }

  function renderProfitLoss(pnl: any) {
    if (!pnl) return null
    return (
      <div>
        <div className="grid grid-3" style={{ marginBottom: 24 }}>
          <div className="card stats-card">
            <label>Total Revenue</label>
            <div className="value success">{fmt(pnl?.totalRevenue || 0)}</div>
          </div>
          <div className="card stats-card">
            <label>Total Expenses</label>
            <div className="value danger">{fmt(pnl?.totalExpenses || 0)}</div>
          </div>
          <div className="card stats-card highlight">
            <label>Net Profit/Loss</label>
            <div className={`value ${pnl?.netProfit >= 0 ? 'success' : 'danger'}`}>
              {fmt(pnl?.netProfit || 0)}
            </div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Revenue</h3>
            <div className="table-container">
              <table>
                <tbody>
                  {pnl?.revenue?.map((r: any) => (
                    <tr key={r.accountId}>
                      <td>{r.accountName}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total Revenue</strong></td><td style={{ textAlign: 'right' }}><strong>{fmt(pnl?.totalRevenue || 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Expenses</h3>
            <div className="table-container">
              <table>
                <tbody>
                  {pnl?.expenses?.map((e: any) => (
                    <tr key={e.accountId}>
                      <td>{e.accountName}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total Expenses</strong></td><td style={{ textAlign: 'right' }}><strong>{fmt(pnl?.totalExpenses || 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderBalanceSheet(bs: any) {
    if (!bs) return null
    return (
      <div>
        {!bs.isBalanced && (
          <div className="alert alert-danger" style={{ marginBottom: 24 }}>
            ⚠️ <strong>Critical Account Mismatch</strong>: Assets do not equal Liabilities + Equity (Difference: {fmt(bs.imbalance)})
          </div>
        )}
        <div className="grid grid-3">
          <div className="card">
            <h3 style={{ marginBottom: 16, color: 'var(--success)' }}>Assets</h3>
            <div className="table-container">
              <table>
                <tbody>
                  {bs?.assets?.map((a: any) => (
                    <tr key={a.accountId}><td>{a.accountName}</td><td style={{ textAlign: 'right' }}>{fmt(a.balance)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total Assets</strong></td><td style={{ textAlign: 'right' }}><strong>{fmt(bs?.totalAssets || 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16, color: 'var(--danger)' }}>Liabilities</h3>
            <div className="table-container">
              <table>
                <tbody>
                  {bs?.liabilities?.map((l: any) => (
                    <tr key={l.accountId}><td>{l.accountName}</td><td style={{ textAlign: 'right' }}>{fmt(l.balance)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total Liabilities</strong></td><td style={{ textAlign: 'right' }}><strong>{fmt(bs?.totalLiabilities || 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16, color: 'var(--primary)' }}>Equity</h3>
            <div className="table-container">
              <table>
                <tbody>
                  {bs?.equity?.map((e: any) => (
                    <tr key={e.accountId}><td>{e.accountName}</td><td style={{ textAlign: 'right' }}>{fmt(e.balance)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total Equity</strong></td><td style={{ textAlign: 'right' }}><strong>{fmt(bs?.totalEquity || 0)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderAssets(assets: any[]) {
    if (!assets || !Array.isArray(assets)) return null

    return (
      <div className="animate-scale-in">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
           <h3 style={{ margin: 0 }}>Business Fixed Assets</h3>
           <button className="btn btn-primary btn-sm" onClick={() => {
              const name = prompt('Asset Name?')
              const code = prompt('Asset Code?')
              const price = Number(prompt('Purchase Price?'))
              const rate = Number(prompt('Depreciation Rate (Annual %)?'))
              if (!name || !code || isNaN(price)) return
              
              api.post('/accounting/assets', {
                name, code, 
                category: 'GENERAL',
                purchaseDate: new Date().toISOString(),
                purchasePrice: price,
                depreciationRate: rate,
                channelId: user?.channelId || ''
              }, token!).then(() => loadTab('assets'))
           }}>+ Add Asset</button>
        </div>
        <div className="table-container card">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Asset Name</th>
                <th>Purchase Date</th>
                <th style={{ textAlign: 'right' }}>Purchase Price</th>
                <th style={{ textAlign: 'right' }}>Depreciation Rate</th>
                <th style={{ textAlign: 'right' }}>Current Book Value</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id}>
                  <td><code>{a.code}</code></td>
                  <td><strong>{a.name}</strong></td>
                  <td>{new Date(a.purchaseDate).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(Number(a.purchasePrice))}</td>
                  <td style={{ textAlign: 'right' }}>{Number(a.depreciationRate)}%</td>
                  <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 700 }}>{fmt(a.bookValue)}</td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No fixed assets recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderDeposits(d: { deposits: any[]; banks: any[]; cashPosition: any } | null) {
    if (!d) return null
    const { deposits = [], banks = [], cashPosition } = d

    return (
      <div className="animate-scale-in">
        {cashPosition && (
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value">{fmt(cashPosition.todayCashSales)}</div>
              <div className="stat-label">Today&apos;s Cash Sales</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{fmt(cashPosition.todayDeposited)}</div>
              <div className="stat-label">Deposited Today</div>
            </div>
            <div className="stat-card" style={{ borderLeft: '4px solid var(--accent)' }}>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>{fmt(cashPosition.cashAtHand)}</div>
              <div className="stat-label">Cash at Hand</div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Bank Accounts</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const bankName = prompt('Bank name?')
            const accountName = prompt('Account name?')
            const accountNumber = prompt('Account number?')
            if (!bankName || !accountName || !accountNumber) return

            api.post('/accounting/bank-deposits/banks', {
              bankName, accountName, accountNumber,
              channelId: user?.channelId || '',
            }, token!).then(() => loadTab('deposits')).catch(e => toast.error((e as Error).message))
          }}>+ Add Bank</button>
        </div>
        <div className="table-container card" style={{ marginBottom: 24 }}>
          <table>
            <thead><tr><th>Bank</th><th>Account Name</th><th>Account No.</th><th>Branch</th></tr></thead>
            <tbody>
              {banks.map((b: any) => (
                <tr key={b.id}>
                  <td><strong>{b.bankName}</strong></td>
                  <td>{b.accountName}</td>
                  <td><code>{b.accountNumber}</code></td>
                  <td>{b.branch || '—'}</td>
                </tr>
              ))}
              {banks.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No bank accounts configured yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Deposit Log</h3>
          <button className="btn btn-primary btn-sm" disabled={banks.length === 0} onClick={() => {
            const amount = Number(prompt('Amount deposited?'))
            const reference = prompt('Bank slip / reference number (optional)?') || undefined
            if (!amount || isNaN(amount) || amount <= 0) return

            api.post('/accounting/bank-deposits', {
              amount, reference,
              channelId: user?.channelId || '',
            }, token!).then(() => loadTab('deposits')).catch(e => toast.error((e as Error).message))
          }}>+ Log Deposit</button>
        </div>
        <div className="table-container card">
          <table>
            <thead><tr><th>Date</th><th>Channel</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {deposits.map((dep: any) => (
                <tr key={dep.id}>
                  <td>{new Date(dep.depositedAt).toLocaleString()}</td>
                  <td>{dep.channel?.name || '—'}</td>
                  <td>{dep.reference || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{fmt(Number(dep.amount))}</td>
                </tr>
              ))}
              {deposits.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No deposits logged yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
}

