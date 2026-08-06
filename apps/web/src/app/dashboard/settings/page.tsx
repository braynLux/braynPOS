'use client'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'react-hot-toast'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { OpeningStockAgreement } from '@/components/shared/OpeningStockAgreement'
import { SessionManager } from './SessionManager'
import { SyncConflictResolver } from './SyncConflictResolver'
import { BluetoothPrinter } from '@/lib/bluetooth-printer'

interface Customer { id: string; name: string; phone?: string; email?: string }

type Tab = 'profile' | 'security' | 'business' | 'branding' | 'catalog' | 'pos' | 'printers' | 'payroll' | 'receipt' | 'tax' | 'notifications' | 'advanced' | 'offline'

function GoogleConnectionStatus() {
  const token = useAuthStore((s) => s.accessToken)
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [googleEmail, setGoogleEmail] = useState('')

  useEffect(() => {
    // Check URL for google=success/error
    const params = new URLSearchParams(window.location.search)
    const googleResult = params.get('google')
    if (googleResult === 'success') {
      toast.success('Google Workspace connected successfully!')
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    } else if (googleResult === 'error') {
      const reason = params.get('reason') || 'Unknown error'
      toast.error(`Google connection failed: ${reason}`, { duration: 8000 })
      window.history.replaceState({}, '', window.location.pathname)
    }

    // Check connection status from API
    const checkStatus = async () => {
      try {
        const res = await api.get<{ connected: boolean; email?: string }>('/settings/google/status', token!)
        if (res.connected) {
          setStatus('connected')
          setGoogleEmail(res.email || '')
        } else {
          setStatus('disconnected')
        }
      } catch {
        setStatus('disconnected')
      }
    }
    if (token) checkStatus()
  }, [token])

  if (status === 'loading') return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Checking connection...</div>

  if (status === 'connected') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ padding: '10px 16px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--success)', fontWeight: 700 }}>✅ Connected</span>
          {googleEmail && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({googleEmail})</span>}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              const res = await api.get<{ url: string }>('/settings/google/auth', token!)
              if (res.url) window.location.href = res.url
            } catch { toast.error('Failed to reconnect') }
          }}
        >
          Reconnect
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          const res = await api.get<{ url: string }>('/settings/google/auth', token!)
          if (res.url) window.location.href = res.url
        } catch { toast.error('Failed to initiate Google connection') }
      }}
    >
      Connect Google Workspace
    </button>
  )
}


export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.accessToken)
  const [tab, setTab] = useState<Tab>('profile')
  const [saved, setSaved] = useState(false)

  // Profile
  const [profile, setProfile] = useState({ username: user?.username || '', email: user?.email || '' })

  // Password
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)

  // Business
  const [biz, setBiz] = useState({
    businessName: '', vatNumber: '', address: '', phone: '', email: '', currency: 'KES', timezone: 'Africa/Nairobi',
    businessSlogan: '',
  })

  // Branding & Social
  const [branding, setBranding] = useState({
    logo: '', tagline: '', primaryColor: '#0ea5e9',
    tiktokUrl: '', instagramUrl: '', facebookUrl: '', whatsappNumber: '',
    catalogPublic: true
  })

  // Printers
  const [printers, setPrinters] = useState<any[]>([])
  const [newPrinter, setNewPrinter] = useState({ name: '', model: '', type: 'THERMAL', connection: 'BLUETOOTH' })
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null)


  // Receipt
  const [receipt, setReceipt] = useState({
    receiptHeader: 'Thank you for shopping with us!', 
    receiptFooter: 'Goods once sold are not returnable.', 
    showLogo: true, 
    showBarcode: true,
    paperWidth: '80mm',
    fontSize: 'md',
    showBusinessName: true,
    showBusinessAddress: true,
    showBusinessPhone: true,
    showBusinessEmail: false,
    showVatNumber: true,
    showCashierName: true,
    showCustomerInfo: true,
    showPoweredBy: true,
  })

  // Tax
  const [tax, setTax] = useState({ vatEnabled: false, vatRate: 16, vatName: 'VAT', inclusivePricing: true })

  // Notifications  
  const [notif, setNotif] = useState({ lowStockAlert: true, salesSummaryDaily: false, payrollReminder: true, lowStockThreshold: 5 })

  // POS Config
  const [posConfig, setPosConfig] = useState({ autoPrintReceipt: true, enableCashDrawer: true, requireCustomerProfile: false, enforceStockLimits: true })
  
  // Payroll Config
  const [payroll, setPayroll] = useState({ 
    commissionsEnabled: true, 
    defaultRate: 12, 
    promoterDefaultRate: 15,
    wholesaleDefaultRate: 8,
    minMarginPercent: 0, 
    recalcOnDraft: true,
    payoutApprovalRequired: false 
  })

  // Advanced Config
  const [advanced, setAdvanced] = useState({ 
    autoBackup: true, 
    backupFrequency: 'daily', 
    dataRetentionMonths: 24, 
    enforceStrictRounding: true,
    globalOpeningStockActive: false,
    managerAgreedToOpeningStock: false
  })
  
  // Commission Rules
  const [rules, setRules] = useState<any[]>([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [editingRule, setEditingRule] = useState<any | null>(null)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [ruleFormData, setRuleFormData] = useState({
    name: '', role: '', ratePercent: 12, minMarginPercent: 0, isActive: true
  })

  // Deduction / Allowance Rules
  const [deductions, setDeductions] = useState<any[]>([])
  const [allowances, setAllowances] = useState<any[]>([])
  const [loadingPayrollRules, setLoadingPayrollRules] = useState(false)
  const [showDeductionModal, setShowDeductionModal] = useState(false)
  const [showAllowanceModal, setShowAllowanceModal] = useState(false)
  const [dedForm, setDedForm] = useState({ name: '', type: 'FIXED_AMOUNT', amount: 0, isPreTax: false })
  const [allForm, setAllForm] = useState({ name: '', type: 'FIXED_AMOUNT', amount: 0 })

  const isAdmin = ['SUPER_ADMIN', 'MANAGER_ADMIN'].includes(user?.role || '')
  const isManager = user?.role === 'MANAGER'

  useEffect(() => {
    if (!token || (!isAdmin && !isManager)) return
    const fetchSettings = async () => {
      try {
        const res = await api.get<Record<string, any>>('/dashboard/settings', token)
        if (res.bizSettings) setBiz(res.bizSettings)
        if (res.receiptSettings) setReceipt(res.receiptSettings)
        if (res.taxSettings) setTax(res.taxSettings)
        if (res.notifSettings) setNotif(res.notifSettings)
        if (res.posSettings) setPosConfig(res.posSettings)
        if (res.brandingSettings) setBranding(res.brandingSettings)
        if (res.printerSettings) setPrinters(res.printerSettings)
        if (isAdmin && res.payrollSettings) setPayroll(res.payrollSettings)
        if (isAdmin && res.advancedSettings) setAdvanced(res.advancedSettings)
        
        if (isAdmin) {
          setLoadingRules(true)
          setLoadingPayrollRules(true)
          const [rules, deds, alls] = await Promise.all([
            api.get<any[]>('/commission/rules', token),
            api.get<any[]>('/payroll/rules/deductions', token),
            api.get<any[]>('/payroll/rules/allowances', token)
          ])
          setRules(rules)
          setDeductions(deds)
          setAllowances(alls)
          setLoadingRules(false)
          setLoadingPayrollRules(false)
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    fetchSettings()
  }, [token, isAdmin, isManager])

  const testPrinter = async (p: any) => {
    setTestingPrinterId(p.id)
    try {
      if (p.connection === 'BLUETOOTH') {
        // Bluetooth MUST be tested locally in the browser
        await BluetoothPrinter.connect()
        toast.success(`Printer "${p.name}" is READY ✅`)
        return
      }

      const res = await api.post<{ status: string }>('/dashboard/settings/printers/test', { host: p.connection }, token!)
      if (res.status === 'online') toast.success(`Printer "${p.name}" is ONLINE ✅`)
      else toast.error(`Printer "${p.name}" is ${res.status.toUpperCase()} ❌`)
    } catch (e) {
      toast.error('Connection test failed')
    } finally {
      setTestingPrinterId(null)
    }
  }

  const save = async (key: string, val: unknown) => {
    try {
      if (key === 'profileSettings') {
        await api.patch('/users/me', val as object, token!)
      } else {
        await api.patch('/dashboard/settings', { [key]: val }, token!)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error(`Failed to save ${key}:`, err)
      alert(`Error saving ${key}. Please try again.`)
    }
  }

  const handlePwChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (pwForm.newPw !== pwForm.confirm) return setPwError('New passwords do not match')
    if (pwForm.newPw.length < 8) return setPwError('Password must be at least 8 characters')
    try {
      await api.patch('/users/me/password', { currentPassword: pwForm.current, newPassword: pwForm.newPw }, token!)
      setPwSuccess(true)
      setPwForm({ current: '', newPw: '', confirm: '' })
      setTimeout(() => setPwSuccess(false), 4000)
    } catch (err) { setPwError((err as Error).message) }
  }

  const handleRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingRule) {
        await api.patch(`/commission/rules/${editingRule.id}`, ruleFormData, token!)
      } else {
        await api.post('/commission/rules', ruleFormData, token!)
      }
      setShowRuleModal(false)
      setEditingRule(null)
      // Refresh
      const rRes = await api.get<any[]>('/commission/rules', token!)
      setRules(rRes)
    } catch (err) { alert('Failed to save rule') }
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this rule?')) return
    try {
      await api.delete(`/commission/rules/${id}`, token!)
      setRules(rules.map(r => r.id === id ? { ...r, isActive: false } : r))
    } catch (err: any) { 
      if (err.status === 403) {
        toast.error('Access Denied: HQ permissions required.', { icon: '🛡️' })
      } else {
        toast.error('Operation failed: ' + err.message)
      }
    }
  }

  const handleDedSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/payroll/rules/deductions', { ...dedForm, rate: dedForm.type.includes('PERCENT') ? dedForm.amount / 100 : undefined, isPreTaxDeduction: dedForm.isPreTax }, token!)
      setShowDeductionModal(false)
      const res = await api.get<any[]>('/payroll/rules/deductions', token!)
      setDeductions(res)
    } catch (err) { alert('Failed to save deduction') }
  }

  const handleAllSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/payroll/rules/allowances', allForm, token!)
      setShowAllowanceModal(false)
      const res = await api.get<any[]>('/payroll/rules/allowances', token!)
      setAllowances(res)
    } catch (err) { alert('Failed to save allowance') }
  }

  const deletePayrollRule = async (type: 'deduction' | 'allowance', id: string) => {
    if (!confirm(`Are you sure you want to remove this ${type}?`)) return
    try {
      await api.delete(`/payroll/rules/${type}s/${id}`, token!)
      if (type === 'deduction') setDeductions(deductions.filter(d => d.id !== id))
      else setAllowances(allowances.filter(a => a.id !== id))
    } catch (err) { alert('Failed to delete') }
  }

  const ALL_TABS: { key: Tab; icon: string; label: string }[] = [
    { key: 'profile', icon: '👤', label: 'Profile' },
    { key: 'security', icon: '🔐', label: 'Security' },
    { key: 'business', icon: '🏪', label: 'Business Info' },
    { key: 'pos', icon: '💻', label: 'Point of Sale' },
    { key: 'payroll', icon: '💰', label: 'Payroll & Commission' },
    { key: 'receipt', icon: '🧾', label: 'Receipt' },
    { key: 'tax', icon: '📋', label: 'Tax' },
    { key: 'notifications', icon: '🔔', label: 'Notifications' },
    { key: 'branding', icon: '🎨', label: 'Branding & Social' },
    { key: 'catalog', icon: '📖', label: 'Digital Catalog' },
    { key: 'printers', icon: '🖨️', label: 'Printers' },
    { key: 'offline', icon: '📶', label: 'Offline Data' },
    { key: 'advanced', icon: '⚙️', label: 'Advanced' },
  ]

  const tabs = isAdmin 
    ? ALL_TABS 
    : isManager 
      ? ALL_TABS.filter(t => t.key !== 'advanced')
      : ALL_TABS.filter(t => ['profile', 'security'].includes(t.key))

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>Settings</h1>
        {saved && <span className="badge badge-success">✅ Saved!</span>}
      </div>

      <div className="settings-grid">
        {/* Sidebar */}
        <div className="card settings-sidebar">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`settings-tab ${tab === t.key ? 'active' : ''}`}>
              <span style={{ fontSize: '1.2rem' }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {tab === 'profile' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>👤 My Profile</h3>
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="form-group">
                  <label>Username</label>
                  <input className="input" value={profile.username} onChange={e => setProfile({ ...profile, username: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input className="input" type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <input className="input" value={user?.role || ''} readOnly style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>Channel</label>
                  <input className="input" value={(user as unknown as { channel?: { name: string } })?.channel?.name || '—'} readOnly style={{ opacity: 0.6 }} />
                </div>
                <button className="btn btn-primary" style={{ width: 'fit-content' }} onClick={() => save('profileSettings', profile)}>Save Profile</button>

                <div style={{ marginTop: 24, padding: 20, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                  <h4 style={{ marginBottom: 12 }}>🔗 Linked Accounts</h4>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>Connect your Google workspace account to enable one-click direct exports to Google Sheets and Docs from any dashboard table.</p>
                  <GoogleConnectionStatus />
                </div>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 20 }}>🔑 Change Password</h3>
                {pwSuccess && <div style={{ color: 'var(--success)', marginBottom: 12, padding: '10px 14px', background: 'rgba(16,185,129,0.12)', borderRadius: 8 }}>✅ Password changed successfully!</div>}
                {pwError && <div style={{ color: 'var(--danger)', marginBottom: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', borderRadius: 8 }}>{pwError}</div>}
                <form onSubmit={handlePwChange} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="form-group">
                    <label>Current Password</label>
                    <input type="password" className="input" value={pwForm.current} onChange={e => setPwForm({ ...pwForm, current: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>New Password</label>
                    <input type="password" className="input" value={pwForm.newPw} onChange={e => setPwForm({ ...pwForm, newPw: e.target.value })} required minLength={8} />
                  </div>
                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input type="password" className="input" value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} required />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: 'fit-content' }}>Change Password</button>
                </form>
              </div>
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 8 }}>📱 Device Sessions</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: '0.9rem' }}>
                  Manage your active logins across different browsers and devices.
                </p>
                <SessionManager />
              </div>
            </div>
          )}

          {tab === 'business' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>🏪 Business Information</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Business Name</label>
                  <input className="input" value={biz.businessName} onChange={e => setBiz({ ...biz, businessName: e.target.value })} placeholder="e.g. LUX Enterprises Ltd" />
                </div>
                <div className="form-group">
                  <label>VAT / PIN Number</label>
                  <input className="input" value={biz.vatNumber} onChange={e => setBiz({ ...biz, vatNumber: e.target.value })} placeholder="P000123456A" />
                </div>
                <div className="form-group">
                  <PhoneInput 
                    label="Business Phone" 
                    value={biz.phone} 
                    onChange={val => setBiz({ ...biz, phone: val })} 
                  />
                </div>
                <div className="form-group">
                  <label>Business Email</label>
                  <input className="input" type="email" value={biz.email} onChange={e => setBiz({ ...biz, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select className="input" value={biz.currency} onChange={e => setBiz({ ...biz, currency: e.target.value })}>
                    <option value="KES">KES — Kenyan Shilling</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="UGX">UGX — Ugandan Shilling</option>
                    <option value="TZS">TZS — Tanzanian Shilling</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Timezone</label>
                  <select className="input" value={biz.timezone} onChange={e => setBiz({ ...biz, timezone: e.target.value })}>
                    <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
                    <option value="Africa/Lagos">Africa/Lagos (WAT)</option>
                    <option value="Africa/Johannesburg">Africa/Johannesburg (SAST)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Business Address</label>
                  <textarea className="input" rows={2} value={biz.address} onChange={e => setBiz({ ...biz, address: e.target.value })} placeholder="Physical address" style={{ resize: 'vertical' }} />
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => save('bizSettings', biz)}>Save Business Info</button>
            </div>
          )}

          {tab === 'receipt' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>🧾 Advanced Receipt Template</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
                {/* Left: Content Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Content Visibility</h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showBusinessName} onChange={e => setReceipt({ ...receipt, showBusinessName: e.target.checked })} /> Business Name</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showBusinessAddress} onChange={e => setReceipt({ ...receipt, showBusinessAddress: e.target.checked })} /> Address</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showBusinessPhone} onChange={e => setReceipt({ ...receipt, showBusinessPhone: e.target.checked })} /> Phone Number</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showBusinessEmail} onChange={e => setReceipt({ ...receipt, showBusinessEmail: e.target.checked })} /> Email Address</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showVatNumber} onChange={e => setReceipt({ ...receipt, showVatNumber: e.target.checked })} /> VAT / PIN Number</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showCashierName} onChange={e => setReceipt({ ...receipt, showCashierName: e.target.checked })} /> Cashier Name</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showCustomerInfo} onChange={e => setReceipt({ ...receipt, showCustomerInfo: e.target.checked })} /> Customer Details</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showBarcode} onChange={e => setReceipt({ ...receipt, showBarcode: e.target.checked })} /> Barcode/QR</label>
                    <label className="checkbox-label"><input type="checkbox" checked={receipt.showPoweredBy} onChange={e => setReceipt({ ...receipt, showPoweredBy: e.target.checked })} /> Powered by LUX</label>
                  </div>

                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12 }}>Custom Messages</h4>
                  <div className="form-group">
                    <label>Header Message (Top)</label>
                    <textarea className="input" rows={2} value={receipt.receiptHeader} onChange={e => setReceipt({ ...receipt, receiptHeader: e.target.value })} style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label>Footer Message (Bottom)</label>
                    <textarea className="input" rows={2} value={receipt.receiptFooter} onChange={e => setReceipt({ ...receipt, receiptFooter: e.target.value })} style={{ resize: 'vertical' }} />
                  </div>
                </div>

                {/* Right: Layout & Appearance */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Layout & Styling</h4>
                  
                  <div className="form-group">
                    <label>Target Paper Width</label>
                    <select className="input" value={receipt.paperWidth} onChange={e => setReceipt({ ...receipt, paperWidth: e.target.value })}>
                      <option value="58mm">58mm (Small Thermal)</option>
                      <option value="80mm">80mm (Standard Thermal)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Font Scaling</label>
                    <select className="input" value={receipt.fontSize} onChange={e => setReceipt({ ...receipt, fontSize: e.target.value })}>
                      <option value="sm">Small (Compact)</option>
                      <option value="md">Medium (Standard)</option>
                      <option value="lg">Large (Accessible)</option>
                    </select>
                  </div>
                </div>
              </div>

              <button className="btn btn-primary" style={{ marginTop: 32, width: 'fit-content' }} onClick={() => save('receiptSettings', receipt)}>
                Update Receipt Template
              </button>
            </div>
          )}

          {tab === 'tax' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>📋 Tax Configuration</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tax.vatEnabled} onChange={e => setTax({ ...tax, vatEnabled: e.target.checked })} />
                  <span><strong>Enable VAT / Tax</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>— apply tax to all sales</span></span>
                </label>
                {tax.vatEnabled && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div className="form-group">
                        <label>Tax Name</label>
                        <input className="input" value={tax.vatName} onChange={e => setTax({ ...tax, vatName: e.target.value })} placeholder="VAT" />
                      </div>
                      <div className="form-group">
                        <label>Tax Rate (%)</label>
                        <input type="number" className="input" min="0" max="100" value={tax.vatRate} onChange={e => setTax({ ...tax, vatRate: Number(e.target.value) })} />
                      </div>
                    </div>
                    <label style={{ display: 'flex', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={tax.inclusivePricing} onChange={e => setTax({ ...tax, inclusivePricing: e.target.checked })} />
                      Tax-inclusive pricing (prices already include tax)
                    </label>
                  </>
                )}
                <button className="btn btn-primary" style={{ width: 'fit-content' }} onClick={() => save('taxSettings', tax)}>Save Tax Settings</button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>🔔 Notification Preferences</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={notif.lowStockAlert} onChange={e => setNotif({ ...notif, lowStockAlert: e.target.checked })} />
                  <div><strong>Low Stock Alerts</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Get notified when items fall below reorder level</div></div>
                </label>
                {notif.lowStockAlert && (
                  <div className="form-group" style={{ marginLeft: 24 }}>
                    <label>Alert Threshold (units)</label>
                    <input type="number" className="input" min="1" style={{ maxWidth: 120 }} value={notif.lowStockThreshold} onChange={e => setNotif({ ...notif, lowStockThreshold: Number(e.target.value) })} />
                  </div>
                )}
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={notif.salesSummaryDaily} onChange={e => setNotif({ ...notif, salesSummaryDaily: e.target.checked })} />
                  <div><strong>Daily Sales Summary</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Receive end-of-day sales report</div></div>
                </label>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={notif.payrollReminder} onChange={e => setNotif({ ...notif, payrollReminder: e.target.checked })} />
                  <div><strong>Payroll Processing Reminder</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Alert at start of each month to process payroll</div></div>
                </label>
                <button className="btn btn-primary" style={{ width: 'fit-content', marginTop: 12 }} onClick={() => save('notifSettings', notif)}>Save Preferences</button>
              </div>
            </div>
          )}

          {tab === 'pos' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>💻 Point of Sale Configuration</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={posConfig.autoPrintReceipt} onChange={e => setPosConfig({ ...posConfig, autoPrintReceipt: e.target.checked })} />
                  <div><strong>Auto-print Receipts</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Automatically send print job after finalizing sale</div></div>
                </label>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={posConfig.enableCashDrawer} onChange={e => setPosConfig({ ...posConfig, enableCashDrawer: e.target.checked })} />
                  <div><strong>Trigger Cash Drawer</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Attempt to open cash drawer logic for Cash sales</div></div>
                </label>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={posConfig.requireCustomerProfile} onChange={e => setPosConfig({ ...posConfig, requireCustomerProfile: e.target.checked })} />
                  <div><strong>Enforce Customer Selection</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Require standard sales (non-credit) to have an attached customer profile</div></div>
                </label>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer', opacity: posConfig.enforceStockLimits ? 1 : 0.7 }}>
                  <input type="checkbox" checked={posConfig.enforceStockLimits} onChange={e => setPosConfig({ ...posConfig, enforceStockLimits: e.target.checked })} />
                  <div><strong>Enforce Stock Limits</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Block sales of items with zero or negative inventory balances</div></div>
                </label>
                <button className="btn btn-primary" style={{ width: 'fit-content', marginTop: 12 }} onClick={() => save('posSettings', posConfig)}>Save POS Config</button>
              </div>
            </div>
          )}

          {tab === 'payroll' && isAdmin && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>💰 Payroll & Commission Control</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ padding: 16, background: 'rgba(var(--accent-rgb), 0.05)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'center' }}>
                    <input type="checkbox" style={{ width: 20, height: 20 }} checked={payroll.commissionsEnabled} onChange={e => setPayroll({ ...payroll, commissionsEnabled: e.target.checked })} />
                    <div>
                      <strong style={{ fontSize: '1.05rem' }}>Enable Sales Commissions</strong>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>If disabled, the system will ONLY calculate base salaries and fixed allowances. Commissions (margins) will be completely skipped.</div>
                    </div>
                  </label>
                </div>

                {payroll.commissionsEnabled && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
                      <div className="form-group">
                        <label>Global Default Rate (%)</label>
                        <input type="number" className="input" value={payroll.defaultRate} onChange={e => setPayroll({ ...payroll, defaultRate: Number(e.target.value) })} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Standard sales.</span>
                      </div>
                      <div className="form-group">
                        <label>Wholesale Default (%)</label>
                        <input type="number" className="input" value={payroll.wholesaleDefaultRate} onChange={e => setPayroll({ ...payroll, wholesaleDefaultRate: Number(e.target.value) })} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Bulk/Wholesale sales.</span>
                      </div>
                      <div className="form-group">
                        <label>Promoter Default (%)</label>
                        <input type="number" className="input" value={payroll.promoterDefaultRate} onChange={e => setPayroll({ ...payroll, promoterDefaultRate: Number(e.target.value) })} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Promoter role global.</span>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Minimum Margin Threshold (%)</label>
                      <input type="number" className="input" value={payroll.minMarginPercent} onChange={e => setPayroll({ ...payroll, minMarginPercent: Number(e.target.value) })} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sales with gross margin below this will not earn commission.</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={payroll.recalcOnDraft} onChange={e => setPayroll({ ...payroll, recalcOnDraft: e.target.checked })} />
                        <div><strong>Auto-Recalculate on Draft Generation</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Trigger fresh commission scans whenever a new Salary Run is started.</div></div>
                      </label>
                      <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={payroll.payoutApprovalRequired} onChange={e => setPayroll({ ...payroll, payoutApprovalRequired: e.target.checked })} />
                        <div><strong>Require Manager Approval for Payouts</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Commissions stay in PENDING status until manually approved by HQ.</div></div>
                      </label>
                    </div>
                  </>
                )}

                <div style={{ marginTop: 10, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                    💡 <strong>Pro Tip:</strong> To change individual rates for specific staff members, use the table below to manage granular rules.
                </div>

                <div style={{ marginTop: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h4 style={{ margin: 0 }}>Specific Commission Rules</h4>
                    <button className="btn btn-primary btn-sm" onClick={() => { setRuleFormData({ name: '', role: '', ratePercent: 12, minMarginPercent: 0, isActive: true }); setEditingRule(null); setShowRuleModal(true); }}>+ Add Custom Rule</button>
                  </div>
                  
                  {loadingRules ? <div className="loading-spinner" /> : (
                    <div className="table-container">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Rule Name</th>
                            <th>Applied To</th>
                            <th>Rate</th>
                            <th>Min Margin</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rules.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>No custom rules found. Use global default.</td></tr>
                          )}
                          {rules.map(r => (
                            <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                              <td><strong>{r.name}</strong></td>
                              <td>{r.role ? <span className="badge badge-info">{r.role}</span> : <span className="badge">ANY</span>}</td>
                              <td>{r.ratePercent}%</td>
                              <td>{r.minMarginPercent > 0 ? `${r.minMarginPercent}%` : '—'}</td>
                              <td>{r.isActive ? <span style={{ color: 'var(--success)' }}>Active</span> : <span style={{ color: 'var(--danger)' }}>Inactive</span>}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditingRule(r); setRuleFormData({ name: r.name, role: r.role || '', ratePercent: r.ratePercent, minMarginPercent: r.minMarginPercent || 0, isActive: r.isActive }); setShowRuleModal(true); }}>Edit</button>
                                  {r.isActive && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteRule(r.id)}>Deactivate</button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                   <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <h4 style={{ margin: 0 }}>Statutory Deductions</h4>
                        <button className="btn btn-ghost btn-xs" onClick={() => setShowDeductionModal(true)}>+ Add</button>
                      </div>
                      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="table table-sm">
                          <thead><tr><th>Name</th><th>Value</th><th></th></tr></thead>
                          <tbody>
                            {deductions.map(d => (
                              <tr key={d.id}>
                                <td>{d.name} {d.isPreTaxDeduction && <span title="Tax-Exempt" style={{ cursor: 'help' }}>🛡️</span>}</td>
                                <td>{d.rate ? `${d.rate * 100}%` : d.minimumFloorAmount ? 'Bracket' : 'Fixed'}</td>
                                <td style={{ textAlign: 'right' }}><button onClick={() => deletePayrollRule('deduction', d.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                   </div>

                   <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <h4 style={{ margin: 0 }}>Standard Allowances</h4>
                        <button className="btn btn-ghost btn-xs" onClick={() => setShowAllowanceModal(true)}>+ Add</button>
                      </div>
                      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="table table-sm">
                          <thead><tr><th>Name</th><th>Amount</th><th></th></tr></thead>
                          <tbody>
                            {allowances.map(a => (
                              <tr key={a.id}>
                                <td>{a.name}</td>
                                <td>{new Intl.NumberFormat().format(a.amount)}</td>
                                <td style={{ textAlign: 'right' }}><button onClick={() => deletePayrollRule('allowance', a.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                   </div>
                </div>

                <button className="btn btn-primary" style={{ width: 'fit-content', marginTop: 20 }} onClick={() => save('payrollSettings', payroll)}>Save Global Payroll Settings</button>
              </div>
            </div>
          )}

          {tab === 'branding' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>🤝 Partner Integrations & Branding</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Business Logo</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 10 }}>
                    <div style={{ width: 100, height: 100, borderRadius: 12, border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                      {branding.logo ? <img src={branding.logo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '2rem' }}>🏢</span>}
                    </div>
                    <div>
                      <input type="file" accept="image/*" onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const reader = new FileReader()
                          reader.onloadend = () => setBranding({ ...branding, logo: reader.result as string })
                          reader.readAsDataURL(file)
                        }
                      }} style={{ display: 'none' }} id="logo-upload" />
                      <label htmlFor="logo-upload" className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>Upload New Logo</label>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>Recommended: Square PNG/SVG with transparent background.</p>
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Tagline / Slogan</label>
                  <input className="input" value={branding.tagline} onChange={e => setBranding({ ...branding, tagline: e.target.value })} placeholder="e.g. Quality you can trust" />
                </div>

                <div className="form-group">
                  <label>TikTok Profile URL</label>
                  <input className="input" value={branding.tiktokUrl} onChange={e => setBranding({ ...branding, tiktokUrl: e.target.value })} placeholder="https://tiktok.com/@yourshop" />
                </div>
                <div className="form-group">
                  <label>Instagram Handle</label>
                  <input className="input" value={branding.instagramUrl} onChange={e => setBranding({ ...branding, instagramUrl: e.target.value })} placeholder="https://instagram.com/yourshop" />
                </div>
                <div className="form-group">
                  <label>Facebook Page URL</label>
                  <input className="input" value={branding.facebookUrl} onChange={e => setBranding({ ...branding, facebookUrl: e.target.value })} placeholder="https://facebook.com/yourshop" />
                </div>
                <div className="form-group">
                   <label>WhatsApp Business No.</label>
                   <PhoneInput value={branding.whatsappNumber} onChange={val => setBranding({ ...branding, whatsappNumber: val })} />
                </div>
                <div className="form-group">
                  <label>Primary Brand Color</label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input type="color" value={branding.primaryColor} onChange={e => setBranding({ ...branding, primaryColor: e.target.value })} style={{ width: 40, height: 40, padding: 0, border: 'none', background: 'none' }} />
                    <code style={{ flex: 1 }}>{branding.primaryColor}</code>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => save('brandingSettings', branding)}>Save Branding</button>
            </div>
          )}

          {tab === 'offline' && (isAdmin || isManager) && (
            <SyncConflictResolver />
          )}

          {tab === 'catalog' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 12 }}>📖 Digital Catalog Management</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
                Your digital catalog is a live link your customers can visit to browse products and order via WhatsApp.
              </p>

              <div style={{ padding: 20, background: 'rgba(var(--accent-rgb), 0.05)', borderRadius: 12, border: '1px solid var(--accent)', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--accent)' }}>Live Catalog Link</h4>
                    <code style={{ fontSize: '1rem', display: 'block', marginTop: 4 }}>{typeof window !== 'undefined' ? window.location.origin : ''}/catalog/{biz.businessName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'your-shop'}</code>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    const slug = biz.businessName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'your-shop'
                    navigator.clipboard.writeText(`${window.location.origin}/catalog/${slug}`)
                    toast.success('Link copied!')
                  }}>📋 Copy Link</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={branding.catalogPublic} onChange={e => setBranding({ ...branding, catalogPublic: e.target.checked })} />
                  <div><strong>Enable Public Catalog</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Make your products visible to anyone with the link</div></div>
                </label>
                <div className="alert alert-info">
                  💡 <strong>Catalog Sync:</strong> All items with a valid <strong>image</strong> and <strong>price</strong> are automatically synced to your digital catalog every 10 minutes.
                </div>
                <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => save('brandingSettings', branding)}>Save Catalog Settings</button>
              </div>
            </div>
          )}

          {tab === 'printers' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>🖨️ Printer Profiles</h3>
              <div style={{ marginBottom: 24, padding: 20, border: '1px solid var(--border)', borderRadius: 12 }}>
                 <h4 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Add New Printer</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div className="form-group">
                      <label>Printer Name</label>
                      <input className="input" placeholder="e.g. Front Desk" value={newPrinter.name} onChange={e => setNewPrinter({...newPrinter, name: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Model / Brand</label>
                      <select className="input" value={newPrinter.model} onChange={e => setNewPrinter({...newPrinter, model: e.target.value})}>
                        <option value="">Select Model</option>
                        <option value="EPSON_TM_T88">Epson TM-T88</option>
                        <option value="EPSON_TM_T20">Epson TM-T20</option>
                        <option value="STAR_TSP100">Star TSP100</option>
                        <option value="GENERIC_ESC_POS">Generic ESC/POS</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Connection</label>
                      <select className="input" value={newPrinter.connection} onChange={e => setNewPrinter({...newPrinter, connection: e.target.value})}>
                        <option value="BLUETOOTH">Bluetooth (Wireless)</option>
                        <option value="USB">USB (Cable)</option>
                        <option value="IP">Network (IP/Ethernet)</option>
                      </select>
                    </div>
                 </div>
                 <button className="btn btn-primary btn-sm" onClick={async () => {
                   if (!newPrinter.name) return
                   
                   try {
                     if (newPrinter.connection === 'BLUETOOTH') {
                       // Trigger browser device picker
                       await BluetoothPrinter.connect()
                     }
                     
                     const list = [...printers, { ...newPrinter, id: Math.random().toString(36).substr(2, 9) }]
                     setPrinters(list)
                     setNewPrinter({ name: '', model: '', type: 'THERMAL', connection: 'BLUETOOTH' })
                     save('printerSettings', list)
                     if (newPrinter.connection === 'BLUETOOTH') {
                       toast.success('Bluetooth printer paired successfully!')
                     }
                   } catch (err) {
                     if (newPrinter.connection === 'BLUETOOTH') {
                       toast.error('Bluetooth pairing cancelled or failed')
                     }
                   }
                 }}>Add Printer</button>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr><th>Name</th><th>Model</th><th>Connection</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {printers.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td>{p.model}</td>
                        <td><code>{p.connection}</code></td>
                        <td><span className="badge badge-success">READY</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-secondary btn-xs" disabled={testingPrinterId === p.id} onClick={() => testPrinter(p)}>
                              {testingPrinterId === p.id ? '⌛ Testing...' : '⚡ Test'}
                            </button>
                            <button className="btn btn-ghost btn-xs text-danger" onClick={() => {
                              const list = printers.filter(item => item.id !== p.id)
                              setPrinters(list)
                              save('printerSettings', list)
                            }}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {printers.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No printers configured.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'advanced' && (
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 20 }}>⚙️ Advanced Configuration</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={advanced.autoBackup} onChange={e => setAdvanced({ ...advanced, autoBackup: e.target.checked })} />
                  <div><strong>Automated Remote Backups</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Replicate DB locally to LUX cloud snapshot containers</div></div>
                </label>
                {advanced.autoBackup && (
                  <div className="form-group" style={{ marginLeft: 24 }}>
                    <label>Backup Frequency</label>
                    <select className="input" style={{ maxWidth: 200 }} value={advanced.backupFrequency} onChange={e => setAdvanced({ ...advanced, backupFrequency: e.target.value })}>
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label>Data Retention Policy (Months)</label>
                  <input type="number" className="input" style={{ maxWidth: 120 }} value={advanced.dataRetentionMonths} onChange={e => setAdvanced({ ...advanced, dataRetentionMonths: Number(e.target.value) })} min={6} max={120} />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Automatically archive sales history older than specified limits</span>
                </div>
                <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={advanced.enforceStrictRounding} onChange={e => setAdvanced({ ...advanced, enforceStrictRounding: e.target.checked })} />
                  <div><strong>Strict Accounting Rounding</strong><div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Enforce 4 decimal precision on all margins, COGS, and LPO values internally</div></div>
                </label>
                <div style={{ padding: 16, background: 'rgba(var(--accent-rgb), 0.1)', border: '1px solid var(--accent)', borderRadius: 8 }}>
                  <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={advanced.globalOpeningStockActive} onChange={e => setAdvanced({ ...advanced, globalOpeningStockActive: e.target.checked })} />
                    <div>
                      <strong style={{ color: 'var(--accent)' }}>Global Opening Stock Window</strong>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Master switch to allow managers to input initial stock without financial impact. 
                        <strong> Warning: Should only be active during initial setup days.</strong>
                      </div>
                    </div>
                  </label>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-elevated)', borderLeft: '3px solid var(--danger)', marginTop: 16 }}>
                  <h4 style={{ color: 'var(--danger)', margin: '0 0 10px 0' }}>Danger Zone</h4>
                  <p style={{ fontSize: '0.85rem', margin: '0 0 12px 0' }}>Once you disable or delete core channel functionality, you cannot revert it without system administrative access.</p>
                  <button className="btn btn-ghost" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>Purge Analytics Cache</button>
                </div>
                <button className="btn btn-primary" style={{ width: 'fit-content', marginTop: 12 }} onClick={() => save('advancedSettings', advanced)}>Save Configuration</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modals Root-Level Rendering */}
      {showDeductionModal && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content" style={{ width: 400 }}>
            <div className="modal-header"><h3>Add Deduction</h3><button onClick={() => setShowDeductionModal(false)}>✕</button></div>
            <form onSubmit={handleDedSubmit} style={{ display: 'contents' }}>
              <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
                <div className="form-group"><label>Name</label><input required className="input" value={dedForm.name} onChange={e => setDedForm({ ...dedForm, name: e.target.value })} placeholder="e.g. NHIF" /></div>
                <div className="form-group"><label>Type</label>
                  <select className="input" value={dedForm.type} onChange={e => setDedForm({ ...dedForm, type: e.target.value })}>
                    <option value="FIXED_AMOUNT">Fixed Amount</option>
                    <option value="PERCENTAGE_OF_GROSS">Percentage of Gross</option>
                  </select>
                </div>
                <div className="form-group"><label>Value ({dedForm.type === 'FIXED_AMOUNT' ? 'Amount' : '%'})</label><input type="number" required className="input" value={dedForm.amount} onChange={e => setDedForm({ ...dedForm, amount: Number(e.target.value) })} /></div>
                <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={dedForm.isPreTax} onChange={e => setDedForm({ ...dedForm, isPreTax: e.target.checked })} /> Pre-Tax Deduction (reduces taxable income)</label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowDeductionModal(false)}>Cancel</button>
                <button className="btn btn-primary">Add Deduction</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAllowanceModal && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content" style={{ width: 400 }}>
            <div className="modal-header"><h3>Add Allowance</h3><button onClick={() => setShowAllowanceModal(false)}>✕</button></div>
            <form onSubmit={handleAllSubmit} style={{ display: 'contents' }}>
              <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
                <div className="form-group"><label>Allowance Name</label><input required className="input" value={allForm.name} onChange={e => setAllForm({ ...allForm, name: e.target.value })} placeholder="e.g. House Allowance" /></div>
                <div className="form-group"><label>Monthly Amount</label><input type="number" required className="input" value={allForm.amount} onChange={e => setAllForm({ ...allForm, amount: Number(e.target.value) })} /></div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAllowanceModal(false)}>Cancel</button>
                <button className="btn btn-primary">Add Allowance</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRuleModal && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-content" style={{ width: 'min(500px, 95vw)', marginTop: '40px' }}>
            <div className="modal-header">
              <h3>{editingRule ? 'Edit Rule' : 'New Commission Rule'}</h3>
              <button className="btn btn-ghost" onClick={() => setShowRuleModal(false)}>✕</button>
            </div>
            <form onSubmit={handleRuleSubmit} style={{ display: 'contents' }}>
              <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
                <div className="form-group">
                  <label>Rule Name (Internal Title)</label>
                  <input className="input" required value={ruleFormData.name} onChange={e => setRuleFormData({ ...ruleFormData, name: e.target.value })} placeholder="e.g. Salesperson Bonus Tier 1" />
                </div>
                <div className="form-group">
                  <label>Apply to Role (Optional)</label>
                  <select className="input" value={ruleFormData.role} onChange={e => setRuleFormData({ ...ruleFormData, role: e.target.value })}>
                    <option value="">Any Role</option>
                    <option value="CASHIER">CASHIER</option>
                    <option value="SALES_PERSON">SALES PERSON</option>
                    <option value="PROMOTER">PROMOTER</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Commission Rate (%)</label>
                  <input type="number" className="input" required min="0" max="100" value={ruleFormData.ratePercent} onChange={e => setRuleFormData({ ...ruleFormData, ratePercent: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Minimum Required Margin (%)</label>
                  <input type="number" className="input" min="0" max="100" value={ruleFormData.minMarginPercent} onChange={e => setRuleFormData({ ...ruleFormData, minMarginPercent: Number(e.target.value) })} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Staff earn $0 commission if sale margin is below this.</span>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowRuleModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
