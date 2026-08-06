// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/whatsapp.service.ts
// Fixes:
//   1. console.log('[WhatsApp] REST API Response:', data) — Africa's
//      Talking API responses may include the phone number, message ID,
//      and delivery status. Logging the full response to stdout leaks
//      the admin phone number on every alert. Removed.
//   2. console.error on failure now logs only the error message, not
//      the full error object which may contain the apiKey in stack frames.
// ══════════════════════════════════════════════════════════════════════

export class WhatsAppService {
  private static AT_USERNAME  = process.env.AT_USERNAME             || 'sandbox'
  private static AT_API_KEY   = process.env.AT_API_KEY              || ''
  private static ADMIN_PHONE  = process.env.ADMIN_WHATSAPP_PHONE    || ''

  static async sendAlert(message: string, to: string = this.ADMIN_PHONE) {
    if (!this.AT_API_KEY || !to) {
      console.warn('[WhatsApp] Integration disabled (missing key or phone)')
      return null
    }

    try {
      const response = await fetch('https://api.africastalking.com/version1/messaging', {
        method:  'POST',
        headers: {
          'Accept':       'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'apiKey':       this.AT_API_KEY,
        },
        body: new URLSearchParams({
          username: this.AT_USERNAME,
          to,
          message:  `🚨 *LUX CORE ALERT*\n\n${message}`,
          from:     process.env.AT_WHATSAPP_NUMBER || '',
        }),
      })

      const data = await response.json()

      // FIX 1: Removed console.log of full API response — may contain
      // phone numbers and message IDs that should not appear in logs.
      if (!response.ok) {
        console.warn('[WhatsApp] API returned non-OK status:', response.status)
      }

      return data
    } catch (err: any) {
      // FIX 2: Log only the message, not the full error object which
      // may contain apiKey values in stack frames.
      console.error('[WhatsApp] Send failed:', err?.message ?? 'Unknown error')
      return null
    }
  }

  static async sendApprovalRequest(action: string, details: string, ticketId: string) {
    const msg = `🛠 *APPROVAL REQUIRED*\n\n*Action:* ${action}\n*Details:* ${details}\n\nReply 'YES ${ticketId}' to approve.`
    return this.sendAlert(msg)
  }
}
