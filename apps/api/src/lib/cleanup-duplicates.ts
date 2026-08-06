import { basePrisma } from './prisma.js'

export async function cleanupDuplicateItems() {
  if (process.env.RUN_DUPLICATE_ITEM_CLEANUP !== 'true') {
    console.log('âœ… [CLEANUP] Duplicate item cleanup skipped. Set RUN_DUPLICATE_ITEM_CLEANUP=true to run it explicitly.')
    return
  }

  console.log('🧹 [CLEANUP] Checking for duplicate items...')

  // Find items grouped by name that have more than 1 entry
  const duplicates = await basePrisma.item.groupBy({
    by: ['name'],
    _count: {
      name: true
    },
    having: {
      name: {
        _count: {
          gt: 1
        }
      }
    },
    where: {
      deletedAt: null
    }
  })

  let deletedCount = 0

  for (const dup of duplicates) {
    const items = await basePrisma.item.findMany({
      where: { name: dup.name, deletedAt: null },
      orderBy: { createdAt: 'asc' }
    })

    if (items.length > 1) {
      // Keep the first one (oldest), delete the rest
      const keep = items[0]
      const toDelete = items.slice(1)

      for (const item of toDelete) {
        // Hard delete if no movements, otherwise soft delete
        const movementsCount = await basePrisma.stockMovement.count({ where: { itemId: item.id } })
        
        if (movementsCount === 0) {
          await basePrisma.item.delete({ where: { id: item.id } })
        } else {
          await basePrisma.item.update({
            where: { id: item.id },
            data: { deletedAt: new Date(), sku: `${item.sku}-DUP-${Date.now()}` }
          })
        }
        deletedCount++
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`✅ [CLEANUP] Removed/Soft-deleted ${deletedCount} duplicate items.`)
  } else {
    console.log('✅ [CLEANUP] No duplicate items found.')
  }
}
