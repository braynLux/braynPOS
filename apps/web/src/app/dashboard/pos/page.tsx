'use client'
import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { usePOSStore } from '@/stores/pos.store'
import { useOfflineStore } from '@/stores/offline.store'
import { usePermission } from '@/hooks/usePermission'
import { ManagerPinModal } from '@/components/shared/ManagerPinModal'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { SerialSelectorModal } from '@/components/shared/SerialSelectorModal'
import { ReceiptModal } from '@/components/shared/ReceiptModal'
import { ScannerModal } from '@/components/shared/ScannerModal'
import { FiCamera } from 'react-icons/fi'
import { CatalogSyncService } from '@/lib/catalog-sync'
import { ConnectivityStatus } from '@/components/shared/ConnectivityStatus'

interface ItemResult {
  id: string
  name: string
  sku: string
  barcode: string | null
  retailPrice: number
  wholesalePrice: number
  minRetailPrice: number
  minWholesalePrice: number
  weightedAvgCost: number
  category?: { name: string }
  isSerialized: boolean
}

export default function POSPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const isOnline = useOfflineStore((s) => s.isOnline)
  const addOfflineSale = useOfflineStore((s) => s.addOfflineSale)
  const { role } = usePermission()

  const {
    cart, customerId, customerName, saleType, discountAmount, notes,
    addItem, removeItem, updateQuantity, updatePrice,
    setCustomer, setSaleType, clearCart,
    getSubtotal, getTotalDiscount, getTotal, getItemCount,
  } = usePOSStore()

  const [items, setItems] = useState<ItemResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [committing, setCommitting] = useState(false)
  // Mobile: 'items' | 'cart' | 'payment'
  const [mobileTab, setMobileTab] = useState<'items' | 'cart' | 'payment'>('items')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [amountTendered, setAmountTendered] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<{ id: string; name: string; phone?: string }[]>([])
  const [customerLoading, setCustomerLoading] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustForm, setNewCustForm] = useState({ name: '', phone: '', email: '' })
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [approvalTarget, setApprovalTarget] = useState<{ action: any; contextId: string; marginPercent?: number } | null>(null)
  const [approvalToken, setApprovalToken] = useState<string | null>(null)
  const [serialPickerItem, setSerialPickerItem] = useState<ItemResult | null>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<{ id: string; loyaltyPoints: number } | null>(null)
  const [activeSession, setActiveSession] = useState<{ id: string; status: 'OPEN' } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  // Session check is ONLY required for CASHIER role.
  // All other roles (MANAGER, ADMIN, SALES_PERSON, etc.) can use
  // the POS freely without opening a shift session.
  const requiresSession = role === 'CASHIER'

  useEffect(() => {
    if (!token || !requiresSession) {
      setSessionLoading(false)
      return
    }
    setSessionLoading(true)
    api.get<{ id: string; status: 'OPEN' } | null>('/sessions/active', token)
      .then(res => setActiveSession(res))
      .catch(err => {
        console.error('[POS Session Check Error]:', err)
        if ((err as any).status === 403) {
          toast.error('Session access restricted.', { id: 'security-block', icon: '🛡️' })
        }
      })
      .finally(() => setSessionLoading(false))
  }, [token, requiresSession])

  useEffect(() => {
    if (paymentMethod !== 'CREDIT' || !token || !customerSearch) {
      setCustomerResults([])
      return
    }
    setCustomerLoading(true)
    api.get<{ data: { id: string; name: string; phone?: string }[] }>(
      `/customers?search=${encodeURIComponent(customerSearch)}&limit=8`, token
    )
      .then(res => setCustomerResults(res.data ?? []))
      .catch(console.error)
      .finally(() => setCustomerLoading(false))
  }, [customerSearch, paymentMethod, token])

  useEffect(() => {
    if (paymentMethod !== 'CREDIT') {
      setCustomerSearch('')
      setCustomerResults([])
    }
  }, [paymentMethod])

  useEffect(() => {
    if (!token || !customerId) { setSelectedCustomerDetails(null); return }
    api.get<any>(`/customers/${customerId}`, token)
      .then(res => setSelectedCustomerDetails(res))
      .catch(console.error)
  }, [customerId, token])

// Inside POSPage component
  useEffect(() => {
    if (!token) return

    // Background sync catalog if online
    if (isOnline) {
      CatalogSyncService.sync(token).catch(console.error)
    }

    // FIX: guard against out-of-order responses — with no debounce, every
    // keystroke fires its own request, and a slower earlier request (e.g. a
    // broad single-letter query) can resolve after a later, narrower one and
    // silently overwrite the correct results with stale ones. `cancelled` is
    // set by the cleanup of the *next* effect run, so only the latest request
    // for the current searchQuery is allowed to update state.
    let cancelled = false

    if (isOnline) {
      // ── ONLINE SEARCH ──
      const query = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''
      api.get<{ data: ItemResult[] }>(`/items?limit=50${query}`, token)
        .then((res) => { if (!cancelled) setItems(res.data) })
        .catch(err => {
          if (cancelled) return
          console.error('[POS Item Search Error]:', err)
          if ((err as any).status === 403) {
            toast.error('Item search restricted to your channel.', { id: 'security-block', icon: '🛡️' })
          }
        })
    } else {
      // ── OFFLINE SEARCH ──
      CatalogSyncService.searchOffline(searchQuery)
        .then((res: any[]) => { if (!cancelled) setItems(res) })
        .catch(console.error)
    }

    return () => { cancelled = true }
  }, [token, searchQuery, isOnline])

  const handleBarcodeScan = (code: string) => {
    setSearchQuery(code)
    toast.success(`Scanned: ${code}`, { icon: '🔍' })
  }

  useEffect(() => { searchRef.current?.focus() }, [])

  const handleAddToCart = (item: ItemResult) => {
    if (item.isSerialized) { setSerialPickerItem(item); return }
    const price = saleType === 'WHOLESALE' ? item.wholesalePrice : item.retailPrice
    addItem({
      itemId: item.id, name: item.name, sku: item.sku,
      quantity: 1, unitPrice: Number(price),
      minRetailPrice: Number(item.minRetailPrice),
      minWholesalePrice: Number(item.minWholesalePrice),
      costPrice: Number(item.weightedAvgCost),
    })
    // On mobile, flash cart badge to confirm add
    if (window.innerWidth < 768) {
      const badge = document.getElementById('cart-count-badge')
      if (badge) {
        badge.classList.add('pos-badge-pop')
        setTimeout(() => badge.classList.remove('pos-badge-pop'), 300)
      }
    }
  }

  const handleSerialSelect = (serial: { id: string; serialNo: string }) => {
    if (!serialPickerItem) return
    const price = saleType === 'WHOLESALE' ? serialPickerItem.wholesalePrice : serialPickerItem.retailPrice
    addItem({
      itemId: serialPickerItem.id, name: serialPickerItem.name, sku: serialPickerItem.sku,
      serialId: serial.id, serialNo: serial.serialNo,
      quantity: 1, unitPrice: Number(price),
      minRetailPrice: Number(serialPickerItem.minRetailPrice),
      minWholesalePrice: Number(serialPickerItem.minWholesalePrice),
      costPrice: Number(serialPickerItem.weightedAvgCost),
    })
    setSerialPickerItem(null)
  }

  const handleCommitSale = async (tokenOverride?: string) => {
    if (cart.length === 0) return

    if (role === 'CASHIER' || role === 'PROMOTER' || role === 'SALES_PERSON') {
      const belowMin = cart.find(c => c.unitPrice < c.minRetailPrice)
      if (belowMin && !tokenOverride && !approvalToken) {
        setApprovalTarget({ action: 'price_below_min', contextId: belowMin.itemId })
        return
      }
    }

    if (paymentMethod === 'CREDIT' && !customerId) {
      toast.error('Credit sales require a customer. Please select a customer.')
      return
    }

    setCommitting(true)
    const effectiveSaleType = paymentMethod === 'CREDIT' ? 'CREDIT' : saleType
    const saleData = {
      channelId: user?.channelId || user?.channel?.id || '',
      saleType: effectiveSaleType,
      customerId: customerId || null,
      sessionId: activeSession?.id || null,
      items: cart.map((c) => ({
        itemId: c.itemId, serialId: c.serialId,
        quantity: c.quantity, unitPrice: c.unitPrice,
        discountAmount: c.discountAmount,
      })),
      payments: [{ method: paymentMethod, amount: getTotal() }],
      notes, discountAmount,
      approvalToken: tokenOverride || approvalToken,
      dueDate: dueDate || null,
    }

    try {
      if (isOnline) {
        const res = await api.post<{ id: string }>('/sales/commit', saleData, token!)
        setLastSaleId(res.id)
      } else {
        addOfflineSale(saleData)
      }
      clearCart()
      setMobileTab('items')
      setAmountTendered('')
      setApprovalToken(null)
      toast.success(isOnline ? 'Sale completed!' : 'Saved offline — will sync when reconnected')
    } catch (err: any) {
      if (err.statusCode === 403 && err.code === 'NEGATIVE_MARGIN_REQUIRED') {
        setApprovalTarget({ 
          action: 'negative_margin', 
          contextId: err.data.itemId,
          marginPercent: err.data.marginPercent 
        })
        toast.error(err.message, { id: 'margin-block', icon: '🛡️' })
      } else if (err.status === 403) {
        toast.error(err.message || 'Access Denied: You do not have permission to commit this sale.', { id: 'security-block', icon: '🛡️' })
      } else {
        toast.error(err.message || 'Sale failed')
      }
    } finally {
      setCommitting(false)
    }
  }

  const change = Number(amountTendered) - getTotal()
  const itemCount = getItemCount()
  const hasFloorViolation = cart.some(item =>
    item.unitPrice < (saleType === 'WHOLESALE' ? item.minWholesalePrice : item.minRetailPrice)
  )

  // ── Cart Panel (shared between desktop right column and mobile cart tab) ──
  // Call as CartPanel(), not <CartPanel />: as JSX it's a new component type every
  // render, so React remounts the subtree (and drops input focus) on each keystroke.
  const CartPanel = () => (
    <div className="pos-cart" id="pos-cart">
      <div className="pos-cart-header">
        <strong>Cart ({itemCount} item{itemCount !== 1 ? 's' : ''})</strong>
        {cart.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clearCart}>Clear</button>
        )}
      </div>

      <div className="pos-cart-items">
        {cart.length === 0 ? (
          <div className="pos-cart-empty">
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🛒</div>
            <div>Cart is empty</div>
            <div style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--text-muted)' }}>
              Tap items to add them
            </div>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.itemId + (item.serialId || '')} className="pos-cart-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name}
                  {item.serialNo && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6 }}>#{item.serialNo}</span>}
                </div>

                {/* Quantity stepper — large touch targets */}
                <div className="pos-qty-row">
                  <button
                    className="pos-qty-btn"
                    onClick={() => updateQuantity(item.itemId, item.quantity - 1, item.serialId)}
                    aria-label="Decrease quantity"
                  >−</button>
                  <span className="pos-qty-val">{item.quantity}</span>
                  <button
                    className="pos-qty-btn"
                    onClick={() => updateQuantity(item.itemId, item.quantity + 1, item.serialId)}
                    aria-label="Increase quantity"
                  >+</button>

                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 4px' }}>×</span>

                  {/* ── Audit Finding: Intelligent Visual Warnings ── */}
                  {(() => {
                    const cost = item.costPrice || 0
                    const margin = item.unitPrice - cost
                    const marginPct = (item.unitPrice > 0) ? (margin / item.unitPrice) * 100 : 0
                    
                    let statusClass = ''
                    let statusLabel = ''
                    if (margin < 0) {
                      statusClass = 'text-red-500 font-bold'
                      statusLabel = '🔥 LOSS'
                    } else if (marginPct < 5) {
                      statusClass = 'text-amber-500 font-semibold'
                      statusLabel = '⚠️ THIN'
                    }

                    return (
                      <div className="pos-price-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          className={`input pos-price-input ${statusClass} ${item.unitPrice < (saleType === 'WHOLESALE' ? item.minWholesalePrice : item.minRetailPrice) ? 'input-error' : ''}`}
                          value={item.unitPrice || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updatePrice(item.itemId, Number(e.target.value), item.serialId)}
                          style={{ fontWeight: statusLabel ? 700 : 400 }}
                          aria-label="Unit price"
                        />
                        {statusLabel && (
                          <span style={{ fontSize: '0.6rem', marginTop: 2, whiteSpace: 'nowrap' }} className={statusClass}>
                            {statusLabel} ({marginPct.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {item.unitPrice < (saleType === 'WHOLESALE' ? item.minWholesalePrice : item.minRetailPrice) && (
                  <div className="pos-floor-warning">
                    ⚠️ Below floor: {new Intl.NumberFormat('en-KE').format(
                      saleType === 'WHOLESALE' ? item.minWholesalePrice : item.minRetailPrice
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.95rem' }}>
                  {new Intl.NumberFormat('en-KE').format(item.quantity * item.unitPrice)}
                </div>
                <button
                  className="pos-remove-btn"
                  onClick={() => removeItem(item.itemId, item.serialId)}
                  aria-label={`Remove ${item.name}`}
                >✕</button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pos-cart-footer">
        <div className="pos-total-row">
          <span>Subtotal</span>
          <span>{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getSubtotal())}</span>
        </div>
        {getTotalDiscount() > 0 && (
          <div className="pos-total-row" style={{ color: 'var(--warning)' }}>
            <span>Discount</span>
            <span>-{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getTotalDiscount())}</span>
          </div>
        )}
        <div className="pos-total-row grand-total">
          <span>Total</span>
          <span>{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getTotal())}</span>
        </div>
        <button
          className="btn btn-success btn-lg pos-checkout-btn"
          onClick={() => setMobileTab('payment')}
          disabled={cart.length === 0 || (requiresSession && !activeSession)}
          id="pos-checkout"
        >
          💳 Checkout
        </button>
      </div>
    </div>
  )

  // ── Payment Panel ───────────────────────────────────────────────────
  // Call as PaymentPanel(), not <PaymentPanel />: same remount-on-keystroke pitfall as CartPanel.
  const PaymentPanel = () => (
    <div className="pos-payment-panel">
      <div className="pos-payment-header">
        <button className="btn btn-ghost btn-sm" onClick={() => setMobileTab('cart')}>
          ← Back
        </button>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Payment</h3>
        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>
          {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getTotal())}
        </div>
      </div>

      <div className="pos-payment-body">
        <div className="form-group">
          <label htmlFor="payment-method">Payment Method</label>
          <select id="payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="CASH">💵 Cash</option>
            <option value="MOBILE_MONEY">📱 Mobile Money</option>
            <option value="CARD">💳 Card</option>
            <option value="CREDIT">📋 Debt (Credit)</option>
            <option value="LOYALTY_POINTS">⭐ Loyalty Points</option>
          </select>
        </div>

        {customerId && (
          <div className="pos-loyalty-badge">
            ⭐ Available Points: <strong>{selectedCustomerDetails?.loyaltyPoints ?? 0}</strong>
          </div>
        )}

        {paymentMethod === 'CREDIT' && (
          <div className="pos-credit-panel">
            <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>
              Debtor <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            {!customerId ? (
              <>
                <input
                  className="input"
                  placeholder="Search customer by name or phone..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                />
                {customerLoading && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>Searching...</p>}
                {customerResults.length > 0 && (
                  <div className="pos-customer-list">
                    {customerResults.map(c => (
                      <div key={c.id}
                        className="pos-customer-row"
                        onClick={() => { setCustomer(c.id, c.name); setCustomerSearch(''); setCustomerResults([]) }}
                      >
                        <strong>{c.name}</strong>
                        {c.phone && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{c.phone}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {customerSearch && customerResults.length === 0 && !customerLoading && (
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>No customers found.</p>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowNewCustomer(true)}>+ Add New Customer</button>
                  </div>
                )}
                {showNewCustomer && (
                  <div className="pos-new-customer-form">
                    <strong style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>New Customer</strong>
                    <input className="input" placeholder="Name *" value={newCustForm.name}
                      onChange={e => setNewCustForm(f => ({ ...f, name: e.target.value }))} style={{ marginBottom: 8 }} />
                    <PhoneInput label="Phone *" value={newCustForm.phone}
                      onChange={val => setNewCustForm(f => ({ ...f, phone: val }))} />
                    <input className="input" placeholder="Email" value={newCustForm.email}
                      onChange={e => setNewCustForm(f => ({ ...f, email: e.target.value }))} style={{ marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowNewCustomer(false)}>Cancel</button>
                      <button className="btn btn-primary btn-sm" disabled={savingCustomer || !newCustForm.name}
                        onClick={async () => {
                          setSavingCustomer(true)
                          try {
                            const res = await api.post<{ id: string; name: string }>('/customers', newCustForm, token!)
                            setCustomer(res.id, res.name)
                            setShowNewCustomer(false)
                            setNewCustForm({ name: '', phone: '', email: '' })
                          } catch (e) { toast.error('Failed: ' + (e as Error).message) }
                          finally { setSavingCustomer(false) }
                        }}
                      >{savingCustomer ? 'Saving...' : 'Save Customer'}</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="pos-selected-customer">
                <div>
                  <div style={{ fontWeight: 600 }}>{customerName}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ Customer selected</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setCustomer('', '')} style={{ color: 'var(--danger)' }}>
                  Change
                </button>
              </div>
            )}
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Due Date</label>
              <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
        )}

        {paymentMethod === 'CASH' && (
          <div className="form-group">
            <label htmlFor="amount-tendered">Amount Tendered</label>
            <input
              id="amount-tendered"
              className="input pos-amount-input"
              type="number"
              inputMode="decimal"
              value={amountTendered}
              onChange={(e) => setAmountTendered(e.target.value)}
              placeholder="0.00"
            />
            {change > 0 && (
              <div className="pos-change-display">
                Change: {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(change)}
              </div>
            )}

            {/* Quick amount buttons */}
            <div className="pos-quick-amounts">
              {[500, 1000, 2000, 5000].map(amt => (
                <button key={amt} className="btn btn-ghost btn-sm pos-quick-btn"
                  onClick={() => setAmountTendered(String(amt))}>
                  {new Intl.NumberFormat('en-KE').format(amt)}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm pos-quick-btn"
                onClick={() => setAmountTendered(String(getTotal()))}>
                Exact
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pos-payment-footer">
        <button
          className="btn btn-success pos-complete-btn"
          onClick={() => handleCommitSale()}
          disabled={committing}
          id="pos-complete"
        >
          {committing ? '⏳ Processing...' : '✅ Complete Sale'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* ── POS Header ─────────────────────────────────────────────── */}
      <div className="pos-header">
        <div className="pos-header-left">
          <button onClick={() => router.push('/dashboard/sales')} className="pos-back-btn" aria-label="Back to menu">
            ←
          </button>
          <div>
            <div className="pos-header-title">POS Terminal</div>
            <div className="pos-sale-type-row">
              {(['RETAIL', 'WHOLESALE'] as const).map((type) => (
                <button
                  key={type}
                  className={`pos-type-btn ${saleType === type ? 'active' : ''}`}
                  onClick={() => setSaleType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="pos-header-badges">
          <ConnectivityStatus />
          {requiresSession && (activeSession ? (
            <span className="badge badge-success">● Session</span>
          ) : !sessionLoading && (
            <span className="badge badge-danger">⚠ No Session</span>
          ))}
          <span className="badge badge-info">{user?.channel?.code || 'HQ'}</span>
        </div>
      </div>

      {/* ── No Session Warning ─────────────────────────────────────── */}
      {requiresSession && !activeSession && !sessionLoading && (
        <div className="pos-no-session-banner">
          <div>
            <div style={{ fontWeight: 700 }}>🎫 No Active Session</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>Open a session before accepting payments</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/dashboard/sessions')}>
            Open Session
          </button>
        </div>
      )}

      {/* ── Desktop Layout ─────────────────────────────────────────── */}
      <div className="pos-desktop-layout">
        {/* Items panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
          <div className="card" style={{ padding: '12px 16px', position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={searchRef}
                className="input"
                style={{ fontSize: '1.1rem', paddingRight: '45px' }}
                placeholder="🔍 Scan barcode or search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button 
                type="button"
                className="btn btn-ghost" 
                style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', padding: '8px', borderRadius: '50%' }}
                onClick={() => setShowScanner(true)}
                title="Use Camera to Scan"
              >
                <FiCamera size={20} />
              </button>
            </div>
          </div>
          <div className="pos-items-grid">
            {items.map((item) => (
              <div key={item.id} className="pos-item-card" onClick={() => handleAddToCart(item)} id={`pos-item-${item.sku}`}>
                <div className="item-name">{item.name}</div>
                <div className="item-price">
                  {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(
                    Number(saleType === 'WHOLESALE' ? item.wholesalePrice : item.retailPrice)
                  )}
                </div>
                <div className="item-stock">{item.sku}</div>
                {item.isSerialized && <div style={{ fontSize: '0.65rem', color: 'var(--warning)', marginTop: 2 }}>Serialized</div>}
              </div>
            ))}
            {items.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {searchQuery ? 'No items found' : 'Loading items...'}
              </div>
            )}
          </div>
        </div>

        {/* Cart / Payment panel */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {mobileTab !== 'payment' ? CartPanel() : null}
          {mobileTab === 'payment' && PaymentPanel()}
        </div>
      </div>

      {/* ── Mobile Layout ──────────────────────────────────────────── */}
      <div className="pos-mobile-layout">
        {/* Items tab content */}
        {mobileTab === 'items' && (
          <div className="pos-mobile-items">
            <div style={{ padding: '0 12px 12px', position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <input
                  ref={searchRef}
                  className="input"
                  style={{ fontSize: '1rem', paddingRight: '45px' }}
                  placeholder="🔍 Scan barcode or search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button 
                  type="button"
                  className="btn btn-ghost"
                  style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)' }}
                  onClick={() => setShowScanner(true)}
                >
                  <FiCamera size={18} />
                </button>
              </div>
            </div>
            <div className="pos-items-grid-mobile">
              {items.map((item) => (
                <div key={item.id} className="pos-item-card-mobile" onClick={() => handleAddToCart(item)}>
                  <div className="item-name" style={{ fontSize: '0.875rem' }}>{item.name}</div>
                  <div className="item-price" style={{ fontSize: '1rem' }}>
                    {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(
                      Number(saleType === 'WHOLESALE' ? item.wholesalePrice : item.retailPrice)
                    )}
                  </div>
                  {item.isSerialized && <div style={{ fontSize: '0.65rem', color: 'var(--warning)' }}>Serialized</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cart tab content */}
        {mobileTab === 'cart' && (
          <div className="pos-mobile-cart">
            {CartPanel()}
          </div>
        )}

        {/* Payment tab content */}
        {mobileTab === 'payment' && (
          <div className="pos-mobile-payment">
            {PaymentPanel()}
          </div>
        )}

        {/* Mobile bottom tab bar */}
        <div className="pos-mobile-tabs">
          <button
            className={`pos-tab-btn ${mobileTab === 'items' ? 'active' : ''}`}
            onClick={() => setMobileTab('items')}
          >
            <span className="pos-tab-icon">🏪</span>
            <span className="pos-tab-label">Items</span>
          </button>
          <button
            className={`pos-tab-btn ${mobileTab === 'cart' ? 'active' : ''}`}
            onClick={() => setMobileTab('cart')}
          >
            <span className="pos-tab-icon">
              🛒
              {itemCount > 0 && (
                <span id="cart-count-badge" className="pos-cart-badge">{itemCount}</span>
              )}
            </span>
            <span className="pos-tab-label">Cart</span>
          </button>
          <button
            className={`pos-tab-btn ${mobileTab === 'payment' ? 'active' : ''}`}
            onClick={() => setMobileTab('payment')}
            disabled={cart.length === 0}
            style={{ opacity: cart.length === 0 ? 0.4 : 1 }}
          >
            <span className="pos-tab-icon">💳</span>
            <span className="pos-tab-label">Pay</span>
          </button>
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {approvalTarget && (
        <ManagerPinModal
          action={approvalTarget.action}
          contextId={approvalTarget.contextId}
          marginPercent={approvalTarget.marginPercent}
          onApproved={(tok) => { setApprovalToken(tok); setApprovalTarget(null); handleCommitSale(tok) }}
          onCancel={() => setApprovalTarget(null)}
        />
      )}

      {serialPickerItem && (
        <SerialSelectorModal
          isOpen={!!serialPickerItem}
          itemId={serialPickerItem.id}
          itemName={serialPickerItem.name}
          channelId={user?.channelId || ''}
          onClose={() => setSerialPickerItem(null)}
          onSelect={handleSerialSelect}
        />
      )}

      {lastSaleId && (
        <ReceiptModal saleId={lastSaleId} onClose={() => setLastSaleId(null)} />
      )}

      <ScannerModal 
        isOpen={showScanner} 
        onClose={() => setShowScanner(false)} 
        onScan={handleBarcodeScan} 
      />
    </>
  )
}
