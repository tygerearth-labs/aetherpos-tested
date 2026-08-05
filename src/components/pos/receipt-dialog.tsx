'use client'

import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Printer,
  MessageSquare,
  X,
  Check,
  CloudOff,
  AlertCircle,
  Tag,
  Loader2,
  RefreshCcw,
  WifiOff,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { markReceiptReady } from '@/lib/checkout-telemetry'

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
  /** STATUS CONTRACT: drives the receipt modal title/badge (APP-UI) and the
   *  customer-facing receipt label/footer. See deriveContractDisplay below.
   *  - 'pending' → PENDING_SYNC: modal title "Transaksi Tersimpan", badge "Menunggu Sinkronisasi", receipt label "No. Referensi", Print disabled
   *  - 'synced'  → SYNCED: modal title "Pembayaran Berhasil", badge "Tersinkronisasi", receipt label "No. Invoice", Print enabled
   *  - 'failed'  → SYNC_FAILED: modal title "Sync Gagal", badge "Menunggu Retry", receipt label "No. Referensi", Print enabled (provisional)
   *  - 'offline' → OFFLINE: modal title "Tersimpan Offline", badge "Menunggu Koneksi", receipt label "No. Referensi", Print enabled (provisional)
   *  - 'skipped' → no sync needed (treated as synced for display) */
  syncStatus?: 'pending' | 'synced' | 'failed' | 'offline' | 'skipped'
  localTransactionId?: string
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
  receiptDoublePrintEnabled?: boolean
  receiptMerchantCopyEnabled?: boolean
  receiptCustomerCopyEnabled?: boolean
  receiptBatchOrderEnabled?: boolean
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

// ==================== STATUS CONTRACT DISPLAY ====================
//
// Maps the CheckoutResult.syncStatus (the authoritative contract field) to:
//   - APP-UI fields (modal header only): title, badge, icon, colors, statusValue
//   - CUSTOMER-FACING fields (receipt body + print + WhatsApp): receiptLabel,
//     provisionalFooter, isProvisional, printDisabled
//
// CUSTOMER-FACING RECEIPT CONTRACT (requirements 3–6):
//   - Synced: label "No. Invoice", value INV-..., no footer, print enabled.
//   - Provisional (pending/offline/failed): label "No. Referensi", value
//     SYNC-.../OFF-..., subtle footer "Referensi lokal — invoice final akan
//     diperbarui otomatis". NO technical words (no PENDING_SYNC / SYNC_FAILED /
//     "belum tersinkronisasi"), NO large watermark/banner.
//   - Print is disabled ONLY for online-pending (sync in progress). Offline and
//     failed states allow provisional print with the subtle footer.
//
// APP-UI (modal header) CONTRACT (requirements 2, 7): the title, badge, and
// syncError panel remain visible in the modal — sync failure state is shown
// here, NEVER on the customer receipt.
//
// Derives a fallback from the invoice prefix for old snapshots that predate
// syncStatus (e.g. a lastReceipt row written before this hardening).
type ContractDisplay = {
  // --- APP-UI fields (modal header only — never on the customer receipt) ---
  title: string
  badge: string
  /** Lucide icon element key — mapped in the render switch below. */
  icon: 'loader' | 'check' | 'alert' | 'cloudoff' | 'retry' | 'wifiOff' | 'checkCircle'
  /** Tailwind classes for the icon circle background + icon color. */
  iconBg: string
  iconColor: string
  titleColor: string
  /** Short label + value for the APP-UI status (modal header only). */
  statusLabel: string
  statusValue: string
  // --- CUSTOMER-FACING fields (receipt body + print + WhatsApp) ---
  /** Whether this receipt is still provisional (not yet synced). */
  isProvisional: boolean
  /** Receipt body label: "No. Invoice" when synced, "No. Referensi" when provisional. */
  receiptLabel: string
  /** Subtle footer text for the customer-facing receipt when provisional. Empty when synced. */
  provisionalFooter: string
  /** Whether the Print button should be disabled (online-pending only). */
  printDisabled: boolean
}

function deriveContractDisplay(syncStatus: CheckoutResult['syncStatus'], invoiceNumber: string | undefined): ContractDisplay {
  // Fallback for old snapshots without syncStatus: derive from invoice prefix.
  let status = syncStatus
  if (!status) {
    if (invoiceNumber?.startsWith('OFF-')) status = 'offline'
    else if (invoiceNumber?.startsWith('SYNC-')) status = 'pending'
    else status = 'synced'
  }

  // Subtle, customer-friendly provisional footer (requirements 5–6).
  // NO technical words — appears on printed receipt + WhatsApp text when provisional.
  const PROVISIONAL_FOOTER = 'Referensi lokal — invoice final akan diperbarui otomatis'

  switch (status) {
    case 'pending':
      return {
        title: 'Transaksi Tersimpan',
        badge: 'Menunggu Sinkronisasi',
        icon: 'loader',
        iconBg: 'bg-sky-500/15',
        iconColor: 'text-sky-400',
        titleColor: 'text-sky-400',
        statusLabel: 'Status',
        statusValue: 'Menunggu Sinkronisasi',
        isProvisional: true,
        receiptLabel: 'No. Referensi',
        provisionalFooter: PROVISIONAL_FOOTER,
        printDisabled: true,
      }
    case 'synced':
      return {
        title: 'Pembayaran Berhasil',
        badge: 'Tersinkronisasi',
        icon: 'checkCircle',
        iconBg: 'bg-emerald-500/15',
        iconColor: 'text-emerald-400',
        titleColor: 'text-emerald-400',
        statusLabel: 'Status',
        statusValue: 'Tersinkronisasi',
        isProvisional: false,
        receiptLabel: 'No. Invoice',
        provisionalFooter: '',
        printDisabled: false,
      }
    case 'failed':
      return {
        title: 'Sync Gagal',
        badge: 'Menunggu Retry',
        icon: 'alert',
        iconBg: 'bg-amber-500/15',
        iconColor: 'text-amber-400',
        titleColor: 'text-amber-400',
        statusLabel: 'Status',
        statusValue: 'Sync Gagal — Menunggu Retry',
        isProvisional: true,
        receiptLabel: 'No. Referensi',
        provisionalFooter: PROVISIONAL_FOOTER,
        printDisabled: false,
      }
    case 'offline':
      return {
        title: 'Tersimpan Offline',
        badge: 'Menunggu Koneksi',
        icon: 'cloudoff',
        iconBg: 'bg-amber-500/15',
        iconColor: 'text-amber-400',
        titleColor: 'text-amber-400',
        statusLabel: 'Status',
        statusValue: 'Offline — Menunggu Koneksi',
        isProvisional: true,
        receiptLabel: 'No. Referensi',
        provisionalFooter: PROVISIONAL_FOOTER,
        printDisabled: false,
      }
    case 'skipped':
    default:
      return {
        title: 'Transaksi Tersimpan',
        badge: 'Tersinkronisasi',
        icon: 'check',
        iconBg: 'bg-emerald-500/15',
        iconColor: 'text-emerald-400',
        titleColor: 'text-emerald-400',
        statusLabel: 'Status',
        statusValue: 'Tersinkronisasi',
        isProvisional: false,
        receiptLabel: 'No. Invoice',
        provisionalFooter: '',
        printDisabled: false,
      }
  }
}

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

// ==================== WHATSAPP TEXT GENERATION ====================

function generateWhatsAppReceiptText(props: {
  cart: CartItem[]
  subtotal: number
  pointsDiscount: number
  promoDiscount: number
  manualDiscountTotal: number
  ppnAmount: number
  total: number
  paymentMethod: string
  paidAmount: string
  change: number
  selectedCustomer: Customer | null
  selectedPromo: { id: string; name: string } | null
  checkoutResult: CheckoutResult
  settings: OutletSettings
}): string {
  const {
    cart, subtotal, pointsDiscount, promoDiscount, manualDiscountTotal, ppnAmount, total,
    paymentMethod, paidAmount, change: changeAmount,
    selectedCustomer, selectedPromo, checkoutResult, settings,
  } = props

  const now = new Date()
  const dateStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const lines: string[] = []

  // Header
  lines.push(settings.receiptBusinessName)
  if (settings.receiptAddress) lines.push(settings.receiptAddress)
  if (settings.receiptPhone) lines.push(settings.receiptPhone)
  lines.push('')

  // Transaction info — use "No. Invoice" only when synced; otherwise "No. Referensi".
  // NO technical words (no PENDING_SYNC / SYNC_FAILED / "belum tersinkronisasi")
  // and NO large watermark/banner on the WhatsApp text (requirement 2–3).
  const contract = deriveContractDisplay(checkoutResult.syncStatus, checkoutResult.invoiceNumber)
  lines.push(`${contract.receiptLabel}: ${checkoutResult.invoiceNumber}`)
  lines.push(`Tanggal: ${dateStr} ${timeStr}`)
  lines.push(`Customer: ${selectedCustomer ? selectedCustomer.name : 'Walk-in'}`)
  lines.push('')

  // Items
  for (const item of cart) {
    const name = item.variant ? `${item.product.name} (${item.variant.name})` : item.product.name
    const effPrice = getItemEffectivePrice(item)
    const effSubtotal = effPrice * item.qty
    lines.push(`${name}`)
    lines.push(`  ${formatCurrency(effPrice)} x ${item.qty} = ${formatCurrency(effSubtotal)}`)
  }
  lines.push('')

  // Totals
  lines.push(`Subtotal: ${formatCurrency(subtotal)}`)
  if (pointsDiscount > 0) lines.push(`Poin Diskon: -${formatCurrency(pointsDiscount)}`)
  if (promoDiscount > 0 && selectedPromo) lines.push(`Promo (${selectedPromo.name}): -${formatCurrency(promoDiscount)}`)
  if (manualDiscountTotal > 0) lines.push(`Diskon Manual: -${formatCurrency(manualDiscountTotal)}`)
  if (ppnAmount > 0) lines.push(`PPN (${settings.ppnRate}%): +${formatCurrency(ppnAmount)}`)
  lines.push(`TOTAL: ${formatCurrency(total)}`)
  lines.push('')

  // Payment
  lines.push(`Pembayaran: ${paymentMethod}`)
  lines.push(`Dibayar: ${formatCurrency(paymentMethod === 'CASH' ? Number(paidAmount) : total)}`)
  if (paymentMethod === 'CASH' && changeAmount > 0) lines.push(`Kembalian: ${formatCurrency(changeAmount)}`)

  // Footer
  if (settings.receiptFooter) {
    lines.push('')
    lines.push(settings.receiptFooter)
  }

  // Subtle provisional footer (requirements 5–6) — no technical words, no
  // large banner. Only shown when the receipt is not yet synced.
  if (contract.provisionalFooter) {
    lines.push('')
    lines.push(contract.provisionalFooter)
  }

  return lines.join('\n')
}

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

  // STATUS CONTRACT: derive the title, badge, icon, color, and provisional
  // watermark from the authoritative syncStatus field. Falls back to invoice
  // prefix for old snapshots. See deriveContractDisplay above for the mapping.
  const contract = checkoutResult
    ? deriveContractDisplay(checkoutResult.syncStatus, checkoutResult.invoiceNumber)
    : null
  const isProvisional = !!contract && contract.isProvisional
  // Print is disabled for online-pending (sync in progress). Offline/failed
  // states allow provisional print with the subtle footer (requirement 5–6).
  const printDisabled = !!contract && contract.printDisabled

  // POST-CHECKOUT LATENCY FIX: Pre-warm the receipt logo image when the dialog
  // opens so the print window (which loads the logo in a separate document
  // context) can use the browser cache. Also mark the receipt as "ready" for
  // telemetry after the first paint.
  useEffect(() => {
    if (!open) return
    // Mark receipt ready (telemetry) — the content is rendered synchronously
    // from props, so the next paint is the "ready" point.
    requestAnimationFrame(() => {
      // Defer to after paint via rAF so the user actually sees the content.
      markReceiptReady()
    })
    // Pre-warm logo for the print window.
    if (settings.receiptLogo) {
      try {
        const img = new Image()
        img.src = settings.receiptLogo
      } catch { /* non-critical */ }
    }
  }, [open, settings.receiptLogo])

  const formatReceiptDateTime = () => {
    const now = new Date()
    return `${now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  }

  // Print handler — supports double receipt
  const handlePrint = () => {
    const content = receiptContentRef.current?.innerHTML
    if (!content) return

    const doublePrint = settings.receiptDoublePrintEnabled
    const merchantCopy = settings.receiptMerchantCopyEnabled !== false
    const customerCopy = settings.receiptCustomerCopyEnabled !== false
    const batchOrder = settings.receiptBatchOrderEnabled === true

    const copies: { label: string; content: string }[] = []
    if (!doublePrint) {
      copies.push({ label: 'Struk', content })
    } else {
      if (merchantCopy) {
        copies.push({ label: 'Merchant Copy', content: `<div style="text-align:center;font-size:9px;font-weight:bold;margin-bottom:4px;color:#555;">*** MERCHANT COPY ***</div>${content}` })
      }
      if (customerCopy) {
        copies.push({ label: 'Customer Copy', content: `<div style="text-align:center;font-size:9px;font-weight:bold;margin-bottom:4px;color:#555;">*** CUSTOMER COPY ***</div>${content}` })
      }
      if (batchOrder) {
        copies.push({ label: 'Batch Order', content: `<div style="text-align:center;font-size:9px;font-weight:bold;margin-bottom:4px;color:#555;">*** BATCH ORDER ***</div>${content}` })
      }
      if (copies.length === 0) {
        copies.push({ label: 'Struk', content })
      }
    }

    const combinedContent = copies.map((c, i) => {
      const separator = i > 0 ? `<div style="page-break-before:always;border-top:2px dashed #000;margin:8px 0;"></div>` : ''
      return separator + c.content
    }).join('')

    const win = window.open('', '_blank', 'width=320,height=800')
    if (!win) { toast.error('Gagal membuka jendela cetak'); return }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt${copies.length > 1 ? ` (${copies.length} copies)` : ''}</title>
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
    </head><body>${combinedContent}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print(); setTimeout(() => win.close(), 500) }, 250)
    handleClose()
  }

  // WhatsApp handler — sends receipt as clean text
  const handleWhatsApp = () => {
    if (!selectedCustomer?.whatsapp || !checkoutResult) return

    const message = generateWhatsAppReceiptText({
      cart, subtotal, pointsDiscount, promoDiscount, manualDiscountTotal,
      ppnAmount, total, paymentMethod, paidAmount, change: changeAmount,
      selectedCustomer, selectedPromo, checkoutResult, settings,
    })

    let phone = selectedCustomer.whatsapp.replace(/[^0-9]/g, '')
    if (phone.startsWith('0')) phone = phone.substring(1)
    const waUrl = `https://wa.me/62${phone}?text=${encodeURIComponent(message)}`
    window.open(waUrl, '_blank')
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

        {/* Transaction Info — label is "No. Referensi" when provisional,
            "No. Invoice" when synced. NO Status row, NO watermark, NO
            technical words on the customer-facing receipt body (requirements 2–3). */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">{contract?.receiptLabel ?? 'No. Invoice'}</span><span className="r-value-bold">{checkoutResult?.invoiceNumber}</span></div>
          <div className="r-row"><span className="r-label">Tanggal</span><span className="r-value">{formatReceiptDateTime()}</span></div>
          <div className="r-row"><span className="r-label">Customer</span><span className="r-value">{selectedCustomer ? selectedCustomer.name : 'Walk-in'}</span></div>
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

        {/* Subtle provisional footer (requirements 5–6) — small, customer-friendly,
            no technical words, no large banner. Shown on printed receipt +
            on-screen preview when not yet synced. Hidden once syncStatus='synced'. */}
        {isProvisional && (
          <>
            <hr className="r-sep" />
            <div className="r-center r-py">
              <p className="r-footer" style={{ fontSize: '8px', color: '#666' }}>
                Referensi lokal — invoice final akan diperbarui otomatis
              </p>
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
        {checkoutResult && contract && (
          <div className="flex flex-col max-h-[90vh] sm:max-h-[85vh]">
            {/* Header — STATUS CONTRACT (requirements 2–4) */}
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="shrink-0 px-5 pt-5 pb-3"
                >
                  <div className="flex items-center justify-center gap-2.5 mb-1.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${contract.iconBg}`}>
                      {contract.icon === 'loader' && (
                        <Loader2 className={`h-4 w-4 ${contract.iconColor} animate-spin`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'check' && (
                        <Check className={`h-4 w-4 ${contract.iconColor}`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'checkCircle' && (
                        <CheckCircle2 className={`h-4 w-4 ${contract.iconColor}`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'alert' && (
                        <AlertCircle className={`h-4 w-4 ${contract.iconColor}`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'cloudoff' && (
                        <CloudOff className={`h-4 w-4 ${contract.iconColor}`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'retry' && (
                        <RefreshCcw className={`h-4 w-4 ${contract.iconColor} animate-spin`} strokeWidth={1.5} />
                      )}
                      {contract.icon === 'wifiOff' && (
                        <WifiOff className={`h-4 w-4 ${contract.iconColor}`} strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="text-left">
                      <p className={`text-sm font-bold ${contract.titleColor}`}>{contract.title}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{checkoutResult.invoiceNumber}</p>
                    </div>
                  </div>

                  {/* Contract badge — the secondary status pill (requirement 2–4).
                      "Menunggu Sinkronisasi" / "Tersinkronisasi" / "Menunggu Retry" / "Menunggu Koneksi". */}
                  <div className="flex justify-center">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold ${contract.iconBg} ${contract.iconColor} border border-white/[0.04]`}>
                      {contract.icon === 'loader' && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                      {contract.icon === 'checkCircle' && <CheckCircle2 className="h-3 w-3" strokeWidth={2} />}
                      {contract.icon === 'alert' && <RefreshCcw className="h-3 w-3" strokeWidth={2} />}
                      {contract.icon === 'cloudoff' && <WifiOff className="h-3 w-3" strokeWidth={2} />}
                      {contract.badge}
                    </span>
                  </div>

                  {/* Sync error warning — shown for SYNC_FAILED with a concrete error. */}
                  {checkoutResult.syncError && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-3">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" strokeWidth={1.5} />
                      <div>
                        <p className="text-[11px] text-amber-400 font-medium">Gagal sync ke server</p>
                        <p className="text-[10px] text-amber-500">{checkoutResult.syncError}</p>
                        <p className="text-[10px] text-amber-500/80 mt-0.5">
                          Transaksi tersimpan lokal dengan eventId yang sama — retry otomatis tidak akan membuat transaksi ganda.
                        </p>
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
                disabled={printDisabled}
                className="flex-1 h-10 text-sm font-medium rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {printDisabled ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Printer className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                )}
                {printDisabled ? 'Menunggu Sync...' : 'Cetak Struk'}
              </Button>

              {/* WhatsApp button — only if customer has WhatsApp */}
              {selectedCustomer?.whatsapp && (
                <Button
                  onClick={handleWhatsApp}
                  className="flex-1 h-10 text-sm font-medium rounded-xl bg-green-600 hover:bg-green-500 text-white transition-colors"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  Kirim WA
                </Button>
              )}

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