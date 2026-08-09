import { eventBus } from '../../lib/event-bus.js'
import { loyaltyService } from './loyalty.service.js'
import { prisma } from '../../lib/prisma.js'
import { logger } from '../../lib/logger.js'

/**
 * Loyalty Listener: automatically triggers loyalty point accrual
 * on every sale commit based on the PROFIT MARGIN.
 */
export function startLoyaltyListener() {
  eventBus.on('sale.committed', async (data) => {
    try {
      const sale = await prisma.sale.findUnique({
        where: { id: data.saleId },
        include: {
          items: true,
        },
      })

      if (!sale || !sale.customerId) return

      // Calculate total gross margin for the sale
      const rawMargin = sale.items.reduce((sum, item) => {
        const cost = Number(item.costPriceSnapshot)
        const price = Number(item.unitPrice)
        // Only award points on items where cost is known (> 0)
        if (cost > 0) {
          return sum + (price - cost) * item.quantity
        }
        return sum
      }, 0)

      // FIX: discounts were ignored entirely, so points were awarded on the
      // margin the sale would have made at full price. commitSaleOnce stores
      // Sale.discountAmount as saleDiscount + every line discount, so
      // subtracting it once gives the margin actually earned. A sale grossing
      // 1,000 of raw margin that was discounted by 800 was paying out 20 points
      // instead of 4 — and a sale discounted below cost still paid out.
      const totalMargin = rawMargin - Number(sale.discountAmount ?? 0)

      if (totalMargin > 0) {
        await loyaltyService.earnPoints(sale.customerId, sale.id, totalMargin)
        logger.info({ saleId: sale.id, totalMargin }, '[loyalty-listener] Points awarded based on margin')
      }
    } catch (err) {
      logger.error(
        { err, saleId: data.saleId, event: 'sale.committed' },
        '[loyalty-listener] Failed to process loyalty points'
      )
    }
  })
}
