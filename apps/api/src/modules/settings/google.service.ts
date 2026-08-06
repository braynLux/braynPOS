import { google } from 'googleapis'
import { prisma } from '../../lib/prisma.js'
import { createHmac, timingSafeEqual } from 'crypto'

const STATE_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

function signState(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt: Date.now() })).toString('base64url')
  const signature = createHmac('sha256', STATE_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyState(state: string) {
  const [payload, signature] = state.split('.')
  if (!payload || !signature) {
    throw { statusCode: 400, message: 'Invalid OAuth state' }
  }

  const expected = createHmac('sha256', STATE_SECRET).update(payload).digest('base64url')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw { statusCode: 400, message: 'Invalid OAuth state signature' }
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: string; issuedAt?: number }
  if (!parsed.userId || !parsed.issuedAt || Date.now() - parsed.issuedAt > 10 * 60 * 1000) {
    throw { statusCode: 400, message: 'Expired OAuth state' }
  }
  return parsed.userId
}

export class GoogleService {
  private oauth2Client

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID?.trim(),
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
      process.env.GOOGLE_REDIRECT_URI?.trim()
    )
  }

  getAuthUrl(userId: string) {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents',
    ]

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: signState(userId),
    })
  }

  async handleCallback(code: string, state: string) {
    const userId = verifyState(state)
    const { tokens } = await this.oauth2Client.getToken(code)
    
    this.oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    // Assuming we attach the Google Account to the Channel
    // As per the schema update, it was added to User. I'll update the User.
    const userEmail = userInfo.data.email || ''

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        googleEmail: userEmail,
      },
    })

    return { email: userEmail }
  }

  async getAuthenticatedClient(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { googleAccessToken: true, googleRefreshToken: true, googleTokenExpiresAt: true },
    })

    if (!user.googleAccessToken) {
      throw { statusCode: 400, message: 'Google account not connected.' }
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID?.trim(),
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
      process.env.GOOGLE_REDIRECT_URI?.trim()
    )

    client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
      expiry_date: user.googleTokenExpiresAt?.getTime(),
    })

    client.on('tokens', async (tokens) => {
      await prisma.user.update({
        where: { id: userId },
        data: {
          googleAccessToken: tokens.access_token,
          ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
          ...(tokens.expiry_date ? { googleTokenExpiresAt: new Date(tokens.expiry_date) } : {})
        }
      })
    })

    return client
  }
}

export const googleService = new GoogleService()
