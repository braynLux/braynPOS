export interface NavItem {
  href:  string
  label: string
  icon:  string
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
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
      { href: '/dashboard/items/bulk-opening', label: '🚀 Bulk Opening Stock', icon: '🚀' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒' },
      { href: '/dashboard/accounting/assets', label: '🏛️ Fixed Assets', icon: '🏛️' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️' },
      { href: '/dashboard/audit/serials', label: '🔢 Serial Forensics', icon: '🔢' },
      { href: '/dashboard/settings/checklists', label: '🛠️ Service Checklists', icon: '🛠️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  MANAGER_ADMIN: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️' },
      { href: '/dashboard/audit/serials', label: '🔢 Serial Forensics', icon: '🔢' },
      { href: '/dashboard/settings/checklists', label: '🛠️ Service Checklists', icon: '🛠️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  ADMIN: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦' },
      { href: '/dashboard/payroll',    label: '💵 Payroll',           icon: '💵' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/channels',   label: '🏪 Channels',          icon: '🏪' },
      { href: '/dashboard/users',      label: '👥 Users',             icon: '👥' },
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  MANAGER: [
    { group: 'Overview', items: [
      { href: '/dashboard',            label: '📊 Dashboard',        icon: '📊' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/approvals',  label: '✅ Pending Approvals', icon: '✅' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/purchases',  label: '📦 Purchases',         icon: '📦' },
      { href: '/dashboard/invoicing',  label: '🧾 Invoicing',         icon: '🧾' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄' },
      { href: '/dashboard/expenses',   label: '💸 Expenses',          icon: '💸' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
    ]},
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢' },
      { href: '/dashboard/stock/take', label: '📝 Physical Count',    icon: '📝' },
    ]},
    { group: 'Finance', items: [
      { href: '/dashboard/accounting', label: '📒 Accounting',        icon: '📒' },
      { href: '/dashboard/credit',     label: '🏦 Credit',            icon: '🏦' },
    ]},
    { group: 'System', items: [
      { href: '/dashboard/reports',    label: '📊 Reports',           icon: '📊' },
      { href: '/dashboard/reports/insights', label: '📈 Financial Insights', icon: '📈' },
      { href: '/dashboard/ai-portal',  label: '🤖 LuxAI',             icon: '🤖' },
      { href: '/dashboard/support',    label: '🎧 Support',           icon: '🎧' },
      { href: '/dashboard/audit',      label: '📜 Audit Trail',       icon: '📜' },
      { href: '/dashboard/audit/margin-audit', label: '🛡️ Forensic Audit', icon: '🛡️' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  STOREKEEPER: [
    { group: 'Inventory', items: [
      { href: '/dashboard/items',      label: '📋 Items',             icon: '📋' },
      { href: '/dashboard/stock',      label: '📈 Stock Levels',      icon: '📈' },
      { href: '/dashboard/serials',    label: '🔢 Serial Numbers',    icon: '🔢' },
    ]},
    { group: 'Operations', items: [
      { href: '/dashboard/sales',      label: '💰 Sales',             icon: '💰' },
      { href: '/dashboard/transfers',  label: '🔄 Transfers',         icon: '🔄' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],

  // ── Shift-based roles: sessions required, visible in nav ──────────
  CASHIER: [
    { group: 'Overview', items: [
      { href: '/dashboard/sessions',   label: '🎫 My Session',        icon: '🎫' },
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/sales',      label: '💰 Sales History',     icon: '💰' },
      { href: '/dashboard/customers',  label: '👥 Customers',         icon: '👥' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  PROMOTER: [
    { group: 'Overview', items: [
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
      { href: '/dashboard/sales',      label: '💰 My Sales',          icon: '💰' },
      { href: '/dashboard/settings',   label: '⚙️ Settings',          icon: '⚙️' },
    ]},
  ],
  SALES_PERSON: [
    { group: 'Overview', items: [
      { href: '/dashboard/pos',        label: '🛒 POS Terminal',      icon: '🛒' },
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
  CASHIER:       '/dashboard/sessions',  // Cashier lands on sessions first
  PROMOTER:      '/dashboard/pos',
  SALES_PERSON:  '/dashboard/pos',
}
