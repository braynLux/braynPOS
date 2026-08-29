import { create } from 'zustand'

export interface CartItem {
  itemId: string
  name: string
  sku: string
  serialId?: string
  serialNo?: string
  quantity: number
  unitPrice: number
  originalPrice: number
  minRetailPrice: number
  minWholesalePrice: number
  costPrice: number
  discountAmount: number
  inStock: number
  reorderLevel: number
}

export type PaymentMethodType = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT' | 'LOYALTY_POINTS'

export interface POSPayment {
  method: PaymentMethodType
  amount: number
  reference?: string
}

interface POSState {
  cart: CartItem[]
  customerId: string | null
  customerName: string | null
  promoterId: string | null
  promoterName: string | null
  saleType: 'RETAIL' | 'WHOLESALE' | 'CREDIT'
  discountAmount: number
  notes: string
  payments: POSPayment[]

  addItem: (item: Omit<CartItem, 'discountAmount'>) => void
  removeItem: (itemId: string, serialId?: string) => void
  updateQuantity: (itemId: string, quantity: number, serialId?: string) => void
  updatePrice: (itemId: string, unitPrice: number, serialId?: string) => void
  setItemDiscount: (itemId: string, discount: number, serialId?: string) => void
  setCustomer: (id: string | null, name: string | null) => void
  setPromoter: (id: string | null, name: string | null) => void
  setSaleType: (type: 'RETAIL' | 'WHOLESALE' | 'CREDIT') => void
  setDiscount: (amount: number) => void
  setNotes: (notes: string) => void
  setPayments: (payments: POSPayment[]) => void
  addPaymentLine: (payment: POSPayment) => void
  removePaymentLine: (index: number) => void
  updatePaymentLine: (index: number, patch: Partial<POSPayment>) => void
  resetPayments: () => void
  clearCart: () => void

  getSubtotal: () => number
  getTotalDiscount: () => number
  getTotal: () => number
  getItemCount: () => number
}

export const usePOSStore = create<POSState>()((set, get) => ({
  cart: [],
  customerId: null,
  customerName: null,
  promoterId: null,
  promoterName: null,
  saleType: 'RETAIL',
  discountAmount: 0,
  notes: '',
  payments: [],

  addItem: (item) =>
    set((state) => {
      const existing = state.cart.find(
        (c) => c.itemId === item.itemId && !c.serialId
      )
      if (existing && !item.serialId) {
        return {
          cart: state.cart.map((c) =>
            c.itemId === item.itemId && !c.serialId
              ? { ...c, quantity: c.quantity + item.quantity }
              : c
          ),
        }
      }
      return { cart: [...state.cart, { ...item, discountAmount: 0 }] }
    }),

  removeItem: (itemId, serialId) =>
    set((state) => ({
      cart: state.cart.filter((c) => !(c.itemId === itemId && c.serialId === serialId)),
    })),

  updateQuantity: (itemId, quantity, serialId) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.itemId === itemId && c.serialId === serialId
          ? { ...c, quantity: c.serialId ? 1 : Math.max(1, quantity) }
          : c
      ),
    })),

  updatePrice: (itemId, unitPrice, serialId) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.itemId === itemId && c.serialId === serialId ? { ...c, unitPrice } : c
      ),
    })),

  setItemDiscount: (itemId, discount, serialId) =>
    set((state) => ({
      cart: state.cart.map((c) =>
        c.itemId === itemId && c.serialId === serialId ? { ...c, discountAmount: discount } : c
      ),
    })),

  setCustomer: (id, name) =>
    set({ customerId: id, customerName: name }),

  setPromoter: (id, name) =>
    set({ promoterId: id, promoterName: name }),

  setSaleType: (type) => set({ saleType: type }),
  setDiscount: (amount) => set({ discountAmount: amount }),
  setNotes: (notes) => set({ notes }),

  setPayments: (payments) => set({ payments }),

  addPaymentLine: (payment) =>
    set((state) => ({ payments: [...state.payments, payment] })),

  removePaymentLine: (index) =>
    set((state) => ({ payments: state.payments.filter((_, i) => i !== index) })),

  updatePaymentLine: (index, patch) =>
    set((state) => ({
      payments: state.payments.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    })),

  resetPayments: () => set({ payments: [] }),

  clearCart: () =>
    set({
      cart: [],
      customerId: null,
      customerName: null,
      promoterId: null,
      promoterName: null,
      saleType: 'RETAIL',
      discountAmount: 0,
      notes: '',
      payments: [],
    }),

  getSubtotal: () =>
    get().cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),

  getTotalDiscount: () =>
    get().cart.reduce((sum, item) => sum + item.discountAmount, 0) +
    get().discountAmount,

  getTotal: () => get().getSubtotal() - get().getTotalDiscount(),

  getItemCount: () =>
    get().cart.reduce((sum, item) => sum + item.quantity, 0),
}))
