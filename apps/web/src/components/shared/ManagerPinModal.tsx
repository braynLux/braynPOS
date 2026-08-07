'use client'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

// FIX: There is no separate short numeric PIN on the User model — the
// backend checks this value against the manager's full account
// passwordHash (see manager-approve.routes.ts). A numeric-only virtual
// keypad capped at 8 digits could never produce a real account password
// (letters, symbols, 9+ characters — e.g. the seeded default "Admin@123"),
// making manager approval unusable for every real account. This must be
// the manager's actual login password, entered as normal text.

interface ManagerPinModalProps {
  action:
    | 'void'
    | 'refund'
    | 'discount_override'
    | 'price_below_min'
    | 'negative_margin'
    | 'customer_delete'
    | 'item_create'
    | 'item_update'
    | 'item_delete'
    | 'purchase_delete'
    | 'expense_delete'
    | 'credit_sale'
    | 'channel_create'
    | 'channel_update'
    | 'channel_delete'
  contextId:  string
  marginPercent?: number
  onApproved: (token: string) => void
  onCancel:   () => void
}

export function ManagerPinModal({ action, contextId, marginPercent, onApproved, onCancel }: ManagerPinModalProps) {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { user, accessToken } = useAuthStore()

  const handleSubmit = async () => {
    if (!pin) { setError('Enter the manager\'s password'); return }
    const channelId = user?.channelId || user?.channel?.id
    if (!accessToken) { setError('Your session has expired. Sign in again.'); return }
    if (!channelId) { setError('No channel is assigned for this approval.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ approvalToken: string }>('/auth/manager-approve', {
        action, pin, contextId, channelId, marginPercent,
      }, accessToken)
      onApproved(res.approvalToken)
    } catch (err: any) {
      setError(err.message || 'Verification failed. Try again.')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  const actionLabel = action.replace(/_/g, ' ')

  return (
    <div className="modal-overlay no-print">
      <div className="modal-content" style={{ maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🛡️</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Manager Approval</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 6 }}>
            Override for <strong style={{ color: 'var(--text-primary)' }}>{actionLabel}</strong> requires a manager&apos;s password
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: 'var(--danger)', padding: '10px 14px', borderRadius: 'var(--radius-md)',
            fontSize: '0.85rem', marginBottom: 16, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <input
          type="password"
          className="input"
          style={{ width: '100%', textAlign: 'center', fontSize: '1.1rem', letterSpacing: '0.15em' }}
          placeholder="Manager password"
          value={pin}
          onChange={e => { setError(''); setPin(e.target.value) }}
          onKeyDown={e => { if (e.key === 'Enter' && pin && !loading) handleSubmit() }}
          disabled={loading}
          autoFocus
          aria-label="Manager password"
        />

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !pin}
          >
            {loading ? 'Verifying...' : 'Approve ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}
