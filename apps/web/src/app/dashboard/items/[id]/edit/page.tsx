'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import { ScannerModal } from '@/components/shared/ScannerModal'
import { toast } from 'react-hot-toast'

interface Category { id: string; name: string; parentId: string | null; children?: Category[] }
interface Brand { id: string; name: string }
interface Supplier { id: string; name: string }

export default function EditItemPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }
  const token = useAuthStore((s) => s.accessToken)
  
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [showScanner, setShowScanner] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  const [formData, setFormData] = useState({
    sku: '',
    barcode: '',
    name: '',
    description: '',
    categoryId: '',
    brandId: '',
    supplierId: '',
    unitOfMeasure: 'PCS',
    retailPrice: 0,
    wholesalePrice: 0,
    weightedAvgCost: 0,
    minRetailPrice: 0,
    minWholesalePrice: 0,
    reorderLevel: 0,
    isActive: true,
    imageUrl: '',
    type: 'PRODUCT' as 'PRODUCT' | 'SERVICE',
  })

  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const persistenceKey = `brayn_edit_item_form_${id}`

  const set = (field: string, val: unknown) => setFormData(prev => ({ ...prev, [field]: val }))

  const fetchData = async () => {
    if (!token) return
    try {
      const [cats, brnds, supps] = await Promise.all([
        api.get<Category[]>('/items/categories', token),
        api.get<Brand[]>('/items/brands', token),
        api.get<Supplier[]>('/items/suppliers', token),
      ])
      setCategories(cats)
      setBrands(brnds)
      setSuppliers(supps)
    } catch (err) { console.error(err) }
  }

  const fetchItem = async () => {
    if (!token || !id) return
    try {
      // Check if we have saved progress first
      const saved = localStorage.getItem(persistenceKey)
      if (saved) {
        try {
          setFormData(JSON.parse(saved))
          setFetching(false)
          return
        } catch (e) {
          console.error('Failed to parse saved form data', e)
        }
      }

      const item = await api.get<any>(`/items/${id}`, token)
      setFormData({
        sku: item.sku || '',
        barcode: item.barcode || '',
        name: item.name || '',
        description: item.description || '',
        categoryId: item.categoryId || '',
        brandId: item.brandId || '',
        supplierId: item.supplierId || '',
        unitOfMeasure: item.unitOfMeasure || 'PCS',
        retailPrice: Number(item.retailPrice) || 0,
        wholesalePrice: Number(item.wholesalePrice) || 0,
        weightedAvgCost: Number(item.weightedAvgCost) || 0,
        minRetailPrice: Number(item.minRetailPrice) || 0,
        minWholesalePrice: Number(item.minWholesalePrice) || 0,
        reorderLevel: item.reorderLevel || 0,
        isActive: item.isActive,
        imageUrl: item.imageUrl || '',
        type: item.type || 'PRODUCT',
      })
    } catch (err) { 
      console.error(err)
      alert('Failed to fetch item details')
      router.back()
    } finally {
      setFetching(false)
    }
  }

  // Save to localStorage on change (only after initial fetch)
  useEffect(() => {
    if (!fetching) {
      localStorage.setItem(persistenceKey, JSON.stringify(formData))
    }
  }, [formData, fetching, id])

  useEffect(() => { 
    fetchData()
    fetchItem()
  }, [token, id])

  const handleGenerateAI = async () => {
    if (!formData.name) return toast.error('Please enter an Item Name first to guide the AI.')
    setAiLoading(true)
    try {
      const selectedCategory = flatCats.find(c => c.id === formData.categoryId)?.label?.trim() || 'General'
      const selectedBrand = brands.find(b => b.id === formData.brandId)?.name || 'Unknown'
      
      const res = await api.post<{ description: string }>('/ai/generate-description', {
        name: formData.name,
        category: selectedCategory,
        brand: selectedBrand
      }, token!)
      
      set('description', res.description)
      toast.success('AI description generated!')
    } catch (err) {
      console.error(err)
      toast.error('AI Generation failed.')
    } finally {
      setAiLoading(false)
    }
  }

  const flattenCategories = (cats: Category[], depth = 0): { id: string; label: string }[] => {
    return cats.flatMap(c => [
      { id: c.id, label: '  '.repeat(depth) + c.name },
      ...flattenCategories(c.children || [], depth + 1)
    ])
  }

  const processImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const MAX_SIZE = 1200
          const size = Math.min(img.width, img.height)
          const xOffset = (img.width - size) / 2
          const yOffset = (img.height - size) / 2
          const targetSize = Math.min(size, MAX_SIZE)
          canvas.width = targetSize
          canvas.height = targetSize
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject('Failed to get canvas context')
          ctx.drawImage(img, xOffset, yOffset, size, size, 0, 0, targetSize, targetSize)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = reject
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0]
    if (!file) return
    setIsProcessing(true)
    const tid = toast.loading('🚀 Optimizing Image...')
    try {
      if (file.size > 10 * 1024 * 1024) return toast.error('Max 10MB', { id: tid })
      const processed = await processImage(file)
      set('imageUrl', processed)
      toast.success('✨ Image updated!', { id: tid })
    } catch (err) {
      toast.error('Processing failed', { id: tid })
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const item = e.clipboardData.items[0]
    if (item?.type.includes('image')) {
      const file = item.getAsFile()
      if (file) handleFileSelect(file)
    }
  }

  const handleAIImage = async () => {
    if (!formData.name) return toast.error('Please enter an Item Name.')
    toast.error('DALL-E 3 integration pending phase 2.')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return alert('Item name is required')
    if (formData.retailPrice <= 0) return alert('Retail price must be greater than 0')

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        retailPrice: Number(formData.retailPrice) || 0,
        isActive: formData.isActive,
        sku: formData.sku,
        barcode: formData.barcode,
        description: formData.description,
        categoryId: formData.categoryId,
        brandId: formData.brandId,
        supplierId: formData.supplierId,
        unitOfMeasure: formData.unitOfMeasure,
        minRetailPrice: Number(formData.retailPrice) || 0,
        minWholesalePrice: Number(formData.wholesalePrice) || Number(formData.retailPrice) || 0,
        reorderLevel: Number(formData.reorderLevel) || 0,
        imageUrl: formData.imageUrl,
        type: formData.type,
        channelId: useAuthStore.getState().user?.channelId || '',
      }

      await api.patch(`/items/${id}`, payload, token!)
      localStorage.removeItem(persistenceKey)
      alert('✅ Item updated successfully!')
      router.push('/dashboard/items')
    } catch (err) {
      console.error('Update item error:', err)
      alert('❌ Failed to update item: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div style={{ padding: 20 }}>Loading...</div>

  const flatCats = flattenCategories(categories.filter(c => !c.parentId))

  return (
    <div className="animate-fade-in" style={{ maxWidth: 700 }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1>Edit Item: {formData.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => {
            if (confirm('Discard changes and restore original data?')) {
              localStorage.removeItem(persistenceKey)
              setFetching(true)
              fetchItem()
            }
          }}>🧹 Reset</button>
          <button className="btn btn-ghost" onClick={() => router.back()}>← Back</button>
        </div>
      </div>

      <form 
        onSubmit={handleSubmit} 
        onPaste={handlePaste}
        className="card" 
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {/* Item Type Selection */}
        <div style={{ 
          display: 'flex', 
          backgroundColor: 'var(--bg-card-alt, #f8fafc)', 
          padding: '4px', 
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          width: 'fit-content',
          marginBottom: 8
        }}>
          {['PRODUCT', 'SERVICE'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => set('type', t)}
              style={{
                padding: '8px 16px',
                borderRadius: 'calc(var(--radius-lg) - 4px)',
                fontSize: '0.8rem',
                fontWeight: 700,
                transition: 'all 0.2s ease',
                backgroundColor: formData.type === t ? 'var(--primary)' : 'transparent',
                color: formData.type === t ? 'white' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                boxShadow: formData.type === t ? '0 4px 12px rgba(99, 102, 241, 0.2)' : 'none'
              }}
            >
              {t === 'PRODUCT' ? '📦 Product' : '🛠️ Service'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Image Upload Area */}
          <div className="form-group" style={{ width: 160, margin: 0 }}>
            <label>Product Image</label>
            <div 
              style={{ 
                width: 160, 
                height: 160, 
                border: isDragging ? '2px solid var(--accent)' : '2px dashed var(--border)', 
                borderRadius: 16, 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center', 
                background: formData.imageUrl ? `url(${formData.imageUrl}) center/cover` : (isDragging ? 'rgba(var(--accent-rgb), 0.1)' : 'var(--bg-hover)'), 
                cursor: 'pointer', 
                overflow: 'hidden', 
                position: 'relative',
                transition: 'all 0.2s ease',
                boxShadow: isDragging ? '0 0 20px rgba(var(--accent-rgb), 0.2)' : 'none'
              }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) handleFileSelect(file)
              }}
              onClick={() => document.getElementById('image-upload')?.click()}
            >
              {!formData.imageUrl && !isProcessing && (
                <div style={{ textAlign: 'center', opacity: 0.5 }}>
                  <span style={{ fontSize: '2.5rem' }}>📷</span>
                  <p style={{ fontSize: '0.7rem', marginTop: 4 }}>Drag or Paste</p>
                </div>
              )}
              {isProcessing && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexDirection: 'column', gap: 8 }}>
                   <div className="spinner-sm"></div>
                   <span style={{ fontSize: '0.7rem' }}>Optimizing...</span>
                </div>
              )}
              {formData.imageUrl && !isProcessing && (
                <div style={{ position: 'absolute', bottom: 0, width: '100%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.7em', textAlign: 'center', padding: '4px 0', backdropFilter: 'blur(4px)' }}>
                  Change Image
                </div>
              )}
              <input id="image-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />
            </div>
            <button 
              type="button" 
              className="btn btn-ghost btn-xs" 
              style={{ width: '100%', marginTop: 8, color: 'var(--accent)', fontSize: '0.7rem' }}
              onClick={handleAIImage}
            >
              🤖 AI Mockup
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* SKU & Name */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>SKU</label>
                <input className="input" placeholder="e.g. ITEM-001" value={formData.sku} onChange={e => set('sku', e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 2, margin: 0 }}>
                <label>Item Name *</label>
                <input className="input" placeholder="e.g. Wireless Laser Mouse" value={formData.name} onChange={e => set('name', e.target.value)} required />
              </div>
            </div>

            {/* Barcode & UoM */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Barcode</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="e.g. 6901234567890" value={formData.barcode} onChange={e => set('barcode', e.target.value)} />
                  <button type="button" className="btn btn-ghost" onClick={() => setShowScanner(true)}>📷</button>
                </div>
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label>Unit of Measure</label>
                <select className="input" value={formData.unitOfMeasure} onChange={e => set('unitOfMeasure', e.target.value)}>
                  <option value="PCS">Pieces (PCS)</option>
                  <option value="HRS">Hours (HRS)</option>
                  <option value="SES">Session (SES)</option>
                  <option value="KG">Kilograms (KG)</option>
                  <option value="LTR">Litres (LTR)</option>
                  <option value="MTR">Meters (MTR)</option>
                  <option value="BOX">Box</option>
                  <option value="PACK">Pack</option>
                  <option value="DOZEN">Dozen</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Category & Brand */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ marginBottom: 0 }}>Category</label>
              <Link href="/dashboard/items/categories" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: '0.75em', color: 'var(--accent)' }}>
                + New
              </Link>
            </div>
            <select className="input" value={formData.categoryId} onChange={e => set('categoryId', e.target.value)}>
              <option value="">Select Category...</option>
              {flatCats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ marginBottom: 0 }}>Brand</label>
              <Link href="/dashboard/items/brands" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: '0.75em', color: 'var(--accent)' }}>
                + New
              </Link>
            </div>
            <select className="input" value={formData.brandId} onChange={e => set('brandId', e.target.value)}>
              <option value="">Select Brand...</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ marginBottom: 0 }}>Supplier</label>
            <Link href="/dashboard/items/suppliers" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: '0.75em', color: 'var(--accent)' }}>
               + New
            </Link>
          </div>
          <select className="input" value={formData.supplierId} onChange={e => set('supplierId', e.target.value)}>
            <option value="">Select Supplier...</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Description */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ marginBottom: 0 }}>Description</label>
            <button type="button" className="btn btn-ghost btn-xs" style={{ color: 'var(--accent)' }} onClick={handleGenerateAI} disabled={aiLoading}>
              {aiLoading ? '⌛ Generating...' : '🤖 Generate with AI'}
            </button>
          </div>
          <textarea className="input" rows={2} placeholder="Optional item description..." value={formData.description} onChange={e => set('description', e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        {/* Pricing */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Cost Price (KES) *</label>
            <input type="number" className="input" min="0" step="0.01" value={formData.weightedAvgCost} onChange={e => set('weightedAvgCost', e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Retail Price (KES) *</label>
            <input type="number" className="input" min="0" step="0.01" value={formData.retailPrice} onChange={e => set('retailPrice', e.target.value)} required />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Wholesale Price (KES)</label>
            <input type="number" className="input" min="0" step="0.01" value={formData.wholesalePrice} onChange={e => set('wholesalePrice', e.target.value)} />
          </div>
        </div>

        {formData.type === 'PRODUCT' && (
          <div className="form-group">
            <label>Reorder Level (Qty)</label>
            <input type="number" className="input" min="0" value={formData.reorderLevel} onChange={e => set('reorderLevel', e.target.value)} />
          </div>
        )}

        {/* Status */}
        <div className="form-group">
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={formData.isActive} onChange={e => set('isActive', e.target.checked)} />
            <span>Active — available for sale in POS</span>
          </label>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ marginTop: 4, justifyContent: 'center' }}>
          {loading ? '⏳ Updating...' : '✅ Update Item'}
        </button>
      </form>
      {showScanner && (
        <ScannerModal
          isOpen={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={(code) => {
            set('barcode', code)
            setShowScanner(false)
            toast.success('Barcode scanned!')
          }}
        />
      )}
    </div>
  )
}
