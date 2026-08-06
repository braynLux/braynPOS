import { create } from 'zustand'

interface CartItem {
  itemId: string
  name: string
  sku: string
  serialId?: string
  serialNo?: string
  quantity: number
  unitPrice: number
  minRetailPrice: number
  minWholesalePrice: number
  costPrice: number
  discountAmount: number
}

interface POSState {
  cart: CartItem[]
  customerId: string | null
  customerName: string | null
  saleType: 'RETAIL' | 'WHOLESALE' | 'CREDIT'
  discountAmount: number
  notes: string

  addItem: (item: Omit<CartItem, 'discountAmount'>) => void
  removeItem: (itemId: string, serialId?: string) => void
  updateQuantity: (itemId: string, quantity: number, serialId?: string) => void
  updatePrice: (itemId: string, unitPrice: number, serialId?: string) => void
  setItemDiscount: (itemId: string, discount: number, serialId?: string) => void
  setCustomer: (id: string | null, name: string | null) => void
  setSaleType: (type: 'RETAIL' | 'WHOLESALE' | 'CREDIT') => void
  setDiscount: (amount: number) => void
  setNotes: (notes: string) => void
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
  saleType: 'RETAIL',
  discountAmount: 0,
  notes: '',

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

  setSaleType: (type) => set({ saleType: type }),
  setDiscount: (amount) => set({ discountAmount: amount }),
  setNotes: (notes) => set({ notes }),

  clearCart: () =>
    set({
      cart: [],
      customerId: null,
      customerName: null,
      saleType: 'RETAIL',
      discountAmount: 0,
      notes: '',
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
