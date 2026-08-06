'use client'
import React, { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { useParams } from 'next/navigation'

interface CatalogItem {
  id: string
  name: string
  images: string[]
  price: number
  category: { name: string } | null
}

export default function PublicCatalogPage() {
  const { slug } = useParams() as { slug: string }
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [branding, setBranding] = useState<any>(null)
  const [business, setBusiness] = useState<any>(null)

  useEffect(() => {
    // In a real multi-tenant app, we'd lookup by slug. 
    // For this ERP modernization, we'll fetch global public items.
    const fetchCatalog = async () => {
      try {
        const catalogSlug = encodeURIComponent(slug)
        const [itemsRes, settingsRes] = await Promise.all([
          api.get<CatalogItem[]>(`/public/catalog/${catalogSlug}/items`),
          api.get<any>(`/public/catalog/${catalogSlug}/branding`)
        ])
        setItems(itemsRes)
        setBranding(settingsRes.branding)
        setBusiness(settingsRes.business)
      } catch (e) {
        console.error('Failed to load catalog:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchCatalog()
  }, [slug])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f9fafb' }}>
        <div className="animate-pulse" style={{ textAlign: 'center' }}>
           <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#e5e7eb', margin: '0 auto 16px' }} />
           <p style={{ color: '#6b7280' }}>Loading Catalog...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', paddingBottom: 80 }}>
      {/* Header */}
      <header style={{ background: branding?.primaryColor || '#0ea5e9', color: 'white', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {branding?.logo ? (
            <img src={branding.logo} style={{ width: 80, height: 80, borderRadius: 16, background: 'white', padding: 10, marginBottom: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} alt="Logo" />
          ) : (
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏛️</div>
          )}
          <h1 style={{ margin: 0, fontSize: '1.8rem' }}>{business?.businessName || 'Our Catalog'}</h1>
          <p style={{ opacity: 0.9, marginTop: 8 }}>{branding?.tagline || 'Welcome to our digital storefront'}</p>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 24 }}>
            {branding?.tiktokUrl && <a href={branding.tiktokUrl} target="_blank" rel="noreferrer" style={{ color: 'white', fontSize: '1.5rem', transition: 'transform 0.2s' }}>📱</a>}
            {branding?.instagramUrl && <a href={branding.instagramUrl} target="_blank" rel="noreferrer" style={{ color: 'white', fontSize: '1.5rem', transition: 'transform 0.2s' }}>📸</a>}
            {branding?.facebookUrl && <a href={branding.facebookUrl} target="_blank" rel="noreferrer" style={{ color: 'white', fontSize: '1.5rem', transition: 'transform 0.2s' }}>📘</a>}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
          {items.map(item => (
            <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'transform 0.2s' }}>
              <div style={{ height: 240, background: '#f3f4f6', position: 'relative' }}>
                {item.images?.[0] ? (
                  <img src={item.images[0]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={item.name} />
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: '3rem' }}>📦</div>
                )}
                {item.category && (
                  <span style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>{item.category.name}</span>
                )}
              </div>
              <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>{item.name}</h3>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: branding?.primaryColor || '#0ea5e9', marginBottom: 16 }}>
                  {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(item.price)}
                </div>
                <button 
                  style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: '#25D366', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={() => {
                    const text = encodeURIComponent(`Hello, I'm interested in ordering ${item.name} (${new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(item.price)}) from your catalog.`)
                    window.open(`https://wa.me/${branding?.whatsappNumber || business?.phone}?text=${text}`, '_blank')
                  }}
                >
                  🟢 Order via WhatsApp
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '100px 0', color: '#9ca3af' }}>
              <p style={{ fontSize: '1.2rem' }}>No items in the catalog yet.</p>
            </div>
          )}
        </div>
      </main>

      <footer style={{ textAlign: 'center', padding: '40px', color: '#9ca3af', fontSize: '0.85rem' }}>
        Powered by LUX POS Digital Catalog
      </footer>
    </div>
  )
}
