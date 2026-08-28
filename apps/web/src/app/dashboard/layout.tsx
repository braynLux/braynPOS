'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { useOfflineStore } from '@/stores/offline.store'
import { NAV_ITEMS_BY_ROLE, ROLE_LANDING_PAGES } from '@/lib/nav-config'
import { api } from '@/lib/api-client'
import { io } from 'socket.io-client'
import { toast } from 'react-hot-toast'
import ChatInterface from '@/components/ChatInterface'
import { SystemHealthPill } from './SystemHealthPill'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, user, logout, exitWorkspace, isPlatformOwnerSwitched, accessToken: token } = useAuthStore()
  const { isOnline, getPendingCount, syncPendingSales } = useOfflineStore()
  const pendingCount = getPendingCount()

  const isSuperOrPlatformOwner = user?.role === 'PLATFORM_OWNER' || user?.role === 'SUPER_ADMIN'
  const isSwitchedWorkspace = isPlatformOwnerSwitched || (isSuperOrPlatformOwner && !!user?.enterpriseId && pathname !== '/dashboard/enterprises')

  // When a Platform Owner is switched into a tenant, give them the full Manager Admin navigation
  const effectiveRole = (isPlatformOwnerSwitched && user?.enterpriseId) ? 'MANAGER_ADMIN' : (user?.role || 'CASHIER')
  const roleNav = NAV_ITEMS_BY_ROLE[effectiveRole] || NAV_ITEMS_BY_ROLE['CASHIER']
  const isPosMode = pathname === '/dashboard/pos'

  const [mounted, setMounted] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (mounted && !isAuthenticated) router.replace('/login')
  }, [mounted, isAuthenticated, router])

  useEffect(() => {
    if (!isAuthenticated || !mounted) return
    if (isSuperOrPlatformOwner) return // Super Admin / Platform Owner has full access across all dashboard pages

    const allowedHrefs = roleNav.flatMap(g => g.items.map(i => i.href))
    const landingPage = user?.role ? ROLE_LANDING_PAGES[user.role] : '/dashboard'
    const isAllowed = pathname === landingPage || allowedHrefs.some(href => pathname === href || pathname.startsWith(href + '/'))
    if (!isAllowed && pathname !== '/dashboard/settings') {
      router.replace(landingPage!)
    }
  }, [isAuthenticated, pathname, user, roleNav, router, isSuperOrPlatformOwner, mounted])

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

  const isPlatformView = user?.role === 'PLATFORM_OWNER' && !isPlatformOwnerSwitched

  const SidebarContent = () => (
    <>
      <div className="sidebar-brand" style={isPlatformView ? {
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(217, 119, 6, 0.04))',
        borderBottom: '2px solid rgba(245, 158, 11, 0.3)',
      } : undefined}>
        <h1 style={{ fontSize: '1.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        <p style={{ marginTop: 4, opacity: 0.7, fontSize: '0.75rem' }}>
          {isPlatformView
            ? '🛡️ Platform Owner • Master Control'
            : `${user?.channel?.name || 'Master Fleet'} • ${user?.enterprise?.plan || 'Platform Admin'}`
          }
        </p>
      </div>

      <div className="sidebar-nav">
        {roleNav.map((group) => (
          <div className="nav-group" key={group.group}>
            <div className="nav-group-label">{group.group}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${pathname === item.href ? 'active' : ''}`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        {pendingCount > 0 && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 'var(--radius-md)', padding: '8px 12px', marginBottom: 12,
            fontSize: '0.8rem', color: 'var(--warning)',
          }}>
            ⚡ {pendingCount} offline sale{pendingCount > 1 ? 's' : ''} pending sync
          </div>
        )}
        
        <div style={{ marginBottom: 12 }}>
          <SystemHealthPill />
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{user?.username}</strong><br />
          <span className="badge badge-primary" style={{ marginTop: 4 }}>{user?.role}</span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { logout(); router.push('/login') }}
          style={{ width: '100%', marginTop: 12, justifyContent: 'center' }}
          id="logout-btn"
        >
          Sign Out
        </button>
      </div>
    </>
  )

  return (
    <div className="layout" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* ── Platform Super Admin Workspace Impersonation Banner ── */}
      {isSwitchedWorkspace && (
        <div style={{
          background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.85rem',
          fontWeight: 600,
          borderBottom: '2px solid var(--primary)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          zIndex: 99,
          position: 'sticky',
          top: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>🛡️</span>
            <span>
              Platform Super Admin: Active in <strong>{user?.enterprise?.name}</strong> ({user?.channel?.name || 'Headquarters'})
            </span>
          </div>
          <button
            onClick={() => {
              exitWorkspace()
              router.push('/dashboard/enterprises')
            }}
            className="btn btn-sm"
            style={{
              background: 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: 700,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            ← Exit to Master Fleet
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1 }}>
        {!isPosMode && (
          <>
            {/* Desktop sidebar */}
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
                {!isOnline && <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>Offline</span>}
                {pendingCount > 0 && <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>⚡{pendingCount}</span>}
              </div>
            </div>
          </>
        )}

        <main className={`main-content ${isPosMode ? 'full-width' : ''}`} id="main-content" style={{ flex: 1 }}>
          {children}
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
