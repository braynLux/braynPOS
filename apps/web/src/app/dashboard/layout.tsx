'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { useOfflineStore } from '@/stores/offline.store'
import { NAV_ITEMS_BY_ROLE, ROLE_LANDING_PAGES, getNavForUser } from '@/lib/nav-config'
import { api } from '@/lib/api-client'
import { io } from 'socket.io-client'
import { toast } from 'react-hot-toast'
import ChatInterface from '@/components/ChatInterface'
import { SystemHealthPill } from './SystemHealthPill'
import { resolveEnterpriseCapabilities, type PlanFeatureKey } from '@/lib/plans'
import { NotificationCenter } from '@/components/shared/NotificationCenter'
import { SubscriptionBanner } from '@/components/shared/SubscriptionBanner'

const FEATURE_ROUTE_MAP: Array<{ prefix: string; feature: PlanFeatureKey; name: string }> = [
  { prefix: '/dashboard/invoicing', feature: 'invoicing', name: 'Invoicing' },
  { prefix: '/dashboard/transfers', feature: 'transfers', name: 'Stock Transfers' },
  { prefix: '/dashboard/serials', feature: 'serials', name: 'Serial Numbers' },
  { prefix: '/dashboard/credit', feature: 'credit', name: 'Customer Credit' },
  { prefix: '/dashboard/accounting/assets', feature: 'fixedAssets', name: 'Fixed Assets' },
  { prefix: '/dashboard/accounting', feature: 'accounting', name: 'Accounting' },
  { prefix: '/dashboard/items/bulk-opening', feature: 'catalog', name: 'Master Catalog Setup' },
  { prefix: '/dashboard/payroll', feature: 'payroll', name: 'Payroll' },
  { prefix: '/dashboard/audit/margin-audit', feature: 'marginAudit', name: 'Forensic Audit' },
  { prefix: '/dashboard/audit/serials', feature: 'serials', name: 'Serial Forensics' },
  { prefix: '/dashboard/ai-portal', feature: 'aiPortal', name: 'LuxAI' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, user, logout, exitWorkspace, isPlatformOwnerSwitched, accessToken: token } = useAuthStore()
  const { isOnline, getPendingCount, syncPendingSales } = useOfflineStore()
  const pendingCount = getPendingCount()

  const isPlatformOwner = user?.role === 'PLATFORM_OWNER'
  const isSwitchedWorkspace = Boolean(isPlatformOwnerSwitched && isPlatformOwner && user?.enterpriseId)
  const isPlatformView = isPlatformOwner && !user?.enterpriseId

  // When a Platform Owner is switched into a tenant, give them the full Manager Admin navigation for that tenant
  const effectiveRole = (isPlatformOwnerSwitched && isPlatformOwner && user?.enterpriseId) ? 'MANAGER_ADMIN' : (user?.role || 'CASHIER')
  const roleNav = getNavForUser(effectiveRole, user?.enterprise)
  const isPosMode = pathname === '/dashboard/pos'

  const [mounted, setMounted] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Plan capability check
  const isFeatureBlocked = Boolean(
    user?.enterprise && FEATURE_ROUTE_MAP.some((rule) => {
      if (pathname === rule.prefix || pathname.startsWith(rule.prefix + '/')) {
        const caps = resolveEnterpriseCapabilities(user.enterprise)
        return !caps.hasFeature(rule.feature)
      }
      return false
    })
  )

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (mounted && !isAuthenticated) router.replace('/login')
  }, [mounted, isAuthenticated, router])

  useEffect(() => {
    if (!isAuthenticated || !mounted) return

    // If viewing a feature that does not exist in this enterprise's plan tier, redirect away immediately
    if (isFeatureBlocked) {
      toast.error('This module is not included in your current subscription plan.', { id: 'plan-feature-locked' })
      router.replace('/dashboard')
      return
    }

    // Platform Owner in Master Fleet has global access
    if (user?.role === 'PLATFORM_OWNER' && !user?.enterpriseId) return

    const allowedHrefs = roleNav.flatMap(g => g.items.map(i => i.href))
    const landingPage = user?.role ? ROLE_LANDING_PAGES[user.role] : '/dashboard'
    const isAllowed = pathname === landingPage || pathname === '/dashboard' || allowedHrefs.some(href => pathname === href || pathname.startsWith(href + '/'))
    if (!isAllowed && pathname !== '/dashboard/settings') {
      router.replace(landingPage!)
    }
  }, [isAuthenticated, pathname, user, roleNav, router, isFeatureBlocked, mounted])

  useEffect(() => {
    const handleOnline  = () => useOfflineStore.getState().setOnline(true)
    const handleOffline = () => useOfflineStore.getState().setOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Close sidebar on navigation (mobile)
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  // Close sidebar on wide screen resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (isOnline && isAuthenticated && token && pendingCount > 0) {
      const timer = setTimeout(() => syncPendingSales(api, token), 5000)
      return () => clearTimeout(timer)
    }
  }, [isOnline, isAuthenticated, token, pendingCount, syncPendingSales])

  useEffect(() => {
    if (!isAuthenticated || !token || !user) return
    const isAuthorized = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'PLATFORM_OWNER'].includes(user.role)
    if (!isAuthorized) return

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080', {
      auth: { token },
      transports: ['websocket'],
    })

    // 1. Listen for Approval Requests
    socket.on('new_approval_request', (data: any) => {
      toast.custom((t) => (
        <div className={`toast-custom ${t.visible ? 'animate-enter' : 'animate-leave'}`} style={{
          background: 'var(--bg-elevated)', borderLeft: '4px solid var(--accent)',
          padding: '16px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280, maxWidth: 340,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔔</span> Approval Requested
          </div>
          <div style={{ fontSize: '0.9rem' }}>{data.notes || `${data.action.replace('_', ' ')} request`}</div>
          <button className="btn btn-primary btn-sm" onClick={() => { toast.dismiss(t.id); router.push('/dashboard/approvals') }}>
            Review Request
          </button>
        </div>
      ), { duration: 10000, position: 'top-right' })
    })

    // 2. Listen for General Omni-Channel Notifications (Low Stock, Margins, etc)
    socket.on('notification', (data: any) => {
        const isVulnerability = data.message.includes('VULNERABILITY')
        const icon = isVulnerability ? '⚠️' : '📢'
        const color = isVulnerability ? 'var(--error)' : 'var(--primary)'

        toast.custom((t) => (
          <div className={`toast-custom ${t.visible ? 'animate-enter' : 'animate-leave'}`} style={{
            background: 'var(--bg-elevated)', borderLeft: `4px solid ${color}`,
            padding: '16px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280, maxWidth: 340,
          }}>
            <div style={{ fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{icon}</span> {data.type.replace('_', ' ')}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{data.message}</div>
            <div style={{ display: 'flex', gap: 8 }}>
                 <button className="btn btn-ghost btn-sm" onClick={() => toast.dismiss(t.id)}>Dismiss</button>
                 {isVulnerability && (
                   <button className="btn btn-primary btn-sm" onClick={() => { toast.dismiss(t.id); router.push('/dashboard/reports/margins') }}>
                     Fix Cost
                   </button>
                 )}
            </div>
          </div>
        ), { duration: 8000, position: 'top-right' })
    })

    return () => { socket.disconnect() }
  }, [isAuthenticated, token, user, router])

  if (!isAuthenticated) return null

  const SidebarContent = () => (
    <>
      <div className="sidebar-brand" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        marginBottom: '8px',
        borderBottom: isPlatformView ? '2px solid rgba(245, 158, 11, 0.35)' : '1px solid var(--border)',
        background: isPlatformView ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.05))' : 'var(--bg-elevated)',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{
            fontSize: '1.15rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: 0,
            lineHeight: 1.3,
          }}>
            {isPlatformView ? (
              <span style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: 900,
                letterSpacing: '-0.02em',
              }}>braynPOS Fleet HQ</span>
            ) : (
              user?.enterprise?.name || 'LUX FLEET'
            )}
          </h1>
          <div style={{
            marginTop: 5,
            fontSize: '0.82rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}>
            <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
              {isPlatformView ? '🛡️ Master Control' : (user?.channel?.name || 'Main Branch')}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span className="badge badge-info" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
              {isPlatformView ? 'PLATFORM OWNER' : (user?.enterprise?.plan || 'STARTER')}
            </span>
          </div>
        </div>
      </div>

      {isSwitchedWorkspace && (
        <div style={{ padding: '0 12px 10px' }}>
          <button
            onClick={() => {
              exitWorkspace()
              router.push('/dashboard/enterprises')
            }}
            className="btn btn-sm"
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.75rem',
              fontWeight: 800,
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
            }}
          >
            ← Return to Fleet HQ
          </button>
        </div>
      )}

      <div className="sidebar-nav">
        {roleNav.map((group) => (
          <div className="nav-group" key={group.group}>
            <div className="nav-group-label">{group.group}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 18px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pendingCount > 0 && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 'var(--radius-md)', padding: '9px 12px',
            fontSize: '0.85rem', color: 'var(--warning)', fontWeight: 600,
          }}>
            ⚡ {pendingCount} offline sale{pendingCount > 1 ? 's' : ''} pending sync
          </div>
        )}

        {/* Notification Center in sidebar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{user?.username}</strong>
            <br />
            <span className="badge badge-primary" style={{ marginTop: 5, fontSize: '0.75rem' }}>{user?.role}</span>
          </div>
          <NotificationCenter />
        </div>

        <SystemHealthPill />

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { logout(); router.push('/login') }}
          style={{ width: '100%', justifyContent: 'center', fontSize: '0.9rem' }}
          id="logout-btn"
        >
          Sign Out
        </button>

        {!isSwitchedWorkspace && user?.role === 'SUPER_ADMIN' && user?.enterpriseId && (
          <div style={{
            padding: '9px 11px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
          }}>
            🛡️ <strong>Tenant Admin Mode</strong><br />
            Sign out and log in as <code>admin</code> to access Master Fleet.
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="layout" style={{ display: 'flex', minHeight: '100vh' }}>
      {!isPosMode && (
        <>
          {/* Desktop sidebar — single navigation pane, no top bar */}
          <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="main-sidebar">
            <SidebarContent />
          </nav>

          {/* Mobile overlay backdrop */}
          {sidebarOpen && (
            <div
              className="sidebar-overlay"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Mobile top bar with hamburger */}
          <div className="mobile-topbar" id="mobile-topbar">
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(s => !s)}
              aria-label="Toggle navigation menu"
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? '✕' : '☰'}
            </button>
            <span className="mobile-brand">LUX</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!isOnline && <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>Offline</span>}
              {pendingCount > 0 && <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>⚡{pendingCount}</span>}
              <NotificationCenter />
            </div>
          </div>
        </>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <SubscriptionBanner />
        <main className={`main-content ${isPosMode ? 'full-width' : ''}`} id="main-content" style={{ flex: 1 }}>
          {isFeatureBlocked ? null : children}
        </main>
      </div>

      <ChatInterface />

      <style jsx>{`
        .mobile-topbar {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 56px;
          background: var(--bg-sidebar);
          border-bottom: 1px solid var(--border);
          z-index: 48;
          padding: 0 16px;
          align-items: center;
          justify-content: space-between;
        }
        .hamburger-btn {
          width: 44px;
          height: 44px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--text-primary);
          font-size: 1.2rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          touch-action: manipulation;
        }
        .mobile-brand {
          font-size: 1.1rem;
          font-weight: 800;
          background: linear-gradient(135deg, var(--primary-light), var(--accent));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        @media (max-width: 768px) {
          .mobile-topbar { display: flex; }
          .main-content:not(.full-width) { padding-top: calc(56px + 16px) !important; }
        }
      `}</style>
    </div>
  )
}
