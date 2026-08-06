# Stock Issues

## Why is my stock showing as negative?
Negative stock in LUX occurs when an offline sale is synced after stock was already depleted by another transaction. This is intentional — the system commits offline sales in good faith and notifies admins via a NEGATIVE_STOCK notification. To resolve: check the Notifications panel, identify the item, and create a manual ADJUSTMENT_IN stock movement to correct the balance.

## How does the stock level update?
Stock levels are maintained by a PostgreSQL trigger on the stock_movements table. Every INSERT into stock_movements automatically updates inventory_balances. This is synchronous and immediate — no background job is involved. The materialized view (stock_levels) is for reporting only and refreshes every 5 minutes. It is NOT used for sale validation.

## How do I adjust stock manually?
Go to Stock Overview > select the item > Stock Adjustment. Choose ADJUSTMENT_IN to add stock or ADJUSTMENT_OUT to remove. You must provide a reason. This creates a StockMovement record and immediately updates inventory_balances via the DB trigger. MANAGER role or above required. All adjustments are logged in audit_logs.

## What is WAC (Weighted Average Cost)?
WAC is recalculated automatically every time a Purchase is committed. Formula: (current_stock * current_WAC + qty_received * unit_cost) / (current_stock + qty_received). WAC is used for COGS in the double-entry ledger and for margin calculations in reports. WAC is only visible to STOREKEEPER role and above — cashiers do not see it.
