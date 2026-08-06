'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ReceiptData {
  receiptNo: string
  date:      string
  channel:   { name: string; address?: string; phone?: string; email?: string }
  items:     Array<{ name: string; quantity: number; unitPrice: number; lineTotal: number }>
  totals:    { subtotal: number; total: number; discount: number }
  payments:  Array<{ method: string; amount: number }>
  cashier?:   string
}

export default function PublicReceiptPage() {
  const { id } = useParams()
  const [data, setData] = useState<ReceiptData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (id) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
      fetch(`${apiUrl}/receipts/public/${id}`)
        .then(res => {
          if (!res.ok) throw new Error('Receipt not found or expired')
          return res.json()
        })
        .then(setData)
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [id])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc' }}>
      <div className="spinner"></div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc', padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚠️</div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' }}>Unavailable</h1>
      <p style={{ color: '#64748b', marginTop: 8 }}>{error}</p>
      <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '10px 20px', background: '#3b82f6', color: 'white', borderRadius: 8, border: 'none', fontWeight: 600 }}>Retry</button>
    </div>
  )

  if (!data) return null

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh', padding: '20px 10px' }}>
      <div style={{ 
        maxWidth: 450, 
        margin: '0 auto', 
        background: 'white', 
        borderRadius: 16, 
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>
        {/* Header Decore */}
        <div style={{ height: 8, background: 'linear-gradient(90deg, #3b82f6, #2563eb)' }}></div>
        
        <div style={{ padding: 30 }}>
          {/* Business Info */}
          <div style={{ textAlign: 'center', marginBottom: 30 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>{data.channel.name}</h1>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>{data.channel.address}</p>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '4px 0 0' }}>{data.channel.phone}</p>
          </div>

          <div style={{ borderTop: '1px dashed #e2e8f0', margin: '20px 0' }}></div>

          {/* Sale Metadata */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: '0.875rem' }}>
            <div>
              <div style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>Receipt No</div>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{data.receiptNo}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>Date</div>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{new Date(data.date).toLocaleDateString()}</div>
            </div>
          </div>

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9' }}>
                <th style={{ padding: '12px 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Description</th>
                <th style={{ padding: '12px 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '12px 0' }}>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>{item.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.quantity} x {item.unitPrice.toLocaleString()}</div>
                  </td>
                  <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                    {item.lineTotal.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals Section */}
          <div style={{ background: '#f8fafc', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.875rem', color: '#64748b' }}>
              <span>Subtotal</span>
              <span>{data.totals.subtotal.toLocaleString()}</span>
            </div>
            {data.totals.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.875rem', color: '#ef4444' }}>
                <span>Discount</span>
                <span>-{data.totals.discount.toLocaleString()}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '2px dashed #e2e8f0' }}>
              <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '1.1rem' }}>TOTAL</span>
              <span style={{ fontWeight: 800, color: '#2563eb', fontSize: '1.1rem' }}>{data.totals.total.toLocaleString()}</span>
            </div>
          </div>

          {/* Payments */}
          <div style={{ marginTop: 24 }}>
            <div style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>Payment Method</div>
            {data.payments.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#475569' }}>
                <span>{p.method.replace('_', ' ')}</span>
                <span style={{ fontWeight: 600 }}>{p.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: 40, paddingBottom: 10 }}>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', fontStyle: 'italic' }}>Thank you for shopping with us!</p>
            <div style={{ marginTop: 16, opacity: 0.5 }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: '#1e293b' }}>POWERED BY LUX POS</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Print Button for Customer */}
      <div style={{ textAlign: 'center', marginTop: 24 }} className="no-print">
        <button 
          onClick={() => window.print()}
          style={{ 
            background: 'white', 
            color: '#1e293b', 
            border: '1px solid #e2e8f0', 
            padding: '10px 20px', 
            borderRadius: 8, 
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          🖨️ Print or Save as PDF
        </button>
      </div>
    </div>
  )
}
