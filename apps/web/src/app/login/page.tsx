'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, sanitizeErrorMessage } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ROLE_LANDING_PAGES } from '@/lib/nav-config'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    useAuthStore.getState().logout()
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        user: { role: string; [key: string]: any }
      }>('/auth/login', { username: username.trim(), password })

      setAuth(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        res.user as never
      )
      let landingPage = ROLE_LANDING_PAGES[res.user.role] || '/dashboard'
      if (res.user.role === 'PLATFORM_OWNER' || (res.user.role === 'SUPER_ADMIN' && !res.user.enterpriseId)) {
        landingPage = '/dashboard/enterprises'
      }
      router.push(landingPage)
    } catch (err: any) {
      setError(sanitizeErrorMessage(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card animate-fade-in">
        <div className="brand">
          <h1>◆ LUX</h1>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="off"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
                style={{ paddingRight: '2.75rem', width: '100%', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted, #888)',
                  lineHeight: 1,
                }}
              >
                {showPassword ? (
                  // Eye-off icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  // Eye icon
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button
            id="login-submit"
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Have an onboarding invite code?{' '}
          <a
            href="/onboard"
            style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
          >
            Redeem invite →
          </a>
        </div>
      </div>
    </div>
  )
}
