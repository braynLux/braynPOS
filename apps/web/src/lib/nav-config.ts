import { resolveEnterpriseCapabilities, type PlanFeatureKey } from '@/lib/plans'

export interface NavItem {
  href:        string
  label:       string
  icon:        string
  featureKey?: PlanFeatureKey
  isLocked?:   boolean
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV_ITEMS_BY_ROLE: Record<string, NavGroup[]> = {
  PLATFORM_OWNER: [
    { group: '🎯 Command Center', items: [
      { href: '/dashboard',             label: '📊 Fleet Dashboard',    icon: '📊' },
      { href: '/dashboard/enterprises', label: '🏢 Enterprise Fleet',   icon: '🏢' },
    ]},
    { group: '🔧 Fleet Operations', items: [
      { href: '/dashboard/fleet/analytics', label: '📈 Fleet Analytics',    icon: '📈' },
      { href: '/dashboard/fleet/audit',     label: '📜 Fleet Audit Trail',  icon: '📜' },
    ]},
    { group: '🛡️ Platform Security', items: [
      { href: '/dashboard/fleet/security',  label: '🔒 Security Overview',  icon: '🔒' },
      { href: '/dashboard/settings',        label: '⚙️ Platform Settings',  icon: '⚙️' },
    ]},
  ],
  SUPER_ADMIN: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾', featureKey: 'invoicing' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄', featureKey: 'transfers' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
      { href: '/dashboard/items/bulk-opening', label: '🚀 Master Catalog Setup', icon: '🚀', featureKey: 'catalog' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒', featureKey: 'accounting' },
      { href: '/dashboard/accounting/assets', label: '🏛️ Fixed Assets', icon: '🏛️', featureKey: 'fixedAssets' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦', featureKey: 'credit' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵', featureKey: 'payroll' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖', featureKey: 'aiPortal' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️', featureKey: 'marginAudit' },
      { href: '/dashboard/audit/serials', label: '🔢 Serial Forensics', icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/settings/checklists', label: '🛠️ Service Checklists', icon: '🛠️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  MANAGER_ADMIN: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾', featureKey: 'invoicing' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄', featureKey: 'transfers' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒', featureKey: 'accounting' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦', featureKey: 'credit' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵', featureKey: 'payroll' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖', featureKey: 'aiPortal' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️', featureKey: 'marginAudit' },
      { href: '/dashboard/audit/serials', label: '🔢 Serial Forensics', icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/settings/checklists', label: '🛠️ Service Checklists', icon: '🛠️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  ADMIN: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾', featureKey: 'invoicing' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄', featureKey: 'transfers' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒', featureKey: 'accounting' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦', featureKey: 'credit' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵', featureKey: 'payroll' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖', featureKey: 'aiPortal' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️', featureKey: 'marginAudit' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  MANAGER: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾', featureKey: 'invoicing' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄', featureKey: 'transfers' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢', featureKey: 'serials' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒', featureKey: 'accounting' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦', featureKey: 'credit' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/reports/insights', label: '📈 Financial Insights', icon: '📈' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖', featureKey: 'aiPortal' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️', featureKey: 'marginAudit' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  STOREKEEPER: [
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢', featureKey: 'serials' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄', featureKey: 'transfers' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  CASHIER: [
    { group: 'Overview', items: [
      { href: '/dashboard/sessions',   label: '🎫 My Session',        icon: '🎫' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/sales',      label: '💰 Sales History',     icon: '💰' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  PROMOTER: [
    { group: 'Overview', items: [
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/sales',      label: '💰 My Sales',          icon: '💰' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  SALES_PERSON: [
    { group: 'Overview', items: [
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒', featureKey: 'pos' },
      { href: '/dashboard/sales',      label: '💰 Sales History',     icon: '💰' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
}

export const ROLE_LANDING_PAGES: Record<string, string> = {
  PLATFORM_OWNER: '/dashboard',
  SUPER_ADMIN:   '/dashboard',
  MANAGER_ADMIN: '/dashboard',
  ADMIN:         '/dashboard',
  MANAGER:       '/dashboard',
  STOREKEEPER:   '/dashboard/stock',
  CASHIER:       '/dashboard/sessions',
  PROMOTER:      '/dashboard/pos',
  SALES_PERSON:  '/dashboard/pos',
}

/**
 * Returns navigation groups strictly filtered by enterprise tier capabilities.
 * Features not included in the plan are completely hidden and omitted from navigation.
 */
export function getNavForUser(role: string, enterprise?: any): NavGroup[] {
  const baseGroups = NAV_ITEMS_BY_ROLE[role] || []
  if (role === 'PLATFORM_OWNER' && !enterprise) {
    return baseGroups
  }

  const caps = resolveEnterpriseCapabilities(enterprise)

  return baseGroups
    .map((group) => ({
      group: group.group,
      items: group.items.filter((item) => {
        if (!item.featureKey) return true
        return caps.hasFeature(item.featureKey)
      }),
    }))
    .filter((group) => group.items.length > 0)
}
