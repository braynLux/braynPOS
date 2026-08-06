'use client'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'

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

// Virtual numpad keys
const NUMPAD_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

export function ManagerPinModal({ action, contextId, marginPercent, onApproved, onCancel }: ManagerPinModalProps) {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { user, accessToken } = useAuthStore()

  const handleKey = (key: string) => {
    if (loading) return
    setError('')
    if (key === 'C') { setPin(''); return }
    if (key === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (pin.length >= 8) return
    setPin(p => p + key)
  }

  const handleSubmit = async () => {
    if (!pin || pin.length < 4) { setError('PIN must be at least 4 digits'); return }
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

  // Auto-submit when 4 digits entered (common PIN length)
  // Uncomment if desired:
  // useEffect(() => { if (pin.length === 4) handleSubmit() }, [pin])

  const actionLabel = action.replace(/_/g, ' ')

  return (
    <div className="modal-overlay no-print">
      <div className="modal-content" style={{ maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🛡️</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Manager Approval</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 6 }}>
            Override for <strong style={{ color: 'var(--text-primary)' }}>{actionLabel}</strong> requires a manager PIN
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

        {/* PIN display */}
        <div className="pin-display" aria-label="PIN entered" aria-live="polite">
          {pin.length === 0
            ? <span style={{ color: 'var(--text-muted)', fontSize: '1rem', letterSpacing: 'normal' }}>Enter PIN</span>
            : '●'.repeat(pin.length)
          }
        </div>

        {/* Virtual numpad — no system keyboard on mobile */}
        <div className="pin-numpad" role="group" aria-label="PIN keypad">
          {NUMPAD_KEYS.map((key) => (
            <button
              key={key}
              className={`pin-key ${key === 'C' ? 'pin-clear' : ''} ${key === '⌫' ? 'pin-delete' : ''}`}
              onClick={() => handleKey(key)}
              disabled={loading}
              aria-label={key === '⌫' ? 'Backspace' : key === 'C' ? 'Clear' : key}
              type="button"
            >
              {key}
            </button>
          ))}
        </div>

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
            disabled={loading || pin.length < 4}
          >
            {loading ? 'Verifying...' : 'Approve ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}
