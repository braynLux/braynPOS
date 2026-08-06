import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import './globals.css'
import './print.css'
export const metadata: Metadata = {
  title: 'LUX POS — Hybrid Edition',
  description: 'Enterprise AI Ingestion POS System — Double-Entry Ledger, CRDT Offline, Temporal Payroll',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Toaster position="top-right" />
        {children}
      </body>
    </html>
  )
}
