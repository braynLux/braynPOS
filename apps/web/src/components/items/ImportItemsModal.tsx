'use client'

import React, { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { api } from '@/lib/api-client'
import { toast } from 'react-hot-toast'
import { 
  Download, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Sparkles,
  ArrowRight,
  RefreshCw,
  X
} from 'lucide-react'

interface Channel {
  id: string
  name: string
}

interface ImportItemsModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  channels: Channel[]
  token: string
}

interface FieldOption {
  id: string
  label: string
  description: string
  example: string
  locked?: boolean
}

const ALL_FIELDS: FieldOption[] = [
  { id: 'name', label: 'Item Name', description: 'Product or item display title', example: 'Fresh Milk 500ml', locked: true },
  { id: 'buyingPrice', label: 'Buying Price (Cost)', description: 'Unit cost price for margin calculation', example: '45.00', locked: true },
  { id: 'sellingPrice', label: 'Selling Price (Retail)', description: 'Retail price charged at checkout', example: '60.00', locked: true },
  { id: 'openingStock', label: 'Opening Stock (Qty)', description: 'Initial units on shelf right now', example: '50' },
  { id: 'category', label: 'Category', description: 'Auto-creates category on upload if new', example: 'Dairy & Eggs' },
  { id: 'barcode', label: 'Barcode', description: 'Scannable barcode / UPC / EAN', example: '6161101234567' },
  { id: 'sku', label: 'SKU / Item Code', description: 'Auto-generates clean SKU if omitted', example: 'MLK-500' },
  { id: 'brand', label: 'Brand', description: 'Auto-creates brand if new', example: 'Brookside' },
  { id: 'supplier', label: 'Supplier', description: 'Distributor or vendor name', example: 'Kenya Dairies Ltd' },
  { id: 'wholesalePrice', label: 'Wholesale Price', description: 'Bulk / distributor sales price', example: '55.00' },
  { id: 'reorderLevel', label: 'Reorder Level', description: 'Low stock warning threshold', example: '10' },
  { id: 'unitOfMeasure', label: 'Unit of Measure', description: 'PCS, KG, LITRE, BOX, PACKET', example: 'PCS' },
  { id: 'description', label: 'Description', description: 'Optional product notes or size info', example: 'Pasteurized whole milk' },
]

export function ImportItemsModal({ isOpen, onClose, onSuccess, channels, token }: ImportItemsModalProps) {
  const [activeTab, setActiveTab] = useState<'template' | 'upload'>('template')
  
  // Template customizer state
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({
    name: true,
    buyingPrice: true,
    sellingPrice: true,
    openingStock: true,
    category: true,
    barcode: false,
    sku: false,
    brand: false,
    supplier: false,
    wholesalePrice: false,
    reorderLevel: false,
    unitOfMeasure: false,
    description: false,
  })

  // Upload wizard state
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id || '')
  const [duplicateMode, setDuplicateMode] = useState<'UPDATE' | 'SKIP'>('UPDATE')
  const [parsedRows, setParsedRows] = useState<any[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [isParsing, setIsParsing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [importStats, setImportStats] = useState<{
    total: number
    created: number
    updated: number
    skipped: number
    totalStockAdded: number
    totalValuation: number
    errors: any[]
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  // Quick preset selectors
  const applyPreset = (preset: 'simple' | 'standard' | 'supermarket') => {
    if (preset === 'simple') {
      setSelectedFields({
        name: true,
        buyingPrice: true,
        sellingPrice: true,
        openingStock: true,
        category: false,
        barcode: false,
        sku: false,
        brand: false,
        supplier: false,
        wholesalePrice: false,
        reorderLevel: false,
        unitOfMeasure: false,
        description: false,
      })
    } else if (preset === 'standard') {
      setSelectedFields({
        name: true,
        buyingPrice: true,
        sellingPrice: true,
        openingStock: true,
        category: true,
        barcode: false,
        sku: false,
        brand: false,
        supplier: false,
        wholesalePrice: false,
        reorderLevel: true,
        unitOfMeasure: true,
        description: false,
      })
    } else if (preset === 'supermarket') {
      setSelectedFields({
        name: true,
        buyingPrice: true,
        sellingPrice: true,
        openingStock: true,
        category: true,
        barcode: true,
        sku: true,
        brand: true,
        supplier: true,
        wholesalePrice: true,
        reorderLevel: true,
        unitOfMeasure: true,
        description: false,
      })
    }
  }

  const toggleField = (id: string) => {
    const field = ALL_FIELDS.find(f => f.id === id)
    if (field?.locked) return
    setSelectedFields(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Generate and download customized Excel template
  const handleDownloadTemplate = (format: 'xlsx' | 'csv' = 'xlsx') => {
    const activeFieldList = ALL_FIELDS.filter(f => selectedFields[f.id])

    // Build headers
    const headers = activeFieldList.map(f => f.label)

    // Build 2 sample demo rows
    const sampleRow1: Record<string, any> = {}
    const sampleRow2: Record<string, any> = {}

    activeFieldList.forEach(f => {
      sampleRow1[f.label] = f.example
    })

    // Second sample row with alternative data
    activeFieldList.forEach(f => {
      if (f.id === 'name') sampleRow2[f.label] = 'Mineral Water 1L'
      else if (f.id === 'buyingPrice') sampleRow2[f.label] = '30.00'
      else if (f.id === 'sellingPrice') sampleRow2[f.label] = '50.00'
      else if (f.id === 'openingStock') sampleRow2[f.label] = '120'
      else if (f.id === 'category') sampleRow2[f.label] = 'Beverages'
      else if (f.id === 'barcode') sampleRow2[f.label] = '6161109876543'
      else if (f.id === 'sku') sampleRow2[f.label] = 'WTR-1000'
      else if (f.id === 'brand') sampleRow2[f.label] = 'Highland'
      else if (f.id === 'supplier') sampleRow2[f.label] = 'Crown Beverages'
      else if (f.id === 'wholesalePrice') sampleRow2[f.label] = '42.00'
      else if (f.id === 'reorderLevel') sampleRow2[f.label] = '24'
      else if (f.id === 'unitOfMeasure') sampleRow2[f.label] = 'BOTTLE'
      else if (f.id === 'description') sampleRow2[f.label] = 'Natural sparkling spring water'
      else sampleRow2[f.label] = f.example
    })

    const worksheet = XLSX.utils.json_to_sheet([sampleRow1, sampleRow2], { header: headers })

    // Auto-fit column widths
    worksheet['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 16) }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Import Template')

    if (format === 'xlsx') {
      XLSX.writeFile(workbook, 'LUX_Stock_Import_Template.xlsx')
    } else {
      XLSX.writeFile(workbook, 'LUX_Stock_Import_Template.csv')
    }

    toast.success(`Downloaded custom template with ${activeFieldList.length} fields!`, { icon: '📥' })
  }

  // Handle file drop / selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    parseUploadedFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    parseUploadedFile(file)
  }

  const parseUploadedFile = (file: File) => {
    setIsParsing(true)
    setFileName(file.name)
    setImportStats(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const workbook = XLSX.read(bstr, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) throw new Error('No sheets found in file')

        const worksheet = workbook.Sheets[sheetName]!
        const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' })

        if (rawRows.length === 0) {
          toast.error('The uploaded sheet contains no data rows.')
          setIsParsing(false)
          return
        }

        // Map various column names dynamically
        const normalized = rawRows.map(r => {
          const findVal = (...keys: string[]) => {
            for (const k of keys) {
              for (const rk of Object.keys(r)) {
                if (rk.trim().toLowerCase() === k.toLowerCase()) {
                  return r[rk]
                }
              }
            }
            return undefined
          }

          return {
            name: String(findVal('item name', 'name', 'product name', 'description', 'product') || ''),
            buyingPrice: findVal('buying price', 'cost price', 'cost', 'purchase price', 'buying cost', 'weightedavgcost', 'buying price (cost)'),
            sellingPrice: findVal('selling price', 'retail price', 'price', 'retail', 'selling price (retail)'),
            wholesalePrice: findVal('wholesale price', 'wholesale'),
            openingStock: findVal('opening stock', 'quantity', 'qty', 'opening stock (qty)', 'opening stock qty', 'stock quantity', 'in stock', 'count'),
            sku: findVal('sku', 'sku / item code', 'item code', 'code', 'product code'),
            barcode: findVal('barcode', 'upc', 'ean', 'barcode number'),
            category: findVal('category', 'category name', 'department'),
            brand: findVal('brand', 'brand name', 'make', 'manufacturer'),
            supplier: findVal('supplier', 'supplier name', 'vendor'),
            reorderLevel: findVal('reorder level', 'min stock', 'alert level'),
            unitOfMeasure: findVal('unit of measure', 'unit', 'uom'),
            description: findVal('description', 'notes'),
          }
        })

        setParsedRows(normalized)
        toast.success(`Loaded ${normalized.length} rows from ${file.name}`)
      } catch (err: any) {
        toast.error('Failed to parse file: ' + (err.message || 'Invalid format'))
      } finally {
        setIsParsing(false)
      }
    }

    reader.readAsBinaryString(file)
  }

  // Pre-flight metrics
  const validItemsCount = parsedRows.filter(r => r.name?.trim()).length
  const totalOpeningQty = parsedRows.reduce((sum, r) => {
    const q = parseFloat(String(r.openingStock || '0').replace(/[^\d.-]/g, ''))
    return sum + (isNaN(q) ? 0 : Math.max(0, q))
  }, 0)
  const totalValuation = parsedRows.reduce((sum, r) => {
    const q = parseFloat(String(r.openingStock || '0').replace(/[^\d.-]/g, ''))
    const cost = parseFloat(String(r.buyingPrice || r.sellingPrice || '0').replace(/[^\d.-]/g, ''))
    const safeQ = isNaN(q) ? 0 : Math.max(0, q)
    const safeCost = isNaN(cost) ? 0 : Math.max(0, cost)
    return sum + safeQ * safeCost
  }, 0)
  const missingNameCount = parsedRows.filter(r => !r.name?.trim()).length

  // Execute chunked import
  const handleExecuteImport = async () => {
    if (!selectedChannelId) {
      toast.error('Please select a store branch to receive the opening stock')
      return
    }

    const validRows = parsedRows.filter(r => r.name?.trim())
    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }

    setIsSubmitting(true)
    setUploadProgress(0)

    let totalCreated = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalStock = 0
    let totalVal = 0
    const accumulatedErrors: any[] = []

    const CHUNK_SIZE = 100
    const totalChunks = Math.ceil(validRows.length / CHUNK_SIZE)

    try {
      for (let c = 0; c < totalChunks; c++) {
        const chunk = validRows.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE)
        
        const res = await api.post<any>('/items/bulk-import', {
          channelId: selectedChannelId,
          duplicateMode,
          items: chunk,
        }, token)

        totalCreated += res.created || 0
        totalUpdated += res.updated || 0
        totalSkipped += res.skipped || 0
        totalStock += res.totalStockAdded || 0
        totalVal += res.totalValuation || 0
        if (res.errors?.length) {
          accumulatedErrors.push(...res.errors)
        }

        const pct = Math.round(((c + 1) / totalChunks) * 100)
        setUploadProgress(pct)
      }

      setImportStats({
        total: validRows.length,
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
        totalStockAdded: totalStock,
        totalValuation: totalVal,
        errors: accumulatedErrors,
      })

      toast.success(`Successfully onboarded ${totalCreated + totalUpdated} items!`, { icon: '🎉' })
      onSuccess()
    } catch (err: any) {
      toast.error('Import stopped: ' + (err.message || 'Unknown error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetUpload = () => {
    setParsedRows([])
    setFileName('')
    setImportStats(null)
    setUploadProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div 
        className="modal-content card animate-scale-up" 
        style={{ 
          maxWidth: 780, 
          width: '95%', 
          maxHeight: '90vh', 
          display: 'flex', 
          flexDirection: 'column', 
          padding: 0, 
          overflow: 'hidden',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ 
          padding: '20px 24px', 
          borderBottom: '1px solid var(--border)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'var(--bg-elevated, #f8fafc)'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSpreadsheet className="text-primary" size={24} />
              Smart Inventory Onboarding Engine
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Effortlessly onboard large stock catalogs from Excel or CSV with dynamic column adaptation.
            </p>
          </div>
          <button 
            type="button" 
            className="btn btn-ghost btn-sm" 
            onClick={onClose}
            style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div style={{ 
          display: 'flex', 
          borderBottom: '1px solid var(--border)', 
          background: 'var(--bg-card)' 
        }}>
          <button
            type="button"
            className={`btn ${activeTab === 'template' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('template')}
            style={{ 
              flex: 1, 
              borderRadius: 0, 
              borderBottom: activeTab === 'template' ? '2px solid var(--primary)' : 'none',
              padding: '12px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
              gap: 8,
              justifyContent: 'center'
            }}
          >
            <Download size={16} />
            1. Customize & Download Template
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'upload' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('upload')}
            style={{ 
              flex: 1, 
              borderRadius: 0, 
              borderBottom: activeTab === 'upload' ? '2px solid var(--primary)' : 'none',
              padding: '12px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
              gap: 8,
              justifyContent: 'center'
            }}
          >
            <Upload size={16} />
            2. Upload & Import Inventory
            {parsedRows.length > 0 && (
              <span className="badge badge-success" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                {parsedRows.length} items
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'template' ? (
            <div>
              {/* Presets Row */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  ⚡ Quick Industry Presets
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button 
                    type="button" 
                    className="btn btn-sm btn-ghost" 
                    onClick={() => applyPreset('simple')}
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                  >
                    ⚡ Simple Store (4 Columns)
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-sm btn-ghost" 
                    onClick={() => applyPreset('standard')}
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                  >
                    🏬 Standard Retail (6 Columns)
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-sm btn-ghost" 
                    onClick={() => applyPreset('supermarket')}
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                  >
                    🛒 Full Supermarket (9 Columns)
                  </button>
                </div>
              </div>

              {/* Field Customization Checklist */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  📋 Select Fields to Include in Your Excel Template
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {ALL_FIELDS.map(f => {
                    const isChecked = !!selectedFields[f.id]
                    return (
                      <div
                        key={f.id}
                        onClick={() => toggleField(f.id)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border)',
                          background: isChecked ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-elevated)',
                          cursor: f.locked ? 'default' : 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={f.locked}
                          onChange={() => {}}
                          style={{ marginTop: 3, cursor: f.locked ? 'default' : 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {f.label}
                            {f.locked && <span style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>🔒</span>}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {f.description}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Download Actions */}
              <div style={{ 
                padding: '16px 20px', 
                background: 'var(--bg-elevated)', 
                borderRadius: 12, 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <div>
                  <strong style={{ fontSize: '0.9rem', display: 'block' }}>Ready to generate template?</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Your custom spreadsheet will have {ALL_FIELDS.filter(f => selectedFields[f.id]).length} columns with 2 sample demonstration rows.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDownloadTemplate('csv')}
                  >
                    📄 CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleDownloadTemplate('xlsx')}
                    style={{ gap: 8 }}
                  >
                    <Download size={16} />
                    Download Custom Excel (.xlsx)
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* UPLOAD VIEW */}
              {!importStats ? (
                <div>
                  {/* Channel & Duplicate Config */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 18 }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Assign Opening Stock to Branch *</label>
                      <select 
                        className="input" 
                        value={selectedChannelId} 
                        onChange={e => setSelectedChannelId(e.target.value)}
                      >
                        {channels.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>If Item / SKU Already Exists</label>
                      <select 
                        className="input" 
                        value={duplicateMode} 
                        onChange={e => setDuplicateMode(e.target.value as any)}
                      >
                        <option value="UPDATE">Update Existing (Sync Prices & Stock)</option>
                        <option value="SKIP">Skip Duplicates (Leave Existing Untouched)</option>
                      </select>
                    </div>
                  </div>

                  {/* Dropzone */}
                  {parsedRows.length === 0 ? (
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: '2px dashed var(--border)',
                        borderRadius: 14,
                        padding: '40px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: 'var(--bg-elevated)',
                        transition: 'border-color 0.2s',
                        marginBottom: 16
                      }}
                    >
                      <input 
                        ref={fileInputRef} 
                        type="file" 
                        accept=".xlsx,.xls,.csv" 
                        style={{ display: 'none' }} 
                        onChange={handleFileChange} 
                      />
                      <div style={{ display: 'inline-flex', padding: 14, background: 'rgba(59, 130, 246, 0.1)', borderRadius: '50%', marginBottom: 12 }}>
                        <Upload size={32} className="text-primary" />
                      </div>
                      <h4 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 700 }}>
                        {isParsing ? 'Inspecting spreadsheet...' : 'Drag & drop completed Excel / CSV here'}
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                        Supports <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong> files.
                      </p>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 14 }}>
                        Browse Files on Computer
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* File Loaded Banner & Pre-flight Metrics */}
                      <div style={{ 
                        padding: '14px 18px', 
                        background: 'rgba(59, 130, 246, 0.08)', 
                        border: '1px solid rgba(59, 130, 246, 0.25)', 
                        borderRadius: 10, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: 16 
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <FileSpreadsheet className="text-primary" size={24} />
                          <div>
                            <strong style={{ fontSize: '0.9rem', display: 'block' }}>{fileName}</strong>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              Ready for onboarding validation
                            </span>
                          </div>
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={resetUpload}>
                          Change File
                        </button>
                      </div>

                      {/* Summary Metric Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
                        <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Valid Items</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                            {validItemsCount}
                          </div>
                        </div>
                        <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Opening Stock</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success, #22c55e)', marginTop: 4 }}>
                            {totalOpeningQty.toLocaleString()} <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>units</span>
                          </div>
                        </div>
                        <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Opening Valuation</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                            KES {Math.round(totalValuation).toLocaleString()}
                          </div>
                        </div>
                        <div className="card" style={{ padding: '12px 16px', background: missingNameCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: '0.75rem', color: missingNameCount > 0 ? 'var(--danger)' : 'var(--text-muted)', textTransform: 'uppercase' }}>Errors</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: missingNameCount > 0 ? 'var(--danger)' : 'var(--success)', marginTop: 4 }}>
                            {missingNameCount === 0 ? '0' : `${missingNameCount} Missing`}
                          </div>
                        </div>
                      </div>

                      {/* First 5 rows Preview Table */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                          🔍 Pre-flight Preview (First {Math.min(5, parsedRows.length)} Rows)
                        </div>
                        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                          <table className="table" style={{ fontSize: '0.82rem', margin: 0 }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Item Name</th>
                                <th>Cost</th>
                                <th>Retail</th>
                                <th>Opening Qty</th>
                                <th>Category</th>
                                <th>Barcode</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsedRows.slice(0, 5).map((r, idx) => (
                                <tr key={idx}>
                                  <td>{idx + 1}</td>
                                  <td><strong>{r.name || <span style={{ color: 'var(--danger)' }}>[Missing Name]</span>}</strong></td>
                                  <td>KES {r.buyingPrice || '0'}</td>
                                  <td>KES {r.sellingPrice || '0'}</td>
                                  <td><span className="badge badge-success">{r.openingStock || '0'}</span></td>
                                  <td>{r.category || 'General'}</td>
                                  <td>{r.barcode || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Progress bar during execution */}
                      {isSubmitting && (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                            <span>Importing items in batches...</span>
                            <strong>{uploadProgress}%</strong>
                          </div>
                          <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                            <div 
                              style={{ 
                                width: `${uploadProgress}%`, 
                                height: '100%', 
                                background: 'var(--primary)', 
                                transition: 'width 0.3s ease' 
                              }} 
                            />
                          </div>
                        </div>
                      )}

                      {/* Execute Button */}
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                        <button type="button" className="btn btn-ghost" onClick={resetUpload} disabled={isSubmitting}>
                          Cancel
                        </button>
                        <button 
                          type="button" 
                          className="btn btn-primary" 
                          onClick={handleExecuteImport} 
                          disabled={isSubmitting || validItemsCount === 0}
                          style={{ gap: 8 }}
                        >
                          {isSubmitting ? (
                            <>
                              <RefreshCw size={16} className="animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Sparkles size={16} />
                              Import {validItemsCount} Items to Store Shelf
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* SUCCESS CELEBRATION SUMMARY */
                <div style={{ textAlign: 'center', padding: '24px 16px' }}>
                  <div style={{ display: 'inline-flex', padding: 16, background: 'rgba(34, 197, 94, 0.12)', borderRadius: '50%', marginBottom: 16 }}>
                    <CheckCircle2 size={48} className="text-success" />
                  </div>
                  <h3 style={{ margin: '0 0 8px', fontSize: '1.4rem', fontWeight: 800 }}>
                    🎉 Onboarding Import Successful!
                  </h3>
                  <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Your catalog and shelf stock have been updated in real-time.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, maxWidth: 500, margin: '0 auto 24px' }}>
                    <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Created New</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
                        {importStats.created}
                      </div>
                    </div>
                    <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Updated</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                        {importStats.updated}
                      </div>
                    </div>
                    <div className="card" style={{ padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stock Added</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--success, #22c55e)', marginTop: 4 }}>
                        {importStats.totalStockAdded.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {importStats.errors.length > 0 && (
                    <div style={{ textAlign: 'left', marginBottom: 20, padding: 12, background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8 }}>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>
                        ⚠️ {importStats.errors.length} rows had warnings:
                      </strong>
                      <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: '0.78rem', marginTop: 6 }}>
                        {importStats.errors.slice(0, 5).map((e, idx) => (
                          <div key={idx}>Row {e.row}: {e.error} ({e.item || 'Unnamed'})</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button type="button" className="btn btn-secondary" onClick={resetUpload}>
                      Import Another File
                    </button>
                    <button type="button" className="btn btn-primary" onClick={onClose}>
                      View Items in Inventory →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
