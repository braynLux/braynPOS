import Dexie, { type Table } from 'dexie';

// Single source of truth for the sync state of an offline sale. The Zustand
// store (OfflineSale) and this Dexie row describe the same record and are
// assigned to each other when persisting, so they must not carry separate
// copies of this union — adding 'conflict' to one and not the other is what
// broke the build.
//
// 'conflict': the server accepted the payload but filed it for manager review
// instead of committing it. Distinct from 'synced' (no sale exists yet) and
// from 'failed' (retrying cannot help; the decision is the manager's).
export type SaleSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface LocalSale {
  id: string;
  offlineReceiptNo: string;
  saleData: any;
  createdAt: string;
  syncStatus: SaleSyncStatus;
  error?: string;
}

export interface LocalItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  retailPrice: number;
  wholesalePrice: number;
  minRetailPrice: number;
  minWholesalePrice: number;
  weightedAvgCost: number;
  isSerialized: boolean;
  categoryName?: string;
  updatedAt: string;
}

export class BraynDatabase extends Dexie {
  sales!: Table<LocalSale>;
  items!: Table<LocalItem>;

  constructor() {
    super('BraynOfflineDB');
    this.version(2).stores({
      sales: 'id, offlineReceiptNo, syncStatus, createdAt',
      items: 'id, sku, barcode, name'
    });
  }
}

export const db = new BraynDatabase();
