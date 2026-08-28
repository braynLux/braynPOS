'use client'
import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { usePOSStore, POSPayment, PaymentMethodType } from '@/stores/pos.store'
import { useOfflineStore } from '@/stores/offline.store'
import { usePermission } from '@/hooks/usePermission'
import { ManagerPinModal } from '@/components/shared/ManagerPinModal'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { SerialSelectorModal } from '@/components/shared/SerialSelectorModal'
import { ReceiptModal } from '@/components/shared/ReceiptModal'
import { ScannerModal } from '@/components/shared/ScannerModal'
import { FiCamera, FiUser, FiPlus, FiTrash2, FiCheckCircle, FiAlertCircle } from 'react-icons/fi'
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
  availableQty?: number
  reorderLevel?: number
}

interface StaffUser {
  id: string
  username: string
  role: string
}

export default function POSPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const isOnline = useOfflineStore((s) => s.isOnline)
  const addOfflineSale = useOfflineStore((s) => s.addOfflineSale)
  const { role } = usePermission()

  const {
    cart, customerId, customerName, promoterId, promoterName, saleType, discountAmount, notes,
    addItem, removeItem, updateQuantity, updatePrice,
    setCustomer, setPromoter, setSaleType, clearCart,
    getSubtotal, getTotalDiscount, getTotal, getItemCount,
  } = usePOSStore()

  const [items, setItems] = useState<ItemResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [committing, setCommitting] = useState(false)
  const [mobileTab, setMobileTab] = useState<'items' | 'cart' | 'payment'>('items')

  // Payment State
  const [isSplitPayment, setIsSplitPayment] = useState(false)
  const [singleMethod, setSingleMethod] = useState<PaymentMethodType>('CASH')
  const [singleRef, setSingleRef] = useState('')
  const [amountTendered, setAmountTendered] = useState('')
  const [splitPayments, setSplitPayments] = useState<POSPayment[]>([
    { method: 'CASH', amount: 0, reference: '' },
  ])

  // Customer State
  const searchRef = useRef<HTMLInputElement>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<{ id: string; name: string; phone?: string; loyaltyPoints?: number; tier?: string; outstandingCredit?: number }[]>([])
  const [customerLoading, setCustomerLoading] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustForm, setNewCustForm] = useState({ name: '', phone: '', email: '' })
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<{ id: string; name: string; phone?: string; loyaltyPoints: number; tier: string; outstandingCredit: number } | null>(null)

  // Promoters / Staff list
  const [staffList, setStaffList] = useState<StaffUser[]>([])

  // Approvals & Modals
  const [dueDate, setDueDate] = useState('')
  const [approvalTarget, setApprovalTarget] = useState<{ action: any; contextId: string; marginPercent?: number } | null>(null)
  const [approvalToken, setApprovalToken] = useState<string | null>(null)
  const [serialPickerItem, setSerialPickerItem] = useState<ItemResult | null>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [activeSession, setActiveSession] = useState<{ id: string; status: 'OPEN' } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  const requiresSession = role === 'CASHIER'
  const total = getTotal()

  // ── Session Check ──────────────────────────────────────────────────
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

  // ── Load Staff / Promoters for attribution ─────────────────────────
  useEffect(() => {
    if (!token) return
    api.get<{ data: StaffUser[] }>('/users?limit=50', token)
      .then(res => setStaffList(res.data ?? []))
      .catch(console.error)
  }, [token])

  // ── Inline Customer Search ──────────────────────────────────────────
  useEffect(() => {
    if (!token || !customerSearch.trim()) {
      setCustomerResults([])
      return
    }
    setCustomerLoading(true)
    const timeout = setTimeout(() => {
      api.get<{ data: any[] }>(
        `/customers?search=${encodeURIComponent(customerSearch)}&limit=6`, token
      )
        .then(res => setCustomerResults(res.data ?? []))
        .catch(console.error)
        .finally(() => setCustomerLoading(false))
    }, 250)

    return () => clearTimeout(timeout)
  }, [customerSearch, token])

  // ── Load full details of selected customer ──────────────────────────
  useEffect(() => {
    if (!token || !customerId) {
      setSelectedCustomerDetails(null)
      return
    }
    api.get<any>(`/customers/${customerId}`, token)
      .then(res => setSelectedCustomerDetails(res))
      .catch(console.error)
  }, [customerId, token])

  // ── Catalog / Item Search ───────────────────────────────────────────
  useEffect(() => {
    if (!token) return

    if (isOnline) {
      CatalogSyncService.sync(token).catch(console.error)
      const query = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''
      api.get<{ data: ItemResult[] }>(`/items?limit=50${query}`, token)
        .then((res) => setItems(res.data))
        .catch(err => {
          console.error('[POS Item Search Error]:', err)
          if ((err as any).status === 403) {
            toast.error('Item search restricted to your channel.', { id: 'security-block', icon: '🛡️' })
          }
        })
    } else {
      CatalogSyncService.searchOffline(searchQuery)
        .then((res: any[]) => setItems(res))
        .catch(console.error)
    }
  }, [token, searchQuery, isOnline])

  // Reset split payments when entering checkout
  useEffect(() => {
    if (mobileTab === 'payment') {
      setAmountTendered(String(total))
      setSplitPayments([
        { method: singleMethod, amount: total, reference: singleRef },
      ])
    }
  }, [mobileTab, total, singleMethod, singleRef])

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
      quantity: 1, unitPrice: Number(price), originalPrice: Number(price),
      minRetailPrice: Number(item.minRetailPrice),
      minWholesalePrice: Number(item.minWholesalePrice || item.minRetailPrice),
      costPrice: Number(item.weightedAvgCost),
      inStock: Number(item.availableQty || 0),
      reorderLevel: Number(item.reorderLevel || 0),
    })
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
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
      quantity: 1, unitPrice: Number(price), originalPrice: Number(price),
      minRetailPrice: Number(serialPickerItem.minRetailPrice),
      minWholesalePrice: Number(serialPickerItem.minWholesalePrice || serialPickerItem.minRetailPrice),
      costPrice: Number(serialPickerItem.weightedAvgCost),
      inStock: 1,
      reorderLevel: Number(serialPickerItem.reorderLevel || 0),
    })
    setSerialPickerItem(null)
  }

  // ── Split Payment Calculations ─────────────────────────────────────
  const totalAllocated = isSplitPayment
    ? splitPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
    : (singleMethod === 'CASH' ? Number(amountTendered) || total : total)

  const remainingBalance = total - totalAllocated
  const change = singleMethod === 'CASH' && !isSplitPayment
    ? Math.max(0, Number(amountTendered) - total)
    : 0

  const handleAddSplitRow = () => {
    const currentSum = splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const diff = Math.max(0, total - currentSum)
    setSplitPayments([...splitPayments, { method: 'MOBILE_MONEY', amount: diff, reference: '' }])
  }

  const handleRemoveSplitRow = (idx: number) => {
    if (splitPayments.length <= 1) return
    setSplitPayments(splitPayments.filter((_, i) => i !== idx))
  }

  const handleUpdateSplitRow = (idx: number, patch: Partial<POSPayment>) => {
    setSplitPayments(splitPayments.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }

  // ── Commit Sale ────────────────────────────────────────────────────
  const handleCommitSale = async (tokenOverride?: string) => {
    if (cart.length === 0) return

    const belowMin = cart.find(c => c.unitPrice < (saleType === 'WHOLESALE' ? (c.minWholesalePrice || c.minRetailPrice) : c.minRetailPrice))
    if (belowMin && !tokenOverride && !approvalToken) {
      toast.error('Cannot checkout: Price below minimum allowed.')
      return
    }

    if (role === 'CASHIER' || role === 'PROMOTER' || role === 'SALES_PERSON') {
      const belowOrig = cart.find(c => c.unitPrice < c.originalPrice)
      if (belowOrig && !tokenOverride && !approvalToken) {
        setApprovalTarget({ action: 'price_below_min', contextId: belowOrig.itemId })
        return
      }
    }

    // Build finalized payments array
    let finalPayments: { method: PaymentMethodType; amount: number; reference?: string }[] = []

    if (isSplitPayment) {
      const totalSplit = splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
      if (Math.abs(totalSplit - total) > 0.01) {
        toast.error(`Allocated payments (KES ${totalSplit.toFixed(2)}) must exactly match sale total (KES ${total.toFixed(2)})`)
        return
      }
      finalPayments = splitPayments.map(p => ({
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference?.trim() || undefined,
      }))
    } else {
      finalPayments = [{
        method: singleMethod,
        amount: total,
        reference: singleRef.trim() || undefined,
      }]
    }

    // Check credit requirement
    const hasCredit = finalPayments.some(p => p.method === 'CREDIT')
    if (hasCredit && !customerId) {
      toast.error('Debt / Credit payments require a customer to be selected.')
      return
    }

    // Check loyalty points
    const loyaltyPmt = finalPayments.find(p => p.method === 'LOYALTY_POINTS')
    if (loyaltyPmt) {
      if (!customerId) {
        toast.error('Loyalty redemption requires selecting a customer.')
        return
      }
      const avail = selectedCustomerDetails?.loyaltyPoints ?? 0
      if (avail < loyaltyPmt.amount) {
        toast.error(`Customer only has ${avail} loyalty points available.`)
        return
      }
    }

    setCommitting(true)
    const effectiveSaleType = hasCredit ? 'CREDIT' : saleType
    const saleData = {
      channelId: user?.channelId || user?.channel?.id || '',
      saleType: effectiveSaleType,
      customerId: customerId || null,
      promoterId: promoterId || null,
      sessionId: activeSession?.id || null,
      items: cart.map((c) => ({
        itemId: c.itemId, serialId: c.serialId,
        quantity: c.quantity, unitPrice: c.unitPrice,
        discountAmount: c.discountAmount,
      })),
      payments: finalPayments,
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
      setIsSplitPayment(false)
      setSingleRef('')
      toast.success(isOnline ? 'Sale completed successfully!' : 'Saved offline — will sync when reconnected')
    } catch (err: any) {
      if (err.statusCode === 403 && err.code === 'NEGATIVE_MARGIN_REQUIRED') {
        setApprovalTarget({
          action: 'negative_margin',
          contextId: err.data.itemId,
          marginPercent: err.data.marginPercent,
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

  const itemCount = getItemCount()
  const hasPriceBelowMinimum = cart.some(item => item.unitPrice < (saleType === 'WHOLESALE' ? (item.minWholesalePrice || item.minRetailPrice) : item.minRetailPrice))

  // ── Inline Customer & Promoter Bar Component ───────────────────────
  const InlineClientBar = () => (
    <div className="pos-client-bar">
      {/* Customer Row */}
      <div className="pos-client-row">
        {!customerId ? (
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  className="input"
                  style={{ fontSize: '0.85rem', padding: '8px 10px' }}
                  placeholder="👤 Select or search customer (name/phone)..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                />
                {customerLoading && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Searching...
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowNewCustomer(!showNewCustomer)}
                title="Quick Add New Customer"
                style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}
              >
                <FiPlus /> New
              </button>
            </div>

            {customerResults.length > 0 && (
              <div className="pos-customer-list" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                {customerResults.map(c => (
                  <div
                    key={c.id}
                    className="pos-customer-row"
                    onClick={() => {
                      setCustomer(c.id, c.name)
                      setCustomerSearch('')
                      setCustomerResults([])
                      setShowNewCustomer(false)
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{c.name}</strong>
                      {c.tier && <span className="pos-client-badge">{c.tier}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {c.phone && <span>📞 {c.phone}</span>}
                      {typeof c.loyaltyPoints === 'number' && <span>⭐ {c.loyaltyPoints} pts</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="pos-client-chip">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <FiUser style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {customerName}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {selectedCustomerDetails?.tier && (
                    <span className="pos-client-badge">{selectedCustomerDetails.tier}</span>
                  )}
                  {selectedCustomerDetails && (
                    <span>⭐ {selectedCustomerDetails.loyaltyPoints} pts</span>
                  )}
                  {selectedCustomerDetails && Number(selectedCustomerDetails.outstandingCredit) > 0 && (
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      Debt: KES {Number(selectedCustomerDetails.outstandingCredit).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setCustomer(null, null); setSelectedCustomerDetails(null) }}
              style={{ color: 'var(--danger)', padding: '2px 8px', fontSize: '0.75rem' }}
            >
              Change
            </button>
          </div>
        )}
      </div>

      {/* Inline Quick Add Customer Form */}
      {showNewCustomer && !customerId && (
        <div className="pos-new-customer-form" style={{ marginTop: 4, background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '0.85rem' }}>+ Quick Customer Registration</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewCustomer(false)} style={{ padding: '2px 6px' }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="input"
              style={{ fontSize: '0.85rem', padding: '6px 8px' }}
              placeholder="Full Name *"
              value={newCustForm.name}
              onChange={e => setNewCustForm(f => ({ ...f, name: e.target.value }))}
            />
            <PhoneInput
              label=""
              value={newCustForm.phone}
              onChange={val => setNewCustForm(f => ({ ...f, phone: val }))}
            />
            <input
              className="input"
              style={{ fontSize: '0.85rem', padding: '6px 8px' }}
              placeholder="Email (optional)"
              value={newCustForm.email}
              onChange={e => setNewCustForm(f => ({ ...f, email: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewCustomer(false)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                disabled={savingCustomer || !newCustForm.name.trim()}
                onClick={async () => {
                  setSavingCustomer(true)
                  try {
                    const res = await api.post<{ id: string; name: string }>('/customers', newCustForm, token!)
                    setCustomer(res.id, res.name)
                    setShowNewCustomer(false)
                    setNewCustForm({ name: '', phone: '', email: '' })
                    toast.success(`Customer ${res.name} created!`)
                  } catch (e) {
                    toast.error('Failed: ' + (e as Error).message)
                  } finally {
                    setSavingCustomer(false)
                  }
                }}
              >
                {savingCustomer ? 'Saving...' : 'Save & Select'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promoter / Attributed Staff Selector */}
      {staffList.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Attributed to:
          </span>
          <select
            className="pos-promoter-select"
            value={promoterId || ''}
            onChange={(e) => {
              const val = e.target.value
              const match = staffList.find(s => s.id === val)
              setPromoter(val || null, match?.username || null)
            }}
          >
            <option value="">👤 Current User ({user?.username || 'You'})</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>
                {s.username} ({s.role})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )

  // ── Cart Panel ─────────────────────────────────────────────────────
  const CartPanel = () => (
    <div className="pos-cart" id="pos-cart">
      <InlineClientBar />

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
          cart.map((item) => {
            const minPrice = saleType === 'WHOLESALE' ? (item.minWholesalePrice || item.minRetailPrice) : item.minRetailPrice
            const isBelowMin = item.unitPrice < minPrice
            return (
              <div key={item.itemId + (item.serialId || '')} className="pos-cart-item" style={isBelowMin ? { backgroundColor: '#ffebe9', borderColor: '#ff8080' } : {}}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                    {item.serialNo && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6 }}>#{item.serialNo}</span>}
                    <span style={{ fontSize: '0.75rem', color: item.inStock > item.reorderLevel ? 'var(--success)' : 'var(--danger)', marginLeft: 8, fontWeight: 700 }}>In Stock: {item.inStock}</span>
                  </div>

                  {/* Quantity stepper */}
                  <div className="pos-qty-row">
                    <button
                      className="pos-qty-btn"
                      onClick={() => updateQuantity(item.itemId, item.quantity - 1, item.serialId)}
                      aria-label="Decrease quantity"
                    >−</button>
                    <span className="pos-qty-val">{item.quantity}</span>
                    <button
                      className="pos-qty-btn"
                      onClick={() => {
                        if (item.quantity + 1 > item.inStock) {
                          toast.error('Cannot exceed in-stock quantity')
                        } else {
                          updateQuantity(item.itemId, item.quantity + 1, item.serialId)
                        }
                      }}
                      aria-label="Increase quantity"
                    >+</button>
                    <input
                      className="input pos-price-input"
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updatePrice(item.itemId, Number(e.target.value), item.serialId)}
                      aria-label="Unit price"
                    />
                    <button
                      className="pos-remove-btn"
                      onClick={() => removeItem(item.itemId, item.serialId)}
                      aria-label="Remove item"
                    >✕</button>
                  </div>
                  {isBelowMin && (
                    <div className="pos-floor-warning">⚠ Below minimum price ({minPrice})</div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="pos-cart-footer">
        <div className="pos-total-row">
          <span>Subtotal</span>
          <span>{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getSubtotal())}</span>
        </div>
        {getTotalDiscount() > 0 && (
          <div className="pos-total-row" style={{ color: 'var(--danger)' }}>
            <span>Discount</span>
            <span>-{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(getTotalDiscount())}</span>
          </div>
        )}
        <div className="pos-total-row grand-total">
          <span>Total</span>
          <span>{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(total)}</span>
        </div>
        <button
          className="btn btn-success btn-lg pos-checkout-btn"
          onClick={() => setMobileTab('payment')}
          disabled={cart.length === 0 || (requiresSession && !activeSession) || hasPriceBelowMinimum}
          id="pos-checkout"
        >
          💳 Checkout ({new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(total)})
        </button>
      </div>
    </div>
  )

  // ── Payment Panel (with Split Payments) ─────────────────────────────
  const PaymentPanel = () => (
    <div className="pos-payment-panel">
      <div className="pos-payment-header">
        <button className="btn btn-ghost btn-sm" onClick={() => setMobileTab('cart')}>
          ← Back to Cart
        </button>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Payment</h3>
        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)' }}>
          {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(total)}
        </div>
      </div>

      <div className="pos-payment-body">
        {/* Customer & Promoter Reminder Chip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
          <div>
            👤 Customer: <strong>{customerName || 'Walk-in Customer'}</strong>
            {selectedCustomerDetails && Number(selectedCustomerDetails.loyaltyPoints) > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--primary-light)' }}>
                (⭐ {selectedCustomerDetails.loyaltyPoints} pts)
              </span>
            )}
          </div>
          {promoterName && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Associate: <strong>{promoterName}</strong>
            </div>
          )}
        </div>

        {/* Mode Toggle: Single Pay vs Split Payment */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-secondary)', padding: 4, borderRadius: 'var(--radius-md)' }}>
          <button
            type="button"
            className={`btn btn-sm ${!isSplitPayment ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, fontSize: '0.85rem' }}
            onClick={() => setIsSplitPayment(false)}
          >
            Single Payment
          </button>
          <button
            type="button"
            className={`btn btn-sm ${isSplitPayment ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1, fontSize: '0.85rem' }}
            onClick={() => {
              setIsSplitPayment(true)
              if (splitPayments.length === 0) {
                setSplitPayments([{ method: singleMethod, amount: total, reference: '' }])
              }
            }}
          >
            ✂️ Split Payment
          </button>
        </div>

        {/* ── MODE 1: SINGLE PAYMENT ───────────────────────────────── */}
        {!isSplitPayment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label htmlFor="payment-method">Payment Method</label>
              <select
                id="payment-method"
                value={singleMethod}
                onChange={(e) => setSingleMethod(e.target.value as PaymentMethodType)}
              >
                <option value="CASH">💵 Cash</option>
                <option value="MOBILE_MONEY">📱 Mobile Money (M-Pesa / Airtel)</option>
                <option value="CARD">💳 Debit / Credit Card</option>
                <option value="BANK_TRANSFER">🏦 Bank Transfer</option>
                <option value="CREDIT">📋 Debt (Credit Sale)</option>
                <option value="LOYALTY_POINTS">⭐ Loyalty Points</option>
              </select>
            </div>

            {(singleMethod === 'MOBILE_MONEY' || singleMethod === 'CARD' || singleMethod === 'BANK_TRANSFER') && (
              <div className="form-group">
                <label htmlFor="payment-ref">Transaction Reference / Code (optional)</label>
                <input
                  id="payment-ref"
                  className="input"
                  placeholder="e.g. QGH7823901 or Slip No"
                  value={singleRef}
                  onChange={(e) => setSingleRef(e.target.value)}
                />
              </div>
            )}

            {singleMethod === 'CASH' && (
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
                    💵 Change Due: {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(change)}
                  </div>
                )}
                <div className="pos-quick-amounts">
                  {[500, 1000, 2000, 5000].map(amt => (
                    <button key={amt} className="btn btn-ghost btn-sm pos-quick-btn"
                      onClick={() => setAmountTendered(String(amt))}>
                      {new Intl.NumberFormat('en-KE').format(amt)}
                    </button>
                  ))}
                  <button className="btn btn-ghost btn-sm pos-quick-btn"
                    onClick={() => setAmountTendered(String(total))}>
                    Exact
                  </button>
                </div>
              </div>
            )}

            {singleMethod === 'CREDIT' && (
              <div className="pos-credit-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f59e0b', marginBottom: 8, fontSize: '0.85rem' }}>
                  <FiAlertCircle /> Debt / Credit will be billed to <strong>{customerName || 'customer'}</strong>.
                </div>
                <div className="form-group">
                  <label>Due Date</label>
                  <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MODE 2: SPLIT PAYMENTS ───────────────────────────────── */}
        {isSplitPayment && (
          <div className="pos-split-container">
            <div className="pos-balance-summary">
              <div className="pos-balance-card">
                <span className="label">Total Due</span>
                <span className="value">KES {total.toLocaleString()}</span>
              </div>
              <div className="pos-balance-card">
                <span className="label">Allocated</span>
                <span className="value">KES {totalAllocated.toLocaleString()}</span>
              </div>
              <div className={`pos-balance-card ${remainingBalance === 0 ? 'remaining-zero' : remainingBalance > 0 ? 'remaining-positive' : 'remaining-overpaid'}`}>
                <span className="label">{remainingBalance >= 0 ? 'Remaining' : 'Overpaid'}</span>
                <span className="value">
                  {remainingBalance === 0 ? '✓ Balanced' : `KES ${Math.abs(remainingBalance).toLocaleString()}`}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {splitPayments.map((p, idx) => (
                <div key={idx} className="pos-split-row">
                  <select
                    className="select"
                    style={{ fontSize: '0.85rem', padding: '6px' }}
                    value={p.method}
                    onChange={(e) => handleUpdateSplitRow(idx, { method: e.target.value as PaymentMethodType })}
                  >
                    <option value="CASH">💵 Cash</option>
                    <option value="MOBILE_MONEY">📱 M-Pesa</option>
                    <option value="CARD">💳 Card</option>
                    <option value="BANK_TRANSFER">🏦 Bank</option>
                    <option value="CREDIT">📋 Debt</option>
                    <option value="LOYALTY_POINTS">⭐ Loyalty</option>
                  </select>

                  <input
                    type="number"
                    className="input"
                    style={{ fontSize: '0.9rem', fontWeight: 600 }}
                    placeholder="Amount"
                    value={p.amount || ''}
                    onChange={(e) => handleUpdateSplitRow(idx, { amount: Number(e.target.value) })}
                  />

                  <input
                    className="input pos-split-row-ref"
                    style={{ fontSize: '0.85rem' }}
                    placeholder="Ref / Code"
                    value={p.reference || ''}
                    onChange={(e) => handleUpdateSplitRow(idx, { reference: e.target.value })}
                  />

                  {splitPayments.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', padding: '6px' }}
                      onClick={() => handleRemoveSplitRow(idx)}
                      title="Remove row"
                    >
                      <FiTrash2 />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: 'flex-start', fontSize: '0.85rem' }}
              onClick={handleAddSplitRow}
            >
              <FiPlus /> Add Payment Method
            </button>
          </div>
        )}
      </div>

      <div className="pos-payment-footer">
        <button
          className="btn btn-success pos-complete-btn"
          onClick={() => handleCommitSale()}
          disabled={committing || hasPriceBelowMinimum || (isSplitPayment && Math.abs(remainingBalance) > 0.01)}
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
        {/* Items search and grid */}
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
          {mobileTab !== 'payment' ? <CartPanel /> : null}
          {mobileTab === 'payment' && <PaymentPanel />}
        </div>
      </div>

      {/* ── Mobile Layout ──────────────────────────────────────────── */}
      <div className="pos-mobile-layout">
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

        {mobileTab === 'cart' && (
          <div className="pos-mobile-cart">
            <CartPanel />
          </div>
        )}

        {mobileTab === 'payment' && (
          <div className="pos-mobile-payment">
            <PaymentPanel />
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
