'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import html2canvas from 'html2canvas'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Printer,
  Share2,
  X,
  Check,
  CloudOff,
  AlertCircle,
  Tag,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

// ==================== TYPES ====================

interface ProductVariant {
  id: string
  name: string
  sku: string | null
  price: number
  hpp: number
  stock: number
}

interface Product {
  id: string
  name: string
  price: number
  stock: number
  sku: string | null
  barcode: string | null
  categoryId: string | null
  image: string | null
  hasVariants: boolean
  _variantCount: number
  variants: ProductVariant[]
}

interface CartItem {
  product: Product
  variant: ProductVariant | null
  qty: number
  customPrice: number | null
}

interface CheckoutResult {
  success: boolean
  invoiceNumber: string
  message?: string
  syncError?: string
}

interface OutletSettings {
  paymentMethods: string
  loyaltyEnabled: boolean
  loyaltyPointsPerAmount: number
  loyaltyPointValue: number
  receiptBusinessName: string
  receiptAddress: string
  receiptPhone: string
  receiptFooter: string
  receiptLogo: string
  themePrimaryColor: string
  ppnEnabled: boolean
  ppnRate: number
}

interface Customer {
  id: string
  name: string
  whatsapp: string
  points: number
}

export interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Cart data (frozen at checkout time)
  cart: CartItem[]
  subtotal: number
  pointsDiscount: number
  promoDiscount: number
  manualDiscountTotal: number
  ppnAmount: number
  total: number
  // Payment
  paymentMethod: string
  paidAmount: string
  change: number
  // Customer
  selectedCustomer: Customer | null
  // Promo
  selectedPromo: { id: string; name: string; type: string; discount: number; description: string } | null
  // Checkout result
  checkoutResult: CheckoutResult | null
  // Settings
  settings: OutletSettings
  // Callbacks
  onFinish: () => void
}

// ==================== HELPERS ====================

const getItemPrice = (item: CartItem) => item.variant ? item.variant.price : item.product.price
const getItemEffectivePrice = (item: CartItem) => item.customPrice != null ? item.customPrice : getItemPrice(item)
const getCartKey = (productId: string, variantId: string | null) => variantId ? `${productId}_${variantId}` : productId

const RECEIPT_CSS = `
    .r-center{text-align:center}.r-right{text-align:right}
    .r-row{display:flex;justify-content:space-between;align-items:baseline}
    .r-row-items{display:flex;align-items:baseline}
    .r-bold{font-weight:700}.r-semibold{font-weight:600}.r-medium{font-weight:500}
    .r-space>*+*{margin-top:4px}.r-space-sm>*+*{margin-top:2px}.r-space-md>*+*{margin-top:6px}.r-space-lg>*+*{margin-top:8px}
    .r-py{padding-top:6px;padding-bottom:6px}.r-my{margin-top:6px;margin-bottom:6px}
    .r-sep{border:none;border-top:1px dashed #000;margin:6px 0}
    .r-sep-double{border:none;border-top:2px dashed #000;margin:6px 0}
    .r-label{color:#000;font-size:9.5px;font-weight:400}.r-value{color:#000;font-weight:600;font-size:10px}
    .r-value-bold{color:#000;font-weight:700}.r-muted{color:#000;font-size:9px;font-weight:400}
    .r-success{color:#000;font-weight:600}.r-warning{color:#000;font-weight:600}
    .r-upper{text-transform:uppercase;letter-spacing:0.5px}
    .r-lg{font-size:12px}.r-sm{font-size:9px}.r-xs{font-size:8.5px}
    .r-w8{width:28px;text-align:center;flex-shrink:0}.r-w16{width:60px;text-align:right;flex-shrink:0}
    .r-w20{width:72px;text-align:right;flex-shrink:0}.r-flex1{flex:1;min-width:0}.r-gap{gap:2px}
    .r-logo{max-width:40px;max-height:40px;object-fit:contain}
    .r-item-name{font-weight:600;font-size:10px;color:#000}
    .r-item-variant{font-size:8.5px;color:#000;font-weight:400}
    .r-item-price{font-size:9px;color:#000;font-weight:400}
    .r-total-row{font-size:11px}.r-footer{color:#000;font-size:8.5px;font-weight:400}
    .r-wrap{font-family:'Courier New',Courier,monospace;width:100%;color:#000;font-size:10px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:auto}
  `

// ==================== WHATSAPP TEXT (fallback) ====================
// The full text receipt generator has been replaced by image-based sharing (html2canvas).
// A short text message is now composed inline in handleShareReceipt for the WhatsApp URL fallback.

// ==================== COMPONENT ====================

export function ReceiptDialog({
  open,
  onOpenChange,
  cart,
  subtotal,
  pointsDiscount,
  promoDiscount,
  manualDiscountTotal,
  ppnAmount,
  total,
  paymentMethod,
  paidAmount,
  change: changeAmount,
  selectedCustomer,
  selectedPromo,
  checkoutResult,
  settings,
  onFinish,
}: ReceiptDialogProps) {
  const receiptContentRef = useRef<HTMLDivElement>(null)
  const [isSharing, setIsSharing] = useState(false)

  const isOfflineReceipt = checkoutResult?.invoiceNumber?.startsWith('OFF-')

  const formatReceiptDateTime = () => {
    const now = new Date()
    return `${now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  }

  // Print handler
  const handlePrint = () => {
    const content = receiptContentRef.current?.innerHTML
    if (!content) return
    const win = window.open('', '_blank', 'width=320,height=800')
    if (!win) { toast.error('Gagal membuka jendela cetak'); return }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 72mm; margin: 0 auto; padding: 10px 8px; }
        ${RECEIPT_CSS}
        @media print {
          body { margin: 0; padding: 6px 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 0; size: 80mm auto; }
          body, .r-wrap { -webkit-font-smoothing: none; -moz-osx-font-smoothing: unset; }
          .r-sep { border-top: 1px dashed #000; }
        }
      </style>
    </head><body>${content}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print(); setTimeout(() => win.close(), 500) }, 250)
    handleClose()
  }

  // Share receipt as image handler
  const handleShareReceipt = async () => {
    if (!receiptContentRef.current || !checkoutResult) return
    setIsSharing(true)
    try {
      const canvas = await html2canvas(receiptContentRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      canvas.toBlob(async (blob) => {
        if (!blob) { toast.error('Gagal membuat gambar struk'); return }
        const file = new File([blob], `struk-${checkoutResult.invoiceNumber}.jpg`, { type: 'image/jpeg' })
        // Try Web Share API first (supports sharing images to WhatsApp)
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: `Struk ${checkoutResult.invoiceNumber}`,
              text: `Struk pembayaran ${settings.receiptBusinessName}`,
            })
            return
          } catch (err: any) {
            if (err.name === 'AbortError') return // user cancelled
          }
        }
        // Fallback: download image + open WhatsApp with text
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `struk-${checkoutResult.invoiceNumber}.jpg`; a.click()
        URL.revokeObjectURL(url)

        if (selectedCustomer?.whatsapp) {
          const shortText = `Halo ${selectedCustomer.name}, berikut struk pembayaran Anda dari ${settings.receiptBusinessName}. Invoice: ${checkoutResult.invoiceNumber}. Total: ${formatCurrency(total)}. Gambar struk telah diunduh.`
          let phone = selectedCustomer.whatsapp.replace(/[^0-9]/g, '')
          if (phone.startsWith('0')) phone = phone.substring(1)
          window.open(`https://wa.me/62${phone}?text=${encodeURIComponent(shortText)}`, '_blank')
        } else {
          toast.success('Gambar struk berhasil diunduh')
        }
      }, 'image/jpeg', 0.95)
    } catch (err) {
      console.error(err)
      toast.error('Gagal membuat gambar struk')
    } finally {
      setIsSharing(false)
    }
  }

  // Close handler
  const handleClose = () => {
    onOpenChange(false)
    onFinish()
  }

  // Receipt HTML content for print
  const receiptHtml = (
    <div ref={receiptContentRef}>
      <style dangerouslySetInnerHTML={{ __html: RECEIPT_CSS }} />
      <div className="r-wrap">
        {/* Header */}
        <div className="r-center r-space-lg">
          {settings.receiptLogo && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
              <img
                src={settings.receiptLogo}
                alt="Logo"
                className="r-logo"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
          )}
          <p className="r-bold r-lg">{settings.receiptBusinessName}</p>
          {settings.receiptAddress && <p className="r-muted">{settings.receiptAddress}</p>}
          {settings.receiptPhone && <p className="r-muted">{settings.receiptPhone}</p>}
        </div>

        <hr className="r-sep" />

        {/* Transaction Info */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">No. Invoice</span><span className="r-value-bold">{checkoutResult?.invoiceNumber}</span></div>
          <div className="r-row"><span className="r-label">Tanggal</span><span className="r-value">{formatReceiptDateTime()}</span></div>
          <div className="r-row"><span className="r-label">Customer</span><span className="r-value">{selectedCustomer ? selectedCustomer.name : 'Walk-in'}</span></div>
          {isOfflineReceipt && <div className="r-row"><span className="r-warning r-sm">Status</span><span className="r-warning r-semibold r-sm">Offline — Pending Sync</span></div>}
        </div>

        <hr className="r-sep" />

        {/* Items Header */}
        <div className="r-row-items r-py r-upper">
          <span className="r-flex1 r-semibold r-sm">Item</span>
          <span className="r-w8 r-semibold r-sm">Qty</span>
          <span className="r-w20 r-semibold r-sm">Subtotal</span>
        </div>
        <hr className="r-sep" />

        {/* Items */}
        <div className="r-space-md">
          {cart.map((item) => {
            const effPrice = getItemEffectivePrice(item)
            const effSubtotal = effPrice * item.qty
            return (
            <div key={getCartKey(item.product.id, item.variant?.id || null)} className="r-space-sm">
              <p className="r-item-name">{item.product.name}</p>
              {item.variant && <p className="r-item-variant">{item.variant.name}</p>}
              <div className="r-row-items r-gap">
                <span className="r-flex1 r-item-price">@ {formatCurrency(effPrice)}</span>
                <span className="r-w8 r-value">{item.qty}</span>
                <span className="r-w20 r-value-bold">{formatCurrency(effSubtotal)}</span>
              </div>
              {item.customPrice != null && (
                <div className="r-row-items r-gap" style={{ paddingLeft: '28px' }}>
                  <span className="r-flex1 r-item-price" style={{ color: '#b45309', textDecoration: 'line-through' }}>@ {formatCurrency(getItemPrice(item))}</span>
                  <span className="r-w20" style={{ color: '#b45309', fontWeight: 600, fontSize: '9px', textAlign: 'right' }}>diskon: -{formatCurrency((getItemPrice(item) - effPrice) * item.qty)}</span>
                </div>
              )}
            </div>
            )
          })}
        </div>

        <hr className="r-sep" />

        {/* Totals */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">Subtotal</span><span className="r-value">{formatCurrency(subtotal)}</span></div>
          {pointsDiscount > 0 && <div className="r-row"><span className="r-success r-medium">Poin Diskon</span><span className="r-success r-bold">-{formatCurrency(pointsDiscount)}</span></div>}
          {promoDiscount > 0 && selectedPromo && <div className="r-row"><span className="r-warning r-medium">Promo ({selectedPromo.name})</span><span className="r-warning r-bold">-{formatCurrency(promoDiscount)}</span></div>}
          {manualDiscountTotal > 0 && (
            <div className="r-row"><span className="r-warning r-medium">Diskon Manual</span><span className="r-warning r-bold">-{formatCurrency(manualDiscountTotal)}</span></div>
          )}
          {ppnAmount > 0 && <div className="r-row"><span className="r-label">PPN ({settings.ppnRate}%)</span><span className="r-value">+{formatCurrency(ppnAmount)}</span></div>}
        </div>

        <hr className="r-sep-double" />

        <div className="r-row r-total-row r-bold r-my">
          <span>TOTAL</span>
          <span>{formatCurrency(total)}</span>
        </div>

        <hr className="r-sep" />

        {/* Payment */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">Pembayaran</span><span className="r-semibold r-upper r-sm">{paymentMethod}</span></div>
          <div className="r-row"><span className="r-label">Dibayar</span><span className="r-value">{formatCurrency(paymentMethod === 'CASH' ? Number(paidAmount) : total)}</span></div>
          {paymentMethod === 'CASH' && changeAmount > 0 && <div className="r-row r-bold"><span>Kembalian</span><span>{formatCurrency(changeAmount)}</span></div>}
        </div>

        {/* Footer */}
        {settings.receiptFooter && (
          <>
            <hr className="r-sep" />
            <div className="r-center r-py">
              <p className="r-footer">{settings.receiptFooter}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <ResponsiveDialogContent
        desktopClassName="max-w-md rounded-2xl overflow-hidden !p-0 bg-nebula border-white/[0.06]"
        className="!p-0 bg-nebula border-white/[0.06]"
        showCloseButton={false}
      >
        {checkoutResult && (
          <div className="flex flex-col max-h-[90vh] sm:max-h-[85vh]">
            {/* Header — status */}
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="shrink-0 px-5 pt-5 pb-3"
                >
                  <div className="flex items-center justify-center gap-2.5 mb-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isOfflineReceipt ? 'bg-amber-500/15' : 'bg-emerald-500/15'}`}>
                      {isOfflineReceipt ? (
                        <CloudOff className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
                      ) : (
                        <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="text-left">
                      <p className={`text-sm font-bold ${isOfflineReceipt ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {isOfflineReceipt ? 'Tersimpan Offline' : 'Pembayaran Berhasil'}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">{checkoutResult.invoiceNumber}</p>
                    </div>
                  </div>

                  {/* Sync error warning */}
                  {checkoutResult.syncError && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-3">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" strokeWidth={1.5} />
                      <div>
                        <p className="text-[11px] text-amber-400 font-medium">Gagal sync ke server</p>
                        <p className="text-[10px] text-amber-500">{checkoutResult.syncError}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Receipt preview — thermal style */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 pb-4 pt-2">
                <div className="bg-white border border-zinc-200 rounded-lg shadow-inner mx-auto max-w-[280px] p-3 overflow-hidden">
                  {receiptHtml}
                </div>
              </div>
            </ScrollArea>

            {/* Action buttons */}
            <div className="shrink-0 border-t border-white/[0.06] bg-deep-space/80 backdrop-blur-sm px-4 py-3.5 flex gap-2 rounded-b-2xl">
              <Button
                onClick={handlePrint}
                className="flex-1 h-10 text-sm font-medium rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-white transition-colors"
              >
                <Printer className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                Cetak Struk
              </Button>

              {/* Share receipt as image button */}
              <Button
                onClick={handleShareReceipt}
                disabled={isSharing}
                className="flex-1 h-10 text-sm font-medium rounded-xl bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSharing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Share2 className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                )}
                {isSharing ? 'Membuat...' : 'Bagikan Struk'}
              </Button>

              <Button
                onClick={handleClose}
                variant="outline"
                className="h-10 px-4 text-sm font-medium rounded-xl border-white/[0.08] text-slate-400 hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
                <span className="sr-only sm:not-sr-only sm:ml-1.5">Selesai</span>
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}