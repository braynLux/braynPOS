# Payroll and Tax

## Deduction Rules
Deductions follow a specific calculation sequence (100 is default). Pre-tax deductions (like specific pension contributions) reduce the taxable income before PAYE/Tax is calculated. Post-tax deductions are taken from the Net Salary.

## How to add tax brackets?
Admins can update Deduction Rules > Brackets. Brackets define income ranges and the corresponding percentage or fixed rate. LUX uses a 'Progressive Tax' engine that applies rates cumulatively across brackets.

## Salary Run Process
1. Initialize Run (Draft)
2. Review Lines (System calculates based on Fixed Salary + Rules)
3. Modify/Approve individual lines
4. Finalize Run (Commits to Ledger and generates Payslips)
Once finalized, a salary run cannot be edited.

## Tax Connector
The Tax Connector (KRA/TIMS) syncs sales in real-time. If a sale fails to sync, it will be marked as FAILED. Check the Tax Reports module to retry failed syncs.

## Margins & Commissions
- **Calculation Logic:**
  - **Capture:** Snapshots branch-specific `weightedAvgCost` at the moment of sale.
  - **Formula:** `Gross Margin = Sale-Net-Amount - (Snapshotted-Cost * Quantity)`.
- **Commission Rules:**
  - Applied hierarchical order: User Specific > Role > Branch > Global.
  - **Thresholds:** A `minMarginPercent` can be set. If a sale's margin is below this (e.g., due to discounting), the commission is 0.
- **Payout:** Approved commissions are added to the monthly net salary during payroll generation.
