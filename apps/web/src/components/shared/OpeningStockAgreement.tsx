'use client'
import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

interface OpeningStockAgreementProps {
  onAgree: () => void
  isAgreed: boolean
}

export function OpeningStockAgreement({ onAgree, isAgreed }: OpeningStockAgreementProps) {
  if (isAgreed) {
    return (
      <div style={{ 
        padding: '12px 20px', 
        background: 'rgba(var(--success-rgb), 0.1)', 
        border: '1px solid var(--success)', 
        borderRadius: 8, 
        display: 'flex', 
        alignItems: 'center', 
        gap: 12,
        marginBottom: 20,
        color: 'var(--success)'
      }}>
        <CheckCircle2 size={18} />
        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
          Opening Stock Window is ACTIVE. You have agreed to the terms.
        </span>
      </div>
    )
  }

  return (
    <div style={{ 
      padding: '20px', 
      background: 'rgba(var(--accent-rgb), 0.08)', 
      border: '1px solid var(--accent)', 
      borderRadius: 12, 
      marginBottom: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }}>
      <div style={{ display: 'flex', gap: 12, color: 'var(--accent)' }}>
        <AlertCircle size={24} style={{ flexShrink: 0 }} />
        <div>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem' }}>📥 Opening Stock Window Open</h4>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            The administrator has opened the global window for adding **Opening Stock**. 
            Adding items as &quot;Opening Stock&quot; will initialize inventory levels **without generating a financial transaction (Purchase/Expense)**. 
            This should only be used for existing items currently in your store.
          </p>
        </div>
      </div>
      
      <button 
        className="btn btn-primary" 
        onClick={onAgree}
        style={{ width: 'fit-content', padding: '10px 24px' }}
      >
        I Understand & Agree to Continue
      </button>
    </div>
  )
}
