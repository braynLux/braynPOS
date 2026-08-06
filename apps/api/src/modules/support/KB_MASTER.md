# LUX POS MASTER OPERATIONAL KNOWLEDGE BASE

## 1. IDENTITY & PHILOSOPHY
The LUX POS and ERP platform prioritizes system integrity and operational resolution through definitive, technical, and actionable intelligence.

## 2. SECURITY & AUTHENTICATION
- **Roles:**
  - **SUPER_ADMIN:** Full system access, system-wide settings, user management.
  - **MANAGER_ADMIN:** Oversees multiple branches, handles advanced inventory and financial approvals.
  - **MANAGER:** Restricted to their assigned channel/branch. Handles local stock, sales, and staff.
  - **CASHIER:** Restricted to POS sales and personal session management.
- **Session Management:** Users must open a session (Cash Float) before making sales. Closing a session requires manual cash count and generates a session report comparing expected vs actual revenue.

## 3. INVENTORY & ITEMS
- **Item Creation:** Requires Name, Category, Brand, and Base Price.
- **Serial Tracking:** Items marked as 'Serialized' require unique serial numbers for every unit. Serials can be added during purchase receipt or via Stock Levels.
- **Reorder Levels:** When available quantity drops below this level, the item appears in the 'Low Stock' report on the Dashboard.
- **Opening Stock:** Used during system migration only. Must be enabled by an administrator in Settings > Advanced. When active, managers can add items with 'Opening' status which doesn't impact expense accounts.

## 4. SALES & POINT OF SALE (POS)
- **Workflow:** Scan items -> Select Customer (optional) -> Apply Discounts/Loyalty -> Select Payment Method -> Complete.
- **Loyalty Program:** Customers earn points per transaction based on the loyalty multiplier (default 1 point per 1000 KES). Points can be redeemed as discount on future sales.
- **Credit Sales:** Only available for registered customers. Creates a 'Credit Balance' which must be cleared via the Debtors module.
- **Sale Reversal (Voids):** Sales can be reversed/voided. This restores stock to the inventory and creates a reversing journal entry in the accounting module. Requires Admin approval if the session is closed.

## 5. STOCK MOVEMENTS & TRANSFERS
- **Branch Transfers:** Movement of items between channels. 
  - Status 'SENT': Items have left source.
  - Status 'RECEIVED': Items entered destination.
- **Transfers** automatically update 'Incoming Quantity' for the destination branch, visible in Stock Overview.

## 6. PURCHASES & LPOs
- **Local Purchase Orders (LPO):** Formal requests to suppliers. 
- **Receiving Purchase:** Increases stock levels and updates Weighted Average Cost (WAC). Generates a 'Payable' record for the supplier.

## 7. ACCOUNTING & FINANCE
- **Chart of Accounts (COA):** Integrated double-entry system.
- **Reports:** Trial Balance, Profit & Loss, and Balance Sheet are generated in real-time based on transactions.
- **Taxes:** Integrated VAT (16%) and other statutory levies. Tax reports can be generated per channel or system-wide.

## 8. PAYROLL & STAFF
- **Staff Profiles:** Linked to User accounts. Contains base salary and statutory details (NSSF, NHIF, PAYE).
- **Deductions:** 
  - Mandatory: Tax, Insurance, Social Security.
  - Custom: Salary advances, losses, or personal loans.
- **Payroll Generation:** Processed monthly. Generates digital pay slips.

## 9. EXPENSES
- **Categorization:** Marketing, Utilities, Rent, Petty Cash, etc.
- **Petty Cash:** Daily operational expenses recorded at the branch level. Requires description and reference.

## 10. TROUBLESHOOTING & ERRORS
- **Zero Totals in Payroll:** Ensure Staff Profiles are fully configured with base salaries.
- **401 Unauthorized:** Your session has expired. Log out and log back in.
- **Item Not Found in POS:** Check if the item is 'Active' and present in the current channel's inventory.
- **AI Module Unreachable:** The system's reasoning engine (Gemini) might be experiencing latency. If it fails, escalate to a human agent via 0791576997 or braynimpwii@gmail.com.

## 11. MARGINS & COMMISSIONS
- **Calculation Logic:**
  - **Capture:** Snapshots branch-specific `weightedAvgCost` at the moment of sale.
  - **Formula:** `Gross Margin = Sale-Net-Amount - (Snapshotted-Cost * Quantity)`.
- **Commission Rules:**
  - Applied hierarchical order: User Specific > Role > Branch > Global.
  - **Thresholds:** A `minMarginPercent` can be set. If a sale's margin is below this (e.g., due to discounting), the commission is 0.
- **Payout:** Approved commissions are added to the monthly net salary during payroll generation.
