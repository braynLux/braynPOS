import { prisma } from '../../lib/prisma.js'

export class TemplatesService {
  async findAll(channelId?: string) {
    return prisma.documentTemplate.findMany({
      where: { isActive: true, ...(channelId && { channelId }) },
      orderBy: { name: 'asc' },
    })
  }

  async findById(id: string, channelId?: string) {
    return prisma.documentTemplate.findFirstOrThrow({
      where: { id, ...(channelId && { channelId }) }
    })
  }

  async create(data: { name: string; type: string; content: string; channelId?: string }) {
    return prisma.documentTemplate.create({ data })
  }

  async update(id: string, channelId: string | undefined, data: { name?: string; content?: string; isActive?: boolean }) {
    await this.findById(id, channelId)
    return prisma.documentTemplate.update({ where: { id }, data })
  }
}

export const templatesService = new TemplatesService()
