import { create } from 'zustand'
import { persist, createJSONStorage, type StorageValue } from 'zustand/middleware'
import { db } from '@/lib/indexed-db'

const uuidv4 = () => typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(7);

interface OfflineSale {
  id: string
  offlineReceiptNo: string
  saleData: Record<string, unknown>
  createdAt: string
  // 'conflict': the server accepted the payload but could not commit it and
  // filed it for manager review. Deliberately distinct from 'synced' (the sale
  // does not exist yet) and from 'failed' (retrying cannot help — the decision
  // is the manager's), so it is neither cleared away nor retried forever.
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'
  error?: string
}

interface OfflineState {
  isOnline: boolean
  pendingSales: OfflineSale[]
  setOnline: (online: boolean) => void
  addOfflineSale: (saleData: Record<string, unknown>) => string
  markSyncing: (id: string) => void
  markSynced: (id: string) => void
  markFailed: (id: string, error: string) => void
  markConflict: (id: string, error: string) => void
  removeSynced: () => void
  getPendingCount: () => number
  syncPendingSales: (api: any, token: string) => Promise<void>
}

// Custom storage adapter for IndexedDB via Dexie
const indexedDBStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const data = await db.sales.toArray();
    if (data.length === 0) return null;
    // We wrap it in the format zustand persist expects if using createJSONStorage
    // but here we are returning the JSON string of the state
    const state = {
      state: {
        pendingSales: data
      },
      version: 0
    };
    return JSON.stringify(state);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const parsed = JSON.parse(value) as StorageValue<{ pendingSales: OfflineSale[] }>;
    const sales = parsed.state.pendingSales;
    
    // Efficiently sync Dexie with Zustand state
    await db.transaction('rw', db.sales, async () => {
      // For simplicity in this scale, we clear and re-add 
      // In a real high-perf app, we'd do diffing
      await db.sales.clear();
      if (sales.length > 0) {
        await db.sales.bulkAdd(sales);
      }
    });
  },
  removeItem: async (name: string): Promise<void> => {
    await db.sales.clear();
  }
};

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: typeof window !== 'undefined' ? navigator.onLine : true,
      pendingSales: [],

      setOnline: (online) => set({ isOnline: online }),

      addOfflineSale: (saleData) => {
        const offlineReceiptNo = `OFF-${Date.now()}-${uuidv4().slice(0, 8)}`
        const sale: OfflineSale = {
          id: uuidv4(),
          offlineReceiptNo,
          saleData,
          createdAt: new Date().toISOString(),
          syncStatus: 'pending',
        }
        set((state) => ({
          pendingSales: [...state.pendingSales, sale],
        }))
        return offlineReceiptNo
      },

      markSyncing: (id) =>
        set((state) => ({
          pendingSales: state.pendingSales.map((s) =>
            s.id === id ? { ...s, syncStatus: 'syncing' as const } : s
          ),
        })),

      markSynced: (id) =>
        set((state) => ({
          pendingSales: state.pendingSales.map((s) =>
            s.id === id ? { ...s, syncStatus: 'synced' as const } : s
          ),
        })),

      markFailed: (id, error) =>
        set((state) => ({
          pendingSales: state.pendingSales.map((s) =>
            s.id === id ? { ...s, syncStatus: 'failed' as const, error } : s
          ),
        })),

      markConflict: (id, error) =>
        set((state) => ({
          pendingSales: state.pendingSales.map((s) =>
            s.id === id ? { ...s, syncStatus: 'conflict' as const, error } : s
          ),
        })),

      removeSynced: () =>
        set((state) => ({
          pendingSales: state.pendingSales.filter((s) => s.syncStatus !== 'synced'),
        })),

      getPendingCount: () =>
        get().pendingSales.filter((s) => s.syncStatus === 'pending' || s.syncStatus === 'failed').length,

      syncPendingSales: async (api, token) => {
        const { pendingSales, markSyncing, markSynced, markFailed, markConflict, removeSynced } = get()
        const toSync = pendingSales.filter(s => s.syncStatus === 'pending' || s.syncStatus === 'failed')

        if (toSync.length === 0) return

        console.log(`[OfflineSync] Attempting to sync ${toSync.length} sales...`)

        for (const sale of toSync) {
          markSyncing(sale.id)
          try {
            const res = await api.post('/sales/sync-offline', {
              offlineReceiptNo: sale.offlineReceiptNo,
              saleData: sale.saleData
            }, token, {
              'Idempotency-Key': sale.id // Use the sale UUID as idempotency key
            })
            // FIX: a conflict comes back as HTTP 202 with status 'conflict' —
            // the server took the payload but filed it for manager review
            // instead of committing it. 202 passes res.ok, so this used to fall
            // straight into markSynced and removeSynced: the cashier was told
            // the sale had gone through and the record was deleted from the
            // device, while the sale did not exist and might yet be voided.
            if (res?.status === 'conflict') {
              console.warn(`[OfflineSync] Conflict for ${sale.offlineReceiptNo} — awaiting manager review:`, res.conflictId)
              markConflict(sale.id, res.message || 'Awaiting manager review')
            } else {
              markSynced(sale.id)
            }
          } catch (err: any) {
            console.error(`[OfflineSync] Failed for ${sale.offlineReceiptNo}:`, err.message)
            markFailed(sale.id, err.message)
          }
        }
        
        // Clean up synced items after a short delay or immediately
        removeSynced()
      }
    }),
    {
      name: 'brayn-offline',
      storage: indexedDBStorage as any,
      partialize: (state) => ({ pendingSales: state.pendingSales }), // Only persist pendingSales
    }
  )
)
