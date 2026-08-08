-- ============================================================================
-- Data-drift diagnostics
-- ============================================================================
-- READ ONLY. Every statement here is a SELECT. Nothing is written, updated or
-- deleted, so this is safe to run against production as-is.
--
-- Four bugs fixed on branch claude/seeded-login-credentials-cbh5ip corrupted
-- stored state rather than merely behaving wrongly, so the damage they did
-- stays in the database after the fix ships. Each section below measures how
-- much of it there is. Run them, look at the numbers, then decide what (if
-- anything) is worth correcting — none of these queries decide that for you.
--
--   Usage:  psql "$DATABASE_URL" -f diagnose-data-drift.sql
--   Single section: copy the query you want; they are independent.
--
-- ── The cutoff ──────────────────────────────────────────────────────────────
-- Sections 1 and 4 need to know when the fix reached production, because
-- events after that point are already handled correctly and must not be
-- counted as damage. Set it to your deploy time before running. Left at the
-- default of now() every historical row is reported, which is right if you
-- have not deployed yet, and over-reports afterwards.
\set fix_deployed_at '''now()'''


-- ============================================================================
-- 1. Phantom stock from voided purchases
-- ============================================================================
-- purchase.softDelete() reversed the ledger but never decremented
-- inventory_balances, so voided purchases left their goods on hand and
-- sellable. Each row is stock the system still believes exists because a
-- purchase was voided and never taken back out.
--
-- Reading it: qty_still_on_books is what availableQty is overstated by for
-- that item/channel. value_overstated prices it at the item's current
-- weighted average cost, which is itself approximate (see section 2).
-- ============================================================================
\echo ''
\echo '=== 1. Phantom stock left behind by voided purchases ==='

SELECT
  c.name                                   AS channel,
  i.sku,
  i.name                                   AS item,
  SUM(pl.quantity)                         AS qty_still_on_books,
  ib."availableQty"                        AS current_available_qty,
  ROUND(SUM(pl.quantity) * ib."weightedAvgCost", 2) AS value_overstated,
  COUNT(DISTINCT p.id)                     AS voided_purchases,
  MAX(p."deletedAt")                       AS most_recent_void
FROM purchases p
JOIN purchase_lines pl     ON pl."purchaseId" = p.id
JOIN items i               ON i.id            = pl."itemId"
JOIN channels c            ON c.id            = p."channelId"
LEFT JOIN inventory_balances ib
       ON ib."itemId"    = pl."itemId"
      AND ib."channelId" = p."channelId"
WHERE p."deletedAt" IS NOT NULL
  AND p."deletedAt" < :fix_deployed_at::timestamptz
GROUP BY c.name, i.sku, i.name, ib."availableQty", ib."weightedAvgCost"
ORDER BY value_overstated DESC NULLS LAST;

\echo ''
\echo '--- 1b. Total exposure ---'

SELECT
  COUNT(DISTINCT p.id)                              AS voided_purchases,
  SUM(pl.quantity)                                  AS total_phantom_units,
  ROUND(SUM(pl.quantity * ib."weightedAvgCost"), 2) AS total_value_overstated
FROM purchases p
JOIN purchase_lines pl ON pl."purchaseId" = p.id
LEFT JOIN inventory_balances ib
       ON ib."itemId"    = pl."itemId"
      AND ib."channelId" = p."channelId"
WHERE p."deletedAt" IS NOT NULL
  AND p."deletedAt" < :fix_deployed_at::timestamptz;


-- ============================================================================
-- 2. Items whose weighted average cost was corrupted by duplicate lines
-- ============================================================================
-- Balance upserts ran per line off one shared snapshot and wrote
-- weightedAvgCost as a set, so when a purchase listed the same item twice the
-- later line overwrote the earlier one's cost and a whole batch was ignored.
--
-- correct_wac_for_this_purchase is what the purchase alone should have
-- produced had there been no prior stock; stored_wac_now is what the item
-- carries today. They will not match exactly even for unaffected items, since
-- later purchases and transfers legitimately move WAC — treat a large gap as
-- a flag to re-cost the item, not as a precise correction. The true historical
-- WAC is not recoverable from these tables, because WAC is path dependent and
-- no per-movement cost history is kept.
-- ============================================================================
\echo ''
\echo '=== 2. Items with WAC corrupted by duplicate purchase lines ==='

WITH dupes AS (
  SELECT
    pl."purchaseId",
    pl."itemId",
    COUNT(*)                                   AS line_count,
    SUM(pl.quantity)                           AS total_qty,
    SUM(pl.quantity * pl."unitCost")           AS total_value,
    -- what the last-written line left behind: ordered as the code processed them
    (ARRAY_AGG(pl."unitCost" ORDER BY pl.id DESC))[1] AS last_line_unit_cost
  FROM purchase_lines pl
  GROUP BY pl."purchaseId", pl."itemId"
  HAVING COUNT(*) > 1
)
SELECT
  ch.name                                              AS channel,
  i.sku,
  i.name                                               AS item,
  p."purchaseNo",
  p."createdAt"::date                                  AS purchased_on,
  d.line_count                                         AS duplicate_lines,
  d.total_qty,
  ROUND(d.total_value / NULLIF(d.total_qty, 0), 4)     AS correct_wac_for_this_purchase,
  d.last_line_unit_cost                                AS wac_the_bug_would_have_written,
  ib."weightedAvgCost"                                 AS stored_wac_now,
  ROUND(
    ib."weightedAvgCost" - (d.total_value / NULLIF(d.total_qty, 0)), 4
  )                                                    AS gap
FROM dupes d
JOIN purchases p  ON p.id  = d."purchaseId"
JOIN items i      ON i.id  = d."itemId"
JOIN channels ch  ON ch.id = p."channelId"
LEFT JOIN inventory_balances ib
       ON ib."itemId"    = d."itemId"
      AND ib."channelId" = p."channelId"
WHERE p."deletedAt" IS NULL
ORDER BY ABS(COALESCE(ib."weightedAvgCost", 0) - (d.total_value / NULLIF(d.total_qty, 0))) DESC;


-- ============================================================================
-- 3. Stock takes that booked ordinary sales as shrinkage
-- ============================================================================
-- expectedQty was snapshotted when the take opened, but completion applied
-- `increment: discrepancy` to the balance as it then stood, so every movement
-- during the take was deducted twice and the difference posted as shrinkage.
--
-- movement_during_take is the quantity that legitimately left (or arrived)
-- between the take opening and completing. For a negative discrepancy, that
-- movement is the part of the "loss" that was never a loss at all — the stock
-- was sold or transferred, counted correctly, and then deducted a second time.
--
-- stock_takes has no completedAt column, so updatedAt stands in as the
-- completion time; it is set by the same update that marks the take COMPLETED.
-- A take edited afterwards would widen the window and overstate the overlap.
-- ============================================================================
\echo ''
\echo '=== 3. Stock takes that deducted real movement as shrinkage ==='

WITH takes AS (
  SELECT id, "channelId", "createdAt" AS opened_at, "updatedAt" AS completed_at
  FROM stock_takes
  WHERE status = 'COMPLETED'
)
SELECT
  ch.name                     AS channel,
  t.opened_at::date           AS take_opened,
  t.completed_at::date        AS take_completed,
  i.sku,
  i.name                      AS item,
  sti."expectedQty",
  sti."recordedQty",
  sti.discrepancy             AS discrepancy_applied,
  COALESCE(mv.net_movement, 0) AS movement_during_take,
  -- the portion of a recorded loss explained by genuine movement, not shrinkage
  LEAST(ABS(sti.discrepancy), ABS(COALESCE(mv.net_movement, 0))) AS units_wrongly_shrunk,
  ROUND(
    LEAST(ABS(sti.discrepancy), ABS(COALESCE(mv.net_movement, 0)))
    * COALESCE(ib."weightedAvgCost", 0), 2
  )                           AS value_wrongly_shrunk
FROM takes t
JOIN stock_take_items sti ON sti."stockTakeId" = t.id
JOIN items i              ON i.id = sti."itemId"
JOIN channels ch          ON ch.id = t."channelId"
LEFT JOIN inventory_balances ib
       ON ib."itemId" = sti."itemId" AND ib."channelId" = t."channelId"
LEFT JOIN LATERAL (
  SELECT SUM(sm."quantityChange") AS net_movement
  FROM stock_movements sm
  WHERE sm."itemId"    = sti."itemId"
    AND sm."channelId" = t."channelId"
    AND sm."createdAt" >= t.opened_at
    AND sm."createdAt" <  t.completed_at
    -- the correction itself is not drift
    AND sm."movementType" <> 'STOCK_TAKE_CORRECTION'
) mv ON TRUE
WHERE sti."recordedQty" IS NOT NULL
  AND sti.discrepancy IS DISTINCT FROM 0
  AND COALESCE(mv.net_movement, 0) <> 0
ORDER BY value_wrongly_shrunk DESC;

\echo ''
\echo '--- 3b. Shrinkage posted per completed take, and how much is suspect ---'

WITH takes AS (
  SELECT id, "channelId", "createdAt" AS opened_at, "updatedAt" AS completed_at
  FROM stock_takes WHERE status = 'COMPLETED'
)
SELECT
  ch.name                                          AS channel,
  t.opened_at::date                                AS take_opened,
  COUNT(*) FILTER (WHERE sti.discrepancy < 0)      AS items_recorded_short,
  SUM(ABS(sti.discrepancy)) FILTER (WHERE sti.discrepancy < 0) AS units_recorded_short,
  SUM(
    LEAST(ABS(sti.discrepancy), ABS(COALESCE(mv.net_movement, 0)))
  ) FILTER (WHERE sti.discrepancy < 0)             AS units_explained_by_movement
FROM takes t
JOIN stock_take_items sti ON sti."stockTakeId" = t.id
JOIN channels ch          ON ch.id = t."channelId"
LEFT JOIN LATERAL (
  SELECT SUM(sm."quantityChange") AS net_movement
  FROM stock_movements sm
  WHERE sm."itemId"    = sti."itemId"
    AND sm."channelId" = t."channelId"
    AND sm."createdAt" >= t.opened_at
    AND sm."createdAt" <  t.completed_at
    AND sm."movementType" <> 'STOCK_TAKE_CORRECTION'
) mv ON TRUE
WHERE sti."recordedQty" IS NOT NULL
GROUP BY ch.name, t.opened_at
ORDER BY units_explained_by_movement DESC NULLS LAST;


-- ============================================================================
-- 4. Serials stranded at the source channel after a transfer was received
-- ============================================================================
-- The updateMany that relocates serials named no channelId, so the
-- multi-tenant extension scoped it to the caller's channel while the units
-- were still parked at the sender's — it matched nothing for any non-admin
-- receiver and the serials never moved. They are still TRANSFERRED, still at
-- the source, and invisible at the destination that actually holds them.
--
-- Only transfers that reached RECEIVED or DISPUTED are counted: anything
-- still SENT is legitimately in transit, not stranded.
-- ============================================================================
\echo ''
\echo '=== 4. Serials stranded at source after a completed transfer ==='

SELECT
  src.name                AS stranded_at_channel,
  dst.name                AS should_be_at_channel,
  t."transferNo",
  t.status                AS transfer_status,
  t."receivedAt"::date    AS received_on,
  i.sku,
  i.name                  AS item,
  COUNT(s.id)             AS stranded_serials,
  STRING_AGG(s."serialNo", ', ' ORDER BY s."serialNo") AS serial_numbers
FROM transfers t
JOIN transfer_lines tl ON tl."transferId" = t.id
JOIN items i           ON i.id  = tl."itemId"
JOIN channels src      ON src.id = t."fromChannelId"
JOIN channels dst      ON dst.id = t."toChannelId"
JOIN serials s
       ON s."itemId"    = tl."itemId"
      AND s."channelId" = t."fromChannelId"
      AND s.status      = 'TRANSFERRED'
      AND s."deletedAt" IS NULL
WHERE t.status IN ('RECEIVED', 'DISPUTED')
  AND t."receivedAt" < :fix_deployed_at::timestamptz
GROUP BY src.name, dst.name, t."transferNo", t.status, t."receivedAt", i.sku, i.name
ORDER BY stranded_serials DESC;

\echo ''
\echo '--- 4b. Any serial left TRANSFERRED with no open transfer to explain it ---'
-- Catches units orphaned by the cancel() updateMany that flipped every
-- transferred serial of an item, as well as anything the join above misses.

SELECT
  ch.name       AS at_channel,
  i.sku,
  i.name        AS item,
  COUNT(*)      AS orphaned_serials
FROM serials s
JOIN items i    ON i.id  = s."itemId"
JOIN channels ch ON ch.id = s."channelId"
WHERE s.status      = 'TRANSFERRED'
  AND s."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM transfers t
    JOIN transfer_lines tl ON tl."transferId" = t.id
    WHERE tl."itemId"      = s."itemId"
      AND t."fromChannelId" = s."channelId"
      AND t.status          = 'SENT'
  )
GROUP BY ch.name, i.sku, i.name
ORDER BY orphaned_serials DESC;


-- ============================================================================
-- 5. Cross-check: does availableQty still agree with its movement history?
-- ============================================================================
-- A backstop that assumes none of the above. Every path in this codebase
-- writes stock_movements and inventory_balances separately, so the two drift
-- whenever one is written without the other — which is exactly how bugs 1 and
-- 3 manifested. A non-zero drift is not proof of a bug (opening balances and
-- seeded stock have no movement rows), but items appearing here alongside
-- sections 1 or 3 are corroborated.
-- ============================================================================
\echo ''
\echo '=== 5. Balances that disagree with the sum of their movements ==='

SELECT
  ch.name                                    AS channel,
  i.sku,
  i.name                                     AS item,
  ib."availableQty"                          AS balance_says,
  COALESCE(SUM(sm."quantityChange"), 0)      AS movements_say,
  ib."availableQty" - COALESCE(SUM(sm."quantityChange"), 0) AS drift,
  ROUND(
    ABS(ib."availableQty" - COALESCE(SUM(sm."quantityChange"), 0))
    * ib."weightedAvgCost", 2
  )                                          AS drift_value
FROM inventory_balances ib
JOIN items i     ON i.id  = ib."itemId"
JOIN channels ch ON ch.id = ib."channelId"
LEFT JOIN stock_movements sm
       ON sm."itemId"    = ib."itemId"
      AND sm."channelId" = ib."channelId"
      -- TRANSFER_IN_PENDING is a reservation marker, not a balance change:
      -- it is written +qty on dispatch and -qty on receipt and nets to zero,
      -- but a half-finished transfer leaves it unbalanced. Excluded so it
      -- does not masquerade as drift.
      AND sm."movementType" <> 'TRANSFER_IN_PENDING'
GROUP BY ch.name, i.sku, i.name, ib."availableQty", ib."weightedAvgCost"
HAVING ib."availableQty" <> COALESCE(SUM(sm."quantityChange"), 0)
ORDER BY drift_value DESC;

\echo ''
\echo 'Done. Nothing was modified.'
