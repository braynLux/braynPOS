import { prisma } from '../../lib/prisma.js'
import { signAccessToken } from '../../lib/jwt.js'
import * as OTPAuth from 'otpauth'
import { randomBytes } from 'crypto'
import argon2 from 'argon2'

const MFA_ISSUER = process.env.MFA_ISSUER || 'LUX POS'

export class MfaService {
  /**
   * Generate a new TOTP secret and provisioning URI for the user.
   * The user scans the QR code in their authenticator app.
   */
  async setupMfa(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    const totp = new OTPAuth.TOTP({
      issuer: MFA_ISSUER,
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    })

    // Store the secret (encrypted at rest in production)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: totp.secret.base32 },
    })

    return {
      secret: totp.secret.base32,
      uri: totp.toString(),
    }
  }

  /**
   * Verify a TOTP code and enable MFA for the user.
   * Called during initial MFA setup to confirm the user has the correct secret.
   */
  async enableMfa(userId: string, code: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    if (!user.mfaSecret) {
      throw { statusCode: 400, message: 'MFA setup not initiated. Call setup-mfa first.' }
    }

    const totp = new OTPAuth.TOTP({
      issuer: MFA_ISSUER,
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
    })

    const delta = totp.validate({ token: code, window: 1 })
    if (delta === null) {
      throw { statusCode: 401, message: 'Invalid TOTP code' }
    }

    // Generate 10 recovery codes (8 chars each)
    const rawCodes = Array.from({ length: 10 }, () => randomBytes(4).toString('hex').toUpperCase())
    const hashed   = await Promise.all(rawCodes.map(c => argon2.hash(c)))

    await prisma.user.update({
      where: { id: userId },
      data: { 
        mfaEnabled: true,
        mfaRecoveryCodes: hashed as any,
      },
    })

    return { 
      message: 'MFA enabled successfully',
      recoveryCodes: rawCodes 
    }
  }

  /**
   * Verify an 8-character recovery code and disable MFA.
   * Recovery codes are one-time use and destructive — they disable MFA
   * so the user can regain access and re-configure it.
   */
  async verifyRecoveryCode(userId: string, code: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const codes = user.mfaRecoveryCodes || []
    let matchedIndex = -1

    for (let i = 0; i < codes.length; i++) {
      const storedHash = codes[i]
      if (storedHash && await argon2.verify(storedHash, code.toUpperCase())) {
        matchedIndex = i
        break
      }
    }

    if (matchedIndex === -1) {
      throw { statusCode: 401, message: 'Invalid recovery code' }
    }

    // Remove the used code or just disable MFA entirely (safer for recovery flow)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] as any },
    })

    return { message: 'MFA disabled via recovery code' }
  }

  /**
   * Verify a TOTP code during login and issue a full access token.
   */
  async verifyMfaLogin(tempToken: string, code: string) {
    // Decode the temp token (mfaVerified: false)
    const { verifyToken } = await import('../../lib/jwt.js')
    const payload = verifyToken(tempToken)

    if (payload.mfaVerified) {
      throw { statusCode: 400, message: 'Token already MFA-verified' }
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
    })

    if (!user.mfaSecret) {
      throw { statusCode: 400, message: 'MFA not configured for this user' }
    }

    const totp = new OTPAuth.TOTP({
      issuer: MFA_ISSUER,
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
    })

    const delta = totp.validate({ token: code, window: 1 })
    if (delta === null) {
      throw { statusCode: 401, message: 'Invalid TOTP code' }
    }

    // Issue full token with mfaVerified: true
    const { signRefreshToken } = await import('../../lib/jwt.js')
    const accessToken = signAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      channelId: user.channelId,
      mfaVerified: true,
    })
    const refreshToken = signRefreshToken(user.id)

    return { accessToken, refreshToken }
  }

  /**
   * Disable MFA for a user (admin action).
   */
  async disableMfa(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    })

    return { message: 'MFA disabled' }
  }
}

export const mfaService = new MfaService()
