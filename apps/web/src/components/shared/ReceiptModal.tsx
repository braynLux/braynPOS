'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { BluetoothPrinter } from '@/lib/bluetooth-printer'
import { toast } from 'react-hot-toast'

interface ReceiptData {
  receiptNo: string
  date:      string
  channel:   { name: string; address?: string; phone?: string; email?: string }
  customer?: { name: string; phone?: string }
  items:     Array<{ name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number }>
  totals:    { subtotal: number; discount: number; tax: number; total: number }
  payments:  Array<{ method: string; amount: number }>
  cashier?:   string
  vatPIN?:    string
}

interface ReceiptSettings {
  receiptHeader?: string
  receiptFooter?: string
  showLogo?: boolean
  showBarcode?: boolean
  paperWidth?: string
  fontSize?: string
  showBusinessName?: boolean
  showBusinessAddress?: boolean
  showBusinessPhone?: boolean
  showBusinessEmail?: boolean
  showVatNumber?: boolean
  showCashierName?: boolean
  showCustomerInfo?: boolean
  showPoweredBy?: boolean
}

interface ReceiptModalProps {
  saleId:  string
  onClose: () => void
}

export function ReceiptModal({ saleId, onClose }: ReceiptModalProps) {
  const token = useAuthStore((s) => s.accessToken)
  const [data, setData]     = useState<ReceiptData | null>(null)
  const [settings, setSettings] = useState<ReceiptSettings>({
    showBusinessName: true, showBusinessAddress: true, showBusinessPhone: true, paperWidth: '80mm', fontSize: 'md', showPoweredBy: true, showLogo: true, showBarcode: true
  })
  const [branding, setBranding] = useState<{ logo?: string }>({})
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [qrCode, setQrCode] = useState<string>('')

  useEffect(() => {
    const generateQR = async () => {
      if (data?.receiptNo && settings.showBarcode) {
        try {
          const url = await QRCode.toDataURL(data.receiptNo, { width: 128, margin: 1 })
          setQrCode(url)
        } catch (err) {
          console.error('QR Gen failed', err)
        }
      }
    }
    generateQR()
  }, [data?.receiptNo, settings.showBarcode])
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  useEffect(() => {
    if (token && saleId) {
      Promise.all([
        api.get<ReceiptData>(`/receipts/${saleId}`, token),
        api.get<any>('/dashboard/settings', token)
      ]).then(([rData, sData]) => {
        setData(rData)
        if (sData.receiptSettings) setSettings(sData.receiptSettings)
        if (sData.brandingSettings) setBranding(sData.brandingSettings)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    }
  }, [token, saleId])

  const handlePrint = () => window.print()

  const handleBluetoothPrint = async () => {
    if (!data) return
    setPrinting(true)
    const tid = toast.loading('Connecting to Bluetooth Printer...')
    try {
      const bytes = BluetoothPrinter.generateEscPos(data, settings)
      await BluetoothPrinter.print(bytes)
      toast.success('Print job sent!', { id: tid })
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Bluetooth Print failed', { id: tid })
    } finally {
      setPrinting(false)
    }
  }

  const handleShare = async () => {
    if (!data) return
    const text = formatReceiptText(data, settings)

    if (navigator.share) {
      try {
        await navigator.share({ title: `Receipt ${data.receiptNo}`, text })
        return
      } catch { /* ignored */ }
    }

    try {
      await navigator.clipboard.writeText(text)
      alert('Receipt copied to clipboard')
    } catch {
      alert('Unable to share receipt')
    }
  }

  const handleWhatsAppShare = () => {
    if (!data) return
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const publicLink = `${baseUrl}/p/r/${saleId}`
    
    // Audit finding: Automated CRM Lead Capture
    const promoText = "\n\n🎁 *SPECIAL OFFER:* Show this message on your next visit for 5% OFF your next purchase! 🛒"
    
    const text = `*Receipt from ${data.channel.name}*\n` +
                 `ID: ${data.receiptNo}\n` +
                 `Total: ${data.totals.total.toLocaleString()}\n\n` +
                 `View your full digital receipt here:\n${publicLink}` +
                 promoText
    
    const encodedText = encodeURIComponent(text)
    const phone = data.customer?.phone?.replace(/\D/g, '') || ''
    window.open(`https://wa.me/${phone}?text=${encodedText}`, '_blank')
  }

  if (loading) return null

  return (
    <div className="modal-overlay no-print">
      <style>{`
        #receipt-print-area * {
          background-color: transparent !important;
          color: #000000 !important;
        }
        .btn-whatsapp {
          background-color: #25D366 !important;
          color: white !important;
        }
        .btn-whatsapp:hover {
          background-color: #128C7E !important;
        }
        #receipt-print-area {
          background-color: #ffffff !important;
        }
        #receipt-print-area table, 
        #receipt-print-area tr, 
        #receipt-print-area td, 
        #receipt-print-area th {
          background-color: transparent !important;
          border-color: #eee !important;
        }
      `}</style>
      <div className="card modal-content" style={{ maxWidth: 400, padding: 0, background: '#ffffff' }}>
        {/* Receipt body */}
        <div
          id="receipt-print-area"
          style={{ 
            padding: settings.paperWidth === '58mm' ? '12px' : '24px', 
            background: '#ffffff', 
            color: '#000000', 
            fontFamily: "'Courier New', Courier, monospace",
            width: '100%',
            maxWidth: settings.paperWidth === '58mm' ? '300px' : '400px',
            margin: '0 auto',
            boxSizing: 'border-box',
            fontSize: settings.fontSize === 'sm' ? '0.75rem' : settings.fontSize === 'lg' ? '1.05rem' : '0.9rem'
          }}
        >
          {settings.receiptHeader && (
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: '0.8rem', fontStyle: 'italic' }}>
              {settings.receiptHeader}
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            {settings.showLogo && branding.logo && (
              <div style={{ marginBottom: 12 }}>
                <img src={branding.logo} style={{ maxWidth: 100, maxHeight: 60, objectFit: 'contain', filter: 'grayscale(1)' }} alt="Business Logo" />
              </div>
            )}
            {settings.showBusinessName !== false && (
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#000', textTransform: 'uppercase' }}>{data?.channel.name}</h2>
            )}
            {settings.showBusinessAddress !== false && data?.channel.address && data.channel.address !== 'None' && (
              <p style={{ margin: '4px 0', color: '#000', fontSize: '0.85rem' }}>
                {data.channel.address}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontSize: '0.85rem' }}>
              {settings.showBusinessPhone !== false && data?.channel.phone && (
                <p style={{ margin: 0, color: '#000' }}>TEL: {data.channel.phone}</p>
              )}
              {settings.showBusinessEmail && data?.channel.email && (
                <p style={{ margin: 0, color: '#000' }}>{data.channel.email}</p>
              )}
              {settings.showVatNumber && data?.vatPIN && (
                <p style={{ margin: 0, color: '#000', fontWeight: 600 }}>VAT/PIN: {data.vatPIN}</p>
              )}
            </div>
          </div>

          <div style={{ borderBottom: '2px solid #000', marginBottom: 12 }} />

          <div style={{ marginBottom: 12, color: '#000', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700 }}>ID: {data?.receiptNo}</span>
              <span>{data ? new Date(data.date).toLocaleString() : ''}</span>
            </div>
            {settings.showCashierName && data?.cashier && (
              <div style={{ marginTop: 4 }}>Served by: <span style={{ fontWeight: 600 }}>{data.cashier}</span></div>
            )}
            {settings.showCustomerInfo && data?.customer && (
              <div style={{ marginTop: 4 }}>Customer: <span style={{ fontWeight: 600 }}>{data.customer.name}</span></div>
            )}
          </div>

          <div style={{ borderBottom: '1px dashed #333', marginBottom: 12 }} />

          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', background: 'transparent' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #000' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#000' }}>ITEM</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#000' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '8px 0', verticalAlign: 'top', color: '#000' }}>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                    <div style={{ fontSize: '0.75rem' }}>{item.quantity} x {item.unitPrice.toLocaleString()}</div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 0', color: '#000', verticalAlign: 'top', fontWeight: 700 }}>
                    {item.lineTotal.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ borderTop: '1px dashed #333', marginTop: 12, paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#000', fontSize: '0.85rem' }}>
              <span>Subtotal</span>
              <span>{data?.totals.subtotal.toLocaleString()}</span>
            </div>
            {data?.totals.discount ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#000', fontSize: '0.85rem' }}>
                <span>Discount</span>
                <span>-{data.totals.discount.toLocaleString()}</span>
              </div>
            ) : null}
            {data?.totals.tax ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#000', fontSize: '0.85rem' }}>
                <span>Tax</span>
                <span>{data.totals.tax.toLocaleString()}</span>
              </div>
            ) : null}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              fontWeight: 800, 
              fontSize: '1.3rem', 
              marginTop: 8, 
              color: '#000', 
              borderTop: '2px solid #000', 
              borderBottom: '2px solid #000',
              padding: '10px 0' 
            }}>
              <span>TOTAL</span>
              <span>{data?.totals.total.toLocaleString()}</span>
            </div>
          </div>

          <div style={{ marginTop: 20, fontSize: '0.85rem', color: '#000' }}>
            <div style={{ fontWeight: 800, marginBottom: 8, borderBottom: '1px solid #ddd', paddingBottom: 4 }}>PAYMENTS</div>
            {data?.payments.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span>{p.method.replace('_', ' ')}</span>
                <span style={{ fontWeight: 600 }}>{p.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 32, fontSize: '0.85rem', color: '#000' }}>
            {settings.receiptFooter && <p style={{ marginBottom: 12, fontWeight: 500 }}>{settings.receiptFooter}</p>}
            
            {settings.showBarcode && qrCode && (
              <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', opacity: 0.8 }}>VERIFY RECEIPT</div>
                <img src={qrCode} alt="Receipt QR" style={{ width: 120, height: 120, border: '1px solid #000', padding: 4 }} />
                <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{data?.receiptNo}</div>
              </div>
            )}

            {settings.showPoweredBy !== false && (
               <div style={{ marginTop: 20 }}>
                 <p style={{ opacity: 0.6, fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', margin: 0 }}>POWERED BY LUX POS</p>
                 <p style={{ fontSize: '0.5rem', opacity: 0.4 }}>v2.1.0-stab</p>
               </div>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="btn btn-whatsapp" style={{ gridColumn: '1 / -1' }} onClick={handleWhatsAppShare}>
            📲 Send via WhatsApp
          </button>
          
          <button className="btn btn-primary" onClick={handleBluetoothPrint} disabled={printing}>
            {printing ? '⏳ Printing...' : '🔵 Bluetooth Print'}
          </button>

          {isMobile ? (
            <button className="btn btn-ghost" onClick={handleShare}>
              📤 Share
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={handlePrint}>
              🖨️ Browser Print
            </button>
          )}

          <button className="btn btn-ghost" onClick={onClose}>
            ✓ Done
          </button>
        </div>
      </div>
    </div>
  )
}

function formatReceiptText(data: ReceiptData, settings: ReceiptSettings): string {
  const lines = [
    settings.showBusinessName !== false ? data.channel.name.toUpperCase() : '',
    settings.showBusinessAddress !== false ? data.channel.address || '' : '',
    settings.showBusinessPhone !== false ? `TEL: ${data.channel.phone || 'N/A'}` : '',
    '──────────────────────',
    `ID: ${data.receiptNo}`,
    `Date: ${new Date(data.date).toLocaleString()}`,
    settings.showCashierName && data.cashier ? `Cashier: ${data.cashier}` : '',
    settings.showCustomerInfo && data.customer ? `Customer: ${data.customer.name}` : '',
    '──────────────────────',
    ...data.items.map(i => `${i.name}\n  ${i.quantity} x ${i.unitPrice.toLocaleString()}  ${i.lineTotal.toLocaleString()}`),
    '──────────────────────',
    `Subtotal: ${data.totals.subtotal.toLocaleString()}`,
    data.totals.discount ? `Discount: -${data.totals.discount.toLocaleString()}` : '',
    data.totals.tax ? `Tax: ${data.totals.tax.toLocaleString()}` : '',
    '──────────────────────',
    `TOTAL: ${data.totals.total.toLocaleString()}`,
    '──────────────────────',
    ...data.payments.map(p => `${p.method.replace('_', ' ')}: ${p.amount.toLocaleString()}`),
    '',
    settings.receiptFooter || '',
    settings.showPoweredBy !== false ? 'Powered by LUX POS' : '',
  ]
  return lines.filter(Boolean).join('\n')
}
