export const APP_KNOWLEDGE = {
  name: "LUX POS",
  version: "2.5.0",
  features: [
    {
      name: "Architectural Integrity",
      description: "Dual-layer validation for every transaction across ledger and inventory."
    },
    {
      name: "LuxAI Intelligence",
      description: "Real-time systems diagnostic engine with architectural reasoning capabilities."
    },
    {
      name: "Blind Stock Takes",
      description: "Secure physical inventory counts where system balances are hidden from storekeepers to prevent fraud. Snapshots are taken at the start of the count."
    },
    {
      name: "Dual-Control Adjustments",
      description: "Automatic routing of high-value stock adjustments (quantity > 50 or value > 500) for mandatory manager approval."
    },
    {
      name: "Reports Hub",
      description: "Real-time generation of Trial Balance, Profit & Loss, and Balance Sheets based on double-entry ledger movements."
    },
    {
      name: "Payroll & Commission Engine",
      description: "Integrated payroll calculation with statutory deductions (NSSF, NHIF, PAYE) and tiered commission rules (Retail 12%, Wholesale 8%, Promoter 15%) based on snapshot gross margins."
    }
  ],
  faq: [
    {
      question: "How do I void a sale?",
      answer: "Navigate to Sales History, find the receipt, and select 'Void'. This restores stock to inventory and creates reversing journal entries. Requires Admin approval if the session is closed."
    },
    {
      question: "How are payroll deductions calculated?",
      answer: "Mandatory deductions include PAYE (Income Tax), NHIF (Health Insurance), and NSSF (Social Security). Custom deductions like loss recovery or salary advances can also be applied in the Staff Profile."
    },
    {
      question: "What is the opening stock window?",
      answer: "A migration tool in Settings > Advanced that allows managers to add inventory without financial expense impact. Must be enabled by a Super Admin."
    },
    {
      question: "How do I reconcile my shift?",
      answer: "At the end of a shift, enter the final cash count. The system calculates a 'Variance' based on: Opening Float + Cash Sales - Cash Expenses. Discrepancies are flagged for audit."
    },
    {
      question: "Why is an item not showing in POS?",
      answer: "Verify the item is marked as 'Active' and has sufficient inventory balance in the current channel/branch."
    },
    {
      question: "How are margins calculated?",
      answer: "Gross Margin = Sale Net (excluding tax) - (Snapshotted Cost * Quantity). The system snapshots the branch-specific weighted average cost at the exact moment of sale to ensure 100% accurate P&L data."
    }
  ],
  supportContact: "braynimpwii@gmail.com | 0791576997"
};
