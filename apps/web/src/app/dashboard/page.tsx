'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

interface DashboardData {
  todaySales: number
  todayRevenue: number
  todayExpenses: number
  todayProfit: number
  markupPercent: number
  activeChannels: number
  lowStockItems: number
  pendingTransfers: number
  lowStockList: {
    id: string; name: string; sku: string
    availableQty: number; reorderLevel: number; severity: 'critical' | 'low'
  }[]
  recentSales: {
    id: string
    receiptNo: string
    netAmount: number
    createdAt: string
    customer?: { name: string }
    channel?: { name: string }
  }[]
}
interface AdminStats {
  aggregateRevenue: number
  aggregateMargin: number
  totalSalesCount: number
  channelStats: {
    channelName: string
    revenue: number
    margin: number
  }[]
}

export default function DashboardPage() {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const [data, setData] = useState<DashboardData | null>(null)
  const [adminData, setAdminData] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    
    const fetchDashboard = async () => {
      try {
        const res = await api.get<DashboardData>('/dashboard/summary', token)
        setData(res)
        
        if (['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '')) {
          const today = new Date().toISOString().split('T')[0]
          const adminRes = await api.get<AdminStats>(`/reports/admin-dashboard?startDate=${today}T00:00:00Z&endDate=${today}T23:59:59Z`, token)
          setAdminData(adminRes)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchDashboard()
  }, [token, user?.role])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(n)

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Today&apos;s performance overview
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge badge-success">● System Online</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Loading dashboard...
        </div>
      ) : (
        <div className="stat-grid">
          <div className="stat-card" id="stat-revenue">
            <div className="stat-value">{formatCurrency(data?.todayRevenue ?? 0)}</div>
            <div className="stat-label">Today&apos;s Revenue</div>
          </div>
          <div className="stat-card" id="stat-sales">
            <div className="stat-value">{data?.todaySales ?? 0}</div>
            <div className="stat-label">Sales Transactions</div>
          </div>
          <div className="stat-card" id="stat-expenses">
            <div className="stat-value">{formatCurrency(data?.todayExpenses ?? 0)}</div>
            <div className="stat-label">Today&apos;s Expenses</div>
          </div>
          <div className="stat-card" id="stat-profit" style={{ borderLeft: '4px solid var(--success)' }}>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(data?.todayProfit ?? 0)}</div>
            <div className="stat-label">Expected Profit (Today)</div>
            {data?.markupPercent !== undefined && (
              <div style={{ fontSize: '0.75rem', marginTop: 4, opacity: 0.8 }}>
                Markup: {data.markupPercent.toFixed(1)}%
              </div>
            )}
          </div>
          <div className="stat-card" id="stat-channels">
            <div className="stat-value">{data?.activeChannels ?? 0}</div>
            <div className="stat-label">Active Channels</div>
          </div>
          <div className="stat-card" id="stat-low-stock" style={
            (data?.lowStockItems ?? 0) > 0
              ? { borderColor: 'rgba(245, 158, 11, 0.5)' }
              : {}
          }>
            <div className="stat-value" style={
              (data?.lowStockItems ?? 0) > 0
                ? { background: 'linear-gradient(135deg, var(--warning), #f97316)' as string, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
                : {}
            }>
              {data?.lowStockItems ?? 0}
            </div>
            <div className="stat-label">Low Stock Items</div>
          </div>
          <div className="stat-card" id="stat-transfers">
            <div className="stat-value">{data?.pendingTransfers ?? 0}</div>
            <div className="stat-label">Pending Transfers</div>
          </div>
        </div>
      )}

      {!loading && (data?.lowStockList?.length ?? 0) > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>⚠️ Low Stock Alert</h2>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>Available</th>
                  <th style={{ textAlign: 'right' }}>Reorder Level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.lowStockList.map(item => (
                  <tr key={item.id}>
                    <td><strong>{item.name}</strong></td>
                    <td><code style={{ fontSize: '0.8rem' }}>{item.sku}</code></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.availableQty}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{item.reorderLevel}</td>
                    <td>
                      <span className={`badge ${item.severity === 'critical' ? 'badge-danger' : 'badge-warning'}`}>
                        {item.severity === 'critical' ? 'Out of stock' : 'Low'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
              <Link href="/dashboard/stock" style={{ fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>View full stock levels →</Link>
            </div>
          </div>
        </div>
      )}

      {adminData && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>📊 System-Wide Overview (Today)</h2>
          <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
            <div className="stat-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--primary)' }}>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(adminData.aggregateRevenue)}</div>
              <div className="stat-label">System-Wide Revenue</div>
            </div>
            <div className="stat-card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--success)' }}>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(adminData.aggregateMargin)}</div>
              <div className="stat-label">System-Wide Gross Margin</div>
              {adminData.aggregateMargin === adminData.aggregateRevenue && adminData.aggregateRevenue > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  ⚠️ Margin = Revenue — set item cost prices to calculate real margin
                </div>
              )}
            </div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 16, fontSize: '1rem' }}>Channel Breakdown</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Gross Margin</th>
                </tr>
              </thead>
              <tbody>
                {adminData.channelStats.map((c, i) => (
                  <tr key={i}>
                    <td><strong>{c.channelName}</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(c.revenue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: c.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(c.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Activity */ }
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>🕒 Recent Transactions</h2>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Channel</th>
                <th>Customer</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentSales && data.recentSales.length > 0 ? (
                data.recentSales.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.receiptNo}</strong></td>
                    <td><span className="badge badge-outline">{s.channel?.name || 'Global'}</span></td>
                    <td>{s.customer?.name || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(s.netAmount)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No recent transactions recorded today.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <Link href="/dashboard/sales" style={{ fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none' }}>View all sales history →</Link>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/dashboard/pos" className="btn btn-primary">🛒 Open POS Terminal</Link>
          <Link href="/dashboard/items" className="btn btn-ghost">📋 Manage Items</Link>
          <Link href="/dashboard/sales" className="btn btn-ghost">💰 View Sales</Link>
          <Link href="/dashboard/reports" className="btn btn-ghost">📊 Reports</Link>
          <Link href="/dashboard/accounting" className="btn btn-ghost">📒 Accounting</Link>
        </div>
      </div>
    </div>
  )
}
