'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { FiBriefcase, FiUser, FiGlobe, FiCheckCircle, FiKey, FiAlertCircle, FiLock, FiArrowRight } from 'react-icons/fi'

function OnboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [inviteCode, setInviteCode] = useState('')
  const [validatingInvite, setValidatingInvite] = useState(false)
  const [inviteDetails, setInviteDetails] = useState<{
    valid: boolean
    code: string
    businessName?: string | null
    plan: string
  } | null>(null)
  const [inviteError, setInviteError] = useState('')

  const [form, setForm] = useState({
    name: '',
    slug: '',
    email: '',
    phone: '',
    ownerUsername: '',
    ownerEmail: '',
    ownerPassword: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Check URL query param for invite code on mount
  useEffect(() => {
    const codeParam = searchParams.get('code')
    if (codeParam) {
      setInviteCode(codeParam.toUpperCase().trim())
      validateCode(codeParam.toUpperCase().trim())
    }
  }, [searchParams])

  const validateCode = async (codeToValidate?: string) => {
    const targetCode = (codeToValidate || inviteCode).trim().toUpperCase()
    if (!targetCode || targetCode.length < 4) {
      setInviteDetails(null)
      setInviteError('Please enter a valid invitation key.')
      return
    }
    setValidatingInvite(true)
    setInviteError('')
    try {
      const res = await api.get<{
        valid: boolean
        code: string
        businessName?: string | null
        plan: string
      }>(`/enterprises/invites/validate/${encodeURIComponent(targetCode)}`)
      setInviteDetails(res)
      if (res.businessName && !form.name) {
        handleNameChange(res.businessName)
      }
      toast.success(`Invitation key verified (${res.plan} Tier)!`, { icon: '🔑' })
    } catch (err: any) {
      setInviteDetails(null)
      setInviteError(err.message || 'Invalid, expired, or already redeemed invitation key.')
    } finally {
      setValidatingInvite(false)
    }
  }

  // Auto-slugify when company name changes
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    setForm(f => ({ ...f, name, slug: f.slug === '' || f.slug === slug.slice(0, -1) ? slug : f.slug }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!inviteCode.trim() || !inviteDetails?.valid) {
      setError('Please provide and verify a valid one-time invite key to complete registration.')
      return
    }

    setLoading(true)
    try {
      const payload = {
        inviteCode:    inviteCode.trim().toUpperCase(),
        name:          form.name.trim(),
        slug:          form.slug.trim().toLowerCase(),
        email:         form.email.trim(),
        phone:         form.phone.trim() || undefined,
        ownerUsername: form.ownerUsername.trim(),
        ownerEmail:    form.ownerEmail.trim() || form.email.trim(),
        ownerPassword: form.ownerPassword,
      }

      const res = await api.post<{
        enterprise: { id: string; name: string; slug: string; plan?: string }
        channel: { id: string; name: string; code: string }
        user: { id: string; username: string; email: string; role: string; enterpriseId: string; channelId: string }
        accessToken: string
        refreshToken: string
      }>('/enterprises/onboard', payload)

      // Set user session in zustand store
      setAuth(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        {
          id: res.user.id,
          username: res.user.username,
          email: res.user.email,
          role: res.user.role,
          mfaEnabled: false,
          channelId: res.channel.id,
          channel: res.channel,
          enterpriseId: res.enterprise.id,
          enterprise: res.enterprise,
        }
      )

      toast.success(`Welcome, ${res.enterprise.name}! Enterprise created successfully.`, {
        icon: '🚀',
        duration: 5000,
      })

      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Failed to onboard enterprise. Please check your details.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container" style={{ minHeight: '100vh', padding: '40px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="login-card animate-fade-in" style={{ maxWidth: '580px', width: '100%' }}>
        <div className="brand" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--primary)' }}>◆ LUX</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            Enterprise Cloud Onboarding
          </p>
        </div>

        {/* ── STEP 1: LOCKED BEHIND INVITATION KEY ────────────────── */}
        {!inviteDetails?.valid ? (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(47, 122, 184, 0.15)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '1.5rem' }}>
                <FiLock />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Invitation Key Required</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6, maxWidth: 360, margin: '6px auto 0' }}>
                Registration is by invitation only. Enter your one-time onboarding key below to unlock your workspace setup.
              </p>
            </div>

            {inviteError && (
              <div className="login-error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FiAlertCircle /> {inviteError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                validateCode()
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className="form-group">
                <label htmlFor="invite-key-input">Onboarding Invitation Key</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="invite-key-input"
                    className="input"
                    type="text"
                    placeholder="e.g. INV-7A9B-4C2D"
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(e.target.value.toUpperCase())
                      setInviteError('')
                    }}
                    required
                    autoFocus
                    style={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: '1.1rem', textAlign: 'center', padding: '12px' }}
                  />
                  <FiKey style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={validatingInvite || !inviteCode.trim()}
                style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '1rem', fontWeight: 700 }}
              >
                {validatingInvite ? 'Verifying Key...' : 'Unlock Workspace Setup →'}
              </button>
            </form>

            <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Already registered?{' '}
              <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                Sign In →
              </Link>
            </div>
          </div>
        ) : (
          /* ── STEP 2: UNLOCKED ONBOARDING FORM ───────────────────── */
          <form onSubmit={handleSubmit} className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Verified Key Banner */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.1)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiCheckCircle style={{ color: 'var(--success)', fontSize: '1.1rem', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--success)' }}>
                    Key Verified: <code>{inviteDetails.code}</code>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {inviteDetails.plan} Tier Approved {inviteDetails.businessName ? `• ${inviteDetails.businessName}` : ''}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setInviteDetails(null)
                  setInviteCode('')
                }}
                style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--text-muted)' }}
              >
                Change Key
              </button>
            </div>

            {error && (
              <div className="login-error" style={{ marginBottom: '0.5rem' }}>
                {error}
              </div>
            )}

            {/* Section 1: Business Identity */}
            <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--primary)', fontWeight: 700, fontSize: '0.9rem' }}>
                <FiBriefcase />
                <span>Business Details</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group">
                  <label htmlFor="company-name" style={{ fontSize: '0.8rem' }}>Company / Business Name *</label>
                  <input
                    id="company-name"
                    className="input"
                    type="text"
                    placeholder="e.g. Apex Retailers Ltd"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="company-slug" style={{ fontSize: '0.8rem' }}>
                    Workspace Slug * <span style={{ color: 'var(--text-muted)' }}>(unique identifier)</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="company-slug"
                      className="input"
                      type="text"
                      placeholder="apex-retailers"
                      value={form.slug}
                      onChange={(e) => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      required
                      style={{ paddingLeft: '32px' }}
                    />
                    <FiGlobe style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label htmlFor="company-email" style={{ fontSize: '0.8rem' }}>Business Email *</label>
                    <input
                      id="company-email"
                      className="input"
                      type="email"
                      placeholder="contact@company.com"
                      value={form.email}
                      onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <PhoneInput
                      label="Business Phone"
                      value={form.phone}
                      onChange={(val) => setForm(f => ({ ...f, phone: val }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Manager Administrator Credentials */}
            <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--primary)', fontWeight: 700, fontSize: '0.9rem' }}>
                <FiUser />
                <span>Manager Administrator Credentials</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label htmlFor="owner-username" style={{ fontSize: '0.8rem' }}>Admin Username *</label>
                    <input
                      id="owner-username"
                      className="input"
                      type="text"
                      placeholder="manager_admin"
                      value={form.ownerUsername}
                      onChange={(e) => setForm(f => ({ ...f, ownerUsername: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="owner-email" style={{ fontSize: '0.8rem' }}>Admin Email (optional)</label>
                    <input
                      id="owner-email"
                      className="input"
                      type="email"
                      placeholder="admin@company.com"
                      value={form.ownerEmail}
                      onChange={(e) => setForm(f => ({ ...f, ownerEmail: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="owner-password" style={{ fontSize: '0.8rem' }}>Password * <span style={{ color: 'var(--text-muted)' }}>(min 8 characters)</span></label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="owner-password"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••••••"
                      value={form.ownerPassword}
                      onChange={(e) => setForm(f => ({ ...f, ownerPassword: e.target.value }))}
                      required
                      minLength={8}
                      style={{ paddingRight: '2.75rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Features Included List */}
            <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem', color: 'var(--text-secondary)', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FiCheckCircle style={{ color: 'var(--success)' }} /> Dedicated HQ Warehouse
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FiCheckCircle style={{ color: 'var(--success)' }} /> Zero Data Leaks Guarantee
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FiCheckCircle style={{ color: 'var(--success)' }} /> Isolated Multi-Tenant DB
              </span>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading || !form.name || !form.slug || !form.email || !form.ownerUsername || form.ownerPassword.length < 8}
              style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '1rem', fontWeight: 700 }}
            >
              {loading ? 'Provisioning Enterprise...' : '🚀 Redeem Key & Launch Workspace'}
            </button>

            <div style={{ marginTop: '0.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Already registered?{' '}
              <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                Sign In →
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function OnboardPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}>Loading onboarding...</div>}>
      <OnboardContent />
    </Suspense>
  )
}
