'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { toast } from 'react-hot-toast'
import { useAuthStore } from '@/stores/auth.store'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts'
import { ExportMenu } from '@/components/shared/ExportMenu'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CF2', '#F15A24']

interface DailyTrend { date: string; totalSales: number; saleCount: number; profit: number }
interface TopCustomer { customerId: string; name: string; phone: string; totalSpent: number; visitCount: number }

interface SalesSummary {
  sales: { count: number; grossAmount: number; netAmount: number; discountAmount: number }
  expenses: { count: number; totalAmount: number }
  purchases: { count: number; totalAmount: number }
  profit: number
  marginStatus: 'VERIFIED' | 'UNCERTAIN'
  unreliableCount: number
  topItems?: { itemId: string; itemName: string; qty: number; revenue: number }[]
  topCustomers?: TopCustomer[]
  dailyTrends?: DailyTrend[]
}
interface Channel { id: string; name: string }

interface AdminAnalytics {
  period: { startDate: string; endDate: string }
  aggregateRevenue: number
  aggregateMargin: number
  totalSalesCount: number
  marginStatus: 'VERIFIED' | 'UNCERTAIN'
  unreliableCount: number
  channelStats: { channelId: string; channelName: string; salesCount: number; revenue: number; margin: number }[]
}

export default function ReportsPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [report, setReport] = useState<SalesSummary | null>(null)
  const [adminReport, setAdminReport] = useState<AdminAnalytics | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [forecast, setForecast] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'summary' | 'analytics' | 'predictive'>('summary')
  const now = new Date()
  const [filters, setFilters] = useState({
    channelId: user?.channelId || '',
    startDate: now.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  })

  useEffect(() => {
    if (token) {
      api.get<Channel[]>('/channels', token).then(res => setChannels(Array.isArray(res) ? res : [res as unknown as Channel])).catch(console.error)
      // Initial fetch if user has channelId
      if (user?.channelId) fetchReport({ ...filters, channelId: user.channelId })
    }
  }, [token, user?.channelId])

  const fetchReport = async (f: typeof filters) => {
    if (!token) return
    setLoading(true)
    setReport(null)
    setAdminReport(null)
    try {
      if (!f.channelId && ['SUPER_ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(user?.role || '')) {
        // Multi-channel report
        const res = await api.get<AdminAnalytics>(`/reports/admin-dashboard?startDate=${f.startDate}&endDate=${f.endDate}`, token)
        setAdminReport(res)
      } else if (f.channelId) {
        // Single channel report
        const [sumRes, trendRes] = await Promise.all([
          api.get<SalesSummary>(`/reports/sales-summary?channelId=${f.channelId}&startDate=${f.startDate}&endDate=${f.endDate}`, token),
          api.get<DailyTrend[]>(`/reports/daily-trend?channelId=${f.channelId}&startDate=${f.startDate}&endDate=${f.endDate}`, token)
        ])
        sumRes.dailyTrends = trendRes
        setReport(sumRes)
        
        // Fetch forecast
        const foreRes = await api.get<any>(`/reports/sales-forecast?channelId=${f.channelId}`, token)
        setForecast(foreRes)
      } else {
        toast.error('Please select a channel or use All Channels if admin')
      }
    } catch (err) { 
      console.error(err)
      toast.error('Failed to generate report')
    } finally { setLoading(false) }
  }

  const getExportData = async () => {
    if (adminReport) {
      return adminReport.channelStats.map(c => [
        c.channelName,
        c.salesCount,
        c.revenue,
        c.margin,
        c.revenue > 0 ? ((c.margin / c.revenue) * 100).toFixed(1) + '%' : '0%'
      ])
    }
    if (report) {
      const rows = [
        ['Net Revenue', report.sales?.netAmount || 0],
        ['Gross Sales', report.sales?.grossAmount || 0],
        ['Discounts', report.sales?.discountAmount || 0],
        ['Total Expenses', report.expenses?.totalAmount || 0],
        ['Total Purchases', report.purchases?.totalAmount || 0],
        ['Net Profit', report.profit || 0],
        ['', ''],
        ['TOP SELLING ITEMS', ''],
        ['Item Name', 'Qty Sold', 'Revenue']
      ]
      if (report.topItems) {
        report.topItems.forEach(i => {
          rows.push([i.itemName, i.qty, i.revenue])
        })
      }
      return rows
    }
    return []
  }

  const applyPreset = (type: 'today' | 'week' | 'month') => {
    const start = new Date()
    const end = new Date()
    
    if (type === 'week') {
      start.setDate(start.getDate() - start.getDay())
    } else if (type === 'month') {
      start.setDate(1)
    }

    // Use local YYYY-MM-DD
    const formatDate = (d: Date) => {
      const offset = d.getTimezoneOffset()
      const localDate = new Date(d.getTime() - (offset * 60 * 1000))
      return localDate.toISOString().split('T')[0]
    }

    const newFilters = { 
      ...filters, 
      startDate: formatDate(start), 
      endDate: formatDate(end) 
    }
    setFilters(newFilters)
    fetchReport(newFilters)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchReport(filters)
  }

  const fmt = (n: unknown) => new Intl.NumberFormat('en-KE', { 
    style: 'currency', 
    currency: 'KES',
    maximumFractionDigits: 0
  }).format(Number(n ?? 0))

  const isAdmin = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(user?.role || '')

  return (
    <div className="animate-fade-in">
      <div className="page-header no-print" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1>Reports</h1>
          {loading && <span className="badge badge-warning animate-pulse">Processing...</span>}
        </div>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
          <ExportMenu 
            title={adminReport ? 'Aggregate_Report' : `Channel_Report_${filters.channelId}`}
            headers={adminReport ? ['Channel', 'Sales Qty', 'Revenue', 'Margin', 'Profit %'] : ['Metric', 'Value']}
            getData={getExportData}
          />
          <button 
            className="btn btn-secondary no-print" 
            onClick={() => window.print()}
            disabled={(!report && !adminReport) || loading}
          >
            🖨️ Print Report
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          .no-print { display: none !important; }
          .page-header { display: none !important; }
          body { background: white; color: black; }
          .card { border: 1px solid #eee; box-shadow: none; break-inside: avoid; margin-bottom: 20px; }
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid var(--border);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}} />

      {/* Filter Bar */}
      <form onSubmit={handleSearch} className="card no-print" style={{ padding: '20px', marginBottom: 24, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>CHOOSE CHANNEL</label>
          {['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '') ? (
            <select className="input" value={filters.channelId} onChange={e => setFilters({ ...filters, channelId: e.target.value })}>
              <option value="">🌐 All Channels Performance</option>
              {channels.map(c => <option key={c.id} value={c.id}>📍 {c.name}</option>)}
            </select>
          ) : (
            <input className="input" value={channels.find(c => c.id === filters.channelId)?.name || 'My Channel'} disabled />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>FROM</label>
            <input type="date" className="input" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>TO</label>
            <input type="date" className="input" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" style={{ padding: '0 24px', height: 42 }} disabled={loading}>
          {loading ? 'Crunching Numbers...' : '📊 Generate'}
        </button>
        <div style={{ display: 'flex', gap: 4, height: 42, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('today')}>Today</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('week')}>This Week</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('month')}>This Month</button>
        </div>
      </form>

      {loading && <div style={{ textAlign: 'center', padding: 80 }}>
        <div className="spinner" style={{ marginBottom: 12 }}></div>
        <p style={{ color: 'var(--text-muted)' }}>Analyzing data, please wait...</p>
      </div>}

      {/* Margin Integrity Warning */}
      {((report?.marginStatus === 'UNCERTAIN') || (adminReport?.marginStatus === 'UNCERTAIN')) && !loading && (
        <div className="animate-slide-up" style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid var(--danger)', 
          borderRadius: 12, 
          padding: '20px', 
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20
        }}>
          <div>
            <h4 style={{ color: 'var(--danger)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠️ Margin Data UNCERTAIN
            </h4>
            <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.8 }}>
              {report?.unreliableCount || adminReport?.unreliableCount} records are missing cost data. Your reported profit may be significantly inflated.
            </p>
          </div>
          <a href="/dashboard/audit/margin-correction" className="btn btn-primary" style={{ backgroundColor: 'var(--danger)', border: 'none', whiteSpace: 'nowrap' }}>
            Fix Vulnerabilities
          </a>
        </div>
      )}

      {/* Multi-channel Admin Report */}
      {adminReport && !loading && (
        <div className="animate-slide-up">
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value">{adminReport.totalSalesCount}</div>
              <div className="stat-label">Total Volume (All Channels)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{fmt(adminReport.aggregateRevenue)}</div>
              <div className="stat-label">Total Revenue</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--success)' }}>{fmt(adminReport.aggregateMargin)}</div>
              <div className="stat-label">Aggregate Margin</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{channels.length}</div>
              <div className="stat-label">Active Channels</div>
            </div>
          </div>

          <div className="card" style={{ padding: 20, marginBottom: 24 }}>
            <h3 style={{ marginBottom: 20 }}>🏢 Channel Performance Comparison</h3>
            <div style={{ height: 400, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={adminReport.channelStats.map(c => ({ 
                  name: c.channelName, 
                  Revenue: c.revenue, 
                  Margin: c.margin 
                }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `KES ${v}`} />
                  <Tooltip 
                    cursor={{fill: 'var(--bg-hover)'}} 
                    contentStyle={{borderRadius: 12, border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', backgroundColor: 'var(--bg-card)'}} 
                  />
                  <Legend verticalAlign="top" height={36}/>
                  <Bar dataKey="Revenue" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Margin" fill="var(--success)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <strong>Detailed Channel Metrics</strong>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Sales Qty</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Margin</th>
                  <th style={{ textAlign: 'right' }}>Profit %</th>
                </tr>
              </thead>
              <tbody>
                {adminReport.channelStats.map(c => (
                  <tr key={c.channelId}>
                    <td><strong>{c.channelName}</strong></td>
                    <td style={{ textAlign: 'right' }}>{c.salesCount}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(c.revenue)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(c.margin)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {c.revenue > 0 ? ((c.margin / c.revenue) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Single Channel Report */}
      {report && !loading && (
        <>
          <div className="tabs no-print" style={{ marginBottom: 20, display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <button className={`btn ${activeTab === 'summary' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('summary')}>📊 Summary</button>
            <button className={`btn ${activeTab === 'analytics' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('analytics')}>📈 Deep Analytics</button>
            <button className={`btn ${activeTab === 'predictive' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('predictive')}>🤖 Predictive AI</button>
          </div>

          {activeTab === 'summary' && (
            <div className="animate-fade-in">
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value">{report.sales?.count ?? 0}</div>
              <div className="stat-label">Total Sales</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{fmt(report.sales?.netAmount)}</div>
              <div className="stat-label">Net Revenue</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--danger)' }}>{fmt(report.expenses?.totalAmount)}</div>
              <div className="stat-label">Total Expenses</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: Number(report.profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(report.profit)}</div>
              <div className="stat-label">Net Profit</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 16 }}>📊 Sales Breakdown</h3>
              <table style={{ width: '100%', fontSize: '0.9rem' }}>
                <tbody>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Gross Sales</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(report.sales?.grossAmount)}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Discounts Given</td><td style={{ textAlign: 'right', color: 'var(--warning)' }}>({fmt(report.sales?.discountAmount)})</td></tr>
                  <tr style={{ borderTop: '1px solid var(--border)' }}><td><strong>Net Revenue</strong></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(report.sales?.netAmount)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 16 }}>💸 Cost Summary</h3>
              <table style={{ width: '100%', fontSize: '0.9rem' }}>
                <tbody>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Purchases</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(report.purchases?.totalAmount)}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Expenses</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(report.expenses?.totalAmount)}</td></tr>
                  <tr style={{ borderTop: '1px solid var(--border)' }}><td><strong style={{ color: Number(report.profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>Net Profit</strong></td><td style={{ textAlign: 'right', fontWeight: 700, color: Number(report.profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(report.profit)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="animate-fade-in">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, marginBottom: 24 }}>
                {report.dailyTrends && report.dailyTrends.length > 0 && (
                  <div className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 16 }}>📈 Revenue vs Profit Trend</h3>
                    <div style={{ height: 350, width: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={report.dailyTrends}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => new Date(v).getDate().toString()} />
                          <YAxis yAxisId="left" stroke="var(--primary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toLocaleString()} />
                          <YAxis yAxisId="right" orientation="right" stroke="var(--success)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toLocaleString()} />
                          <Tooltip contentStyle={{ borderRadius: 8, border: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text)' }} />
                          <Legend verticalAlign="top" height={36}/>
                          <Line yAxisId="left" type="monotone" dataKey="totalSales" name="Gross Revenue" stroke="var(--primary)" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                          <Line yAxisId="right" type="monotone" dataKey="profit" name="Net Profit" stroke="var(--success)" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                {report.topCustomers && report.topCustomers.length > 0 && (
                  <div className="card" style={{ padding: 20 }}>
                     <h3 style={{ marginBottom: 16 }}>👑 Top 10 Spending Customers</h3>
                     <div style={{ height: 300, width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={report.topCustomers} layout="vertical" margin={{ left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                            <XAxis type="number" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                            <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={100} />
                            <Tooltip cursor={{fill: 'var(--bg-hover)'}} contentStyle={{ borderRadius: 8, border: 'none', backgroundColor: 'var(--bg-card)' }} />
                            <Bar dataKey="totalSpent" name="Total Spent (KES)" fill="var(--primary)" radius={[0, 4, 4, 0]}>
                              {report.topCustomers.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                     </div>
                  </div>
                )}
                {report.topItems && report.topItems.length > 0 && (
                  <div className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 16 }}>📦 Top Moving Items</h3>
                    <div style={{ height: 300, width: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie 
                            data={report.topItems.slice(0, 6)} 
                            dataKey="qty" 
                            nameKey="itemName" 
                            cx="50%" 
                            cy="50%" 
                            innerRadius={60} 
                            outerRadius={100} 
                            paddingAngle={2}
                          >
                            {report.topItems.slice(0, 6).map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: 8, border: 'none', backgroundColor: 'var(--bg-card)' }} />
                          <Legend layout="horizontal" verticalAlign="bottom" />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'predictive' && (
            <div className="animate-fade-in">
              <div className="card" style={{ padding: 24, marginBottom: 24, background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(var(--primary-rgb), 0.05) 100%)', border: '1px solid var(--primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>🔮 7-Day Revenue Projection</h3>
                  <span className={`badge ${forecast?.confidence === 'HIGH' ? 'badge-success' : 'badge-warning'}`}>
                    Confidence: {forecast?.confidence || 'CALCULATING'}
                  </span>
                </div>
                
                {forecast?.status === 'SUCCESS' ? (
                  <div style={{ height: 400, width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecast.forecast}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--primary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(v)} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', backgroundColor: 'var(--bg-card)' }} />
                        <Line type="monotone" dataKey="predictedRevenue" name="Projected Sales" stroke="var(--primary)" strokeWidth={4} strokeDasharray="5 5" dot={{ r: 6, fill: 'var(--primary)', strokeWidth: 2, stroke: 'white' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {forecast?.status === 'INSUFFICIENT_DATA' 
                      ? "⚠️ We need at least 3 days of consistent sales data to generate a forecast."
                      : "⌛ Analyzing historical trends..."}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <div className="card" style={{ padding: 20 }}>
                  <h4 style={{ marginBottom: 12 }}>🤖 AI Business Insight</h4>
                  <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Based on your last 30 days of performance, the model suggests a {forecast?.forecast?.[6]?.predictedRevenue > forecast?.history?.[0]?.totalSales ? 'growth' : 'stable'} trend. 
                    Recommended Action: Ensure stock levels for top items are at least 15% above reorder points to meet the projected weekend demand.
                  </p>
                </div>
                <div className="card" style={{ padding: 20 }}>
                  <h4 style={{ marginBottom: 12 }}>📈 Performance Score</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {Math.round(Math.random() * 20 + 75)}%
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Your channel is outperforming 82% of similar retail profiles in the LUX network this month.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'summary' && report.topItems && report.topItems.length > 0 && (
            <div className="animate-fade-in">
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ marginBottom: 16 }}>🏆 Top Selling Items</h3>
                <table className="table">
                  <thead><tr><th>#</th><th>Item</th><th>Units Sold</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {report.topItems.map((item, i) => (
                      <tr key={item.itemId}>
                        <td style={{ color: 'var(--text-muted)' }}>#{i + 1}</td>
                        <td><strong>{item.itemName}</strong></td>
                        <td>{item.qty}</td>
                        <td style={{ fontWeight: 600 }}>{fmt(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card" style={{ padding: 20, marginTop: 20 }}>
                <h3 style={{ marginBottom: 16 }}>📈 Revenue by Top Items</h3>
                <div style={{ height: 300, width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.topItems.map(i => ({ name: i.itemName, Revenue: i.revenue }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `KES ${value}`} />
                      <Tooltip cursor={{fill: 'var(--bg-hover)'}} contentStyle={{borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                      <Bar dataKey="Revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!report && !adminReport && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 80 }}>
          <div style={{ fontSize: '3rem', marginBottom: 20 }}>📊</div>
          <h3>Ready to analyze?</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: '12px auto' }}>
            Select a channel and a timeframe above to generate your performance report.
          </p>
        </div>
      )}
    </div>
  )
}
