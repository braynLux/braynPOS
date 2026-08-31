import { prisma } from '../../lib/prisma.js'
import type { SerialStatus } from '@prisma/client'
 
const HQ_SERIAL_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export class SerialsService {
  async findByItem(itemId: string, channelId?: string) {
    return prisma.serial.findMany({
      where: {
        itemId,
        ...(channelId && { channelId }),
      },
      include: {
        channel: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
    })
  }
 
  async searchSerials(query: string, requestingUser: { role: string; channelId: string | null }) {
    const where: any = {
      serialNo: { contains: query, mode: 'insensitive' },
    }
 
    // Role-based filtering
    if (!HQ_SERIAL_ROLES.includes(requestingUser.role)) {
      if (!requestingUser.channelId) {
        throw { statusCode: 400, message: 'User is not assigned to a channel' }
      }
      where.channelId = requestingUser.channelId
    }
 
    return prisma.serial.findMany({
      where,
      take: 10,
      include: {
        item: { select: { id: true, name: true, sku: true } },
        channel: { select: { id: true, name: true, code: true } },
      },
      orderBy: { serialNo: 'asc' },
    })
  }
 
  async findBySerialNo(serialNo: string, requestingUser?: { role: string; channelId: string | null }) {
    const where: any = { serialNo }
    
    // If not admin/super_admin/platform_owner, restrict to user's channel if they have one
    if (requestingUser && !HQ_SERIAL_ROLES.includes(requestingUser.role)) {
      if (!requestingUser.channelId) {
        throw { statusCode: 400, message: 'User is not assigned to a channel' }
      }
      where.channelId = requestingUser.channelId
    }
 
    return prisma.serial.findFirst({
      where,
      include: {
        item: { select: { id: true, name: true, sku: true } },
        channel: { select: { id: true, name: true, code: true } },
      },
    })
  }
 
  async findAvailableInChannel(itemId: string, channelId: string) {
    return prisma.serial.findMany({
      where: {
        itemId,
        channelId,
        status: 'IN_STOCK',
      },
      orderBy: { serialNo: 'asc' },
    })
  }
 
  async create(data: { serialNo: string; itemId: string; channelId: string }) {
    return prisma.serial.create({ data })
  }
 
  async createMany(serials: Array<{ serialNo: string; itemId: string; channelId: string }>) {
    return prisma.serial.createMany({ data: serials })
  }
 
  async updateStatus(id: string, status: SerialStatus, saleId?: string) {
    return prisma.serial.update({
      where: { id },
      data: { status, saleId: saleId ?? null },
    })
  }
 
  async transferSerial(id: string, newChannelId: string) {
    return prisma.serial.update({
      where: { id },
      data: {
        channelId: newChannelId,
        status: 'TRANSFERRED',
      },
    })
  }
 
  async writeOff(id: string, channelId?: string) {
    const serial = await prisma.serial.findFirst({
      where: { id, ...(channelId && { channelId }) },
      select: { id: true },
    })
    if (!serial) {
      throw { statusCode: 404, message: 'Serial not found' }
    }
    return prisma.serial.update({
      where: { id },
      data: { status: 'WRITTEN_OFF' },
    })
  }
}
 
export const serialsService = new SerialsService()
