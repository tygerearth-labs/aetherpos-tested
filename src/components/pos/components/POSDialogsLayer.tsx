'use client'

import { type RefObject } from 'react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB, type PendingTransaction } from '@/lib/local-db'
import {
  Layers,
  Loader2,
  Package,
  UserPlus,
  ClockArrowDown,
  MessageSquare,
  ShoppingCart,
  X,
  Check,
  CloudOff,
  Clock,
  User,
} from 'lucide-react'

import { PaymentDialog } from '../../pos/payment-dialog'
import { ReceiptDialog } from '../../pos/receipt-dialog'
import { CustomerSelector } from './CustomerSelector'
import CartItemList from './CartItemList'
import CartSummary from './CartSummary'
import PendingTransactionsList from './PendingTransactionsList'

// ==================== TYPES ====================

export interface VariantPickerState {
  open: boolean
  product: any
  variants: any[]
  loading: boolean
}

export interface PaymentDialogProps {
  cartItems: any[]
  subtotal: number
  total: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  ppnAmount: number
  paymentMethod: string
  paidAmount: string
  change: number
  settings: any
  selectedCustomer: any
  maxPointsToUse: number
  pointsToUse: number
  onPaymentMethodChange: (method: string) => void
  onPaidAmountChange: (amount: string) => void
  onPointsChange: (val: string) => void
  onCheckout: () => void
  checkingOut: boolean
  checkoutResult: any
  availablePaymentMethods: Array<{ value: string; label: string }>
  getItemPrice: (item: any) => number
  getEffectivePrice: (item: any) => number
  getItemDisplayName: (item: any) => string
  getQuickNominals: () => number[]
  hasBelowHpp: boolean
  belowHppItems: any[]
  belowHppTotalLoss: number
  editingQtyId: string | null
  editingQtyValue: number
  startEditQty: (key: string, val: number) => void
  confirmEditQty: () => void
  cancelEditQty: () => void
  qtyInputRef: RefObject<HTMLInputElement>
  updateQty: (pid: string, qty: number, vid?: string) => void
  removeFromCart: (pid: string, vid?: string) => void
  getItemStock: (item: any) => number
  getCartKey: (pid: string, vid: string | null) => string
  selectedPromo: any
  availablePromos: any[]
  onPromoSelect: (promo: any) => void
  promoLoading: boolean
}

export interface ReceiptDialogProps {
  checkoutResult: any
  cartItems: any[]
  subtotal: number
  total: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  ppnAmount: number
  paymentMethod: string
  paidAmount: string
  change: number
  settings: any
  outletInfo: any
  selectedCustomer: any
  onFinish: () => void
  getItemPrice: (item: any) => number
  getEffectivePrice: (item: any) => number
  getItemDisplayName: (item: any) => string
  selectedPromo: any
}

export interface NewCustomerState {
  name: string
  whatsapp: string
}

export interface MobileCartCustomerProps {
  selectedCustomer: any
  customerSearch: string
  filteredCustomers: any[]
  customerDropdownOpen: boolean
  manualDiscountEnabled: boolean
  onCustomerSearchChange: (v: string) => void
  onCustomerDropdownOpen: (open: boolean) => void
  onSelectCustomer: (c: any) => void
  onClearCustomer: () => void
  onAddNewCustomer: () => void
  onSetPointsToUse: (p: number) => void
}

export interface MobileCartItemsProps {
  cart: any[]
  getCartKey: (pid: string, vid: string | null) => string
  getItemPrice: (item: any) => number
  getEffectivePrice: (item: any) => number
  getItemStock: (item: any) => number
  editingQtyId: string | null
  editingQtyValue: number
  editingPriceId: string | null
  editingPriceValue: number
  priceInputRef: RefObject<HTMLInputElement>
  qtyInputRef: RefObject<HTMLInputElement>
  onUpdateQty: (pid: string, qty: number, vid?: string) => void
  onRemoveFromCart: (pid: string, vid?: string) => void
  onStartEditQty: (key: string, val: number) => void
  onConfirmEditQty: () => void
  onCancelEditQty: () => void
  onStartEditPrice: (key: string, val: number) => void
  onConfirmEditPrice: () => void
  onCancelEditPrice: () => void
  batchInfo: any
  manualDiscountEnabled: boolean
}

export interface MobileCartSummaryProps {
  subtotal: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  ppnAmount: number
  total: number
  paidAmount: string
  change: number
  hasBelowHpp: boolean
  belowHppItems: any[]
  maxPointsToUse: number
  pointsToUse: number
  ppnEnabled: boolean
  loyaltyEnabled: boolean
  ppnRate: number
  customerPoints: number
  loyaltyPointValue: number
  promoName?: string
  onSetPointsToUse: (val: number) => void
  onSetPaidAmount: (amount: string) => void
}

export interface MobileCartActionsProps {
  onHoldTransaction: () => void
  openPaymentDialog: () => void
  hasBelowHpp: boolean
  cartTotal: number
}

// ==================== MAIN PROPS INTERFACE ====================

export interface POSDialogsLayerProps {
  // === VARIANT PICKER ===
  variantPicker: VariantPickerState
  onVariantPickerChange: (open: boolean) => void
  onVariantPickerSet: (picker: VariantPickerState) => void
  onVariantSelect: (variant: any) => void

  // === PAYMENT DIALOG ===
  paymentDialogOpen: boolean
  onPaymentDialogOpen: (open: boolean) => void
  paymentDialogProps: PaymentDialogProps

  // === RECEIPT DIALOG ===
  receiptDialogOpen: boolean
  onReceiptDialogOpen: (open: boolean) => void
  receiptDialogProps: ReceiptDialogProps

  // === ADD CUSTOMER DIALOG ===
  addCustomerOpen: boolean
  onAddCustomerOpen: (open: boolean) => void
  newCustomer: NewCustomerState
  onNewCustomerChange: (customer: NewCustomerState) => void
  onAddCustomer: () => void
  addingCustomer: boolean

  // === PENDING TRANSACTIONS DIALOG ===
  pendingListOpen: boolean
  onPendingListOpen: (open: boolean) => void
  onResumePending: (pending: PendingTransaction) => void
  onDeletePending: (id: number) => void
  pendingCount: number

  // === HOLD NOTE DIALOG ===
  holdNoteOpen: boolean
  onHoldNoteOpen: (open: boolean) => void
  holdNote: string
  onHoldNoteChange: (note: string) => void
  onConfirmHold: () => void
  onCancelHold: () => void

  // === MOBILE CART SHEET ===
  mobileCartOpen: boolean
  onMobileCartOpen: (open: boolean) => void
  mobileCartCustomerProps: MobileCartCustomerProps
  mobileCartItemsProps: MobileCartItemsProps
  mobileCartSummaryProps: MobileCartSummaryProps
  mobileCartActionsProps: MobileCartActionsProps
  mobileCartItemCount: number
  mobileCartTotalQty: number

  // === OFFLINE SYNC LIST DIALOG ===
  offlineListOpen: boolean
  onOfflineListOpen: (open: boolean) => void
  isOnline: boolean
  offlineList: any[]
  onSynced: () => void
}

// ==================== PENDING LIST SUB-COMPONENT ====================

function PendingListContent({
  onResume,
  onDelete,
}: {
  onResume: (pending: PendingTransaction) => void
  onDelete: (id: number) => void
}) {
  const pendingList = useLiveQuery(
    () => localDB.pendingTransactions.orderBy('createdAt').reverse().toArray(),
    []
  )

  if (!pendingList) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  if (pendingList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3.5 border border-white/[0.06]">
          <ClockArrowDown className="h-7 w-7 text-slate-600" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-white font-bold">Belum Ada yang Ditunda</p>
        <p className="text-[11px] text-slate-500 mt-1.5 max-w-[220px] mx-auto leading-relaxed">
          Saat melayani pelanggan, Anda bisa menunda transaksi yang sedang berjalan lalu melanjutkannya nanti.
        </p>
        <div className="mt-4 mx-auto max-w-[260px] px-3 py-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/[0.08]">
          <p className="text-[10px] text-amber-400/80 leading-relaxed text-left">
            {'💡 '}<span className="font-medium text-amber-400">Tip:</span> Gunakan tombol <span className="font-semibold text-white">Tunda</span> di keranjang untuk menahan sementara pesanan ini.
          </p>
        </div>
      </div>
    )
  }

  const formatRelativeTime = (ts: number) => {
    const diff = Date.now() - ts
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'Baru saja'
    if (minutes < 60) return `${minutes} menit lalu`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} jam lalu`
    const days = Math.floor(hours / 24)
    return `${days} hari lalu`
  }

  return (
    <div className="space-y-2.5 py-2 max-h-[60vh] overflow-y-auto">
      {pendingList.map((pending) => {
        const items = pending.items as Array<{ product: { name: string; image: string | null }; variant: { name: string } | null; qty: number }>
        const totalItems = items.reduce((s, i) => s + i.qty, 0)

        return (
          <div key={pending.id} className="relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] border-l-amber-500/30 p-3.5 space-y-3">
            {/* Delete button overlay top-right */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(pending.id!)}
              className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </Button>

            {/* Header: time + user + item count | subtotal */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" strokeWidth={1.5} />
                    {formatRelativeTime(pending.createdAt)}
                  </span>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {pending.userName}
                  </Badge>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {totalItems} item
                  </Badge>
                </div>
              </div>
              <div className="shrink-0">
                <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(pending.subtotal)}</p>
              </div>
            </div>

            {/* Items preview — mini receipt look */}
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] border-l-2 border-l-white/[0.06] overflow-hidden">
              <div className="space-y-0.5 px-3 py-2">
                {items.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-slate-500 w-5 text-right shrink-0">{item.qty}×</span>
                    <span className="text-slate-300 truncate">{item.product.name}</span>
                    {item.variant && (
                      <span className="text-slate-600 text-[10px] truncate">{item.variant.name}</span>
                    )}
                  </div>
                ))}
                {items.length > 3 && (
                  <p className="text-[10px] text-slate-600 pl-7">+{items.length - 3} item lainnya</p>
                )}
              </div>
            </div>

            {/* Note — chat bubble style */}
            {pending.note && (
              <div className="flex items-start gap-1.5">
                <MessageSquare className="h-3 w-3 text-slate-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div className="rounded-xl rounded-tl-sm bg-white/[0.03] border border-white/[0.05] px-3 py-2 max-w-full">
                  <p className="text-[11px] text-slate-400 leading-relaxed">{pending.note}</p>
                </div>
              </div>
            )}

            {/* Customer */}
            {pending.customerName && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <User className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
                <span className="font-medium text-slate-300">{pending.customerName}</span>
              </div>
            )}

            {/* Action — full width resume button */}
            <Button size="sm" onClick={() => onResume(pending)}
              className="w-full h-8.5 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors">
              <ShoppingCart className="mr-1.5 h-3 w-3" /> Lanjutkan ke Keranjang
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ==================== MAIN COMPONENT ====================

export function POSDialogsLayer({
  // Variant Picker
  variantPicker,
  onVariantPickerChange,
  onVariantPickerSet,
  onVariantSelect,
  // Payment Dialog
  paymentDialogOpen,
  onPaymentDialogOpen,
  paymentDialogProps,
  // Receipt Dialog
  receiptDialogOpen,
  onReceiptDialogOpen,
  receiptDialogProps,
  // Add Customer Dialog
  addCustomerOpen,
  onAddCustomerOpen,
  newCustomer,
  onNewCustomerChange,
  onAddCustomer,
  addingCustomer,
  // Pending Transactions Dialog
  pendingListOpen,
  onPendingListOpen,
  onResumePending,
  onDeletePending,
  pendingCount,
  // Hold Note Dialog
  holdNoteOpen,
  onHoldNoteOpen,
  holdNote,
  onHoldNoteChange,
  onConfirmHold,
  onCancelHold,
  // Mobile Cart Sheet
  mobileCartOpen,
  onMobileCartOpen,
  mobileCartCustomerProps,
  mobileCartItemsProps,
  mobileCartSummaryProps,
  mobileCartActionsProps,
  mobileCartItemCount,
  mobileCartTotalQty,
  // Offline Sync List Dialog
  offlineListOpen,
  onOfflineListOpen,
  isOnline,
  offlineList,
  onSynced,
}: POSDialogsLayerProps) {
  return (
    <>
      {/* ══════ DIALOGS ══════ */}

      {/* Variant Picker Dialog */}
      <ResponsiveDialog open={variantPicker.open} onOpenChange={(open) => { if (!open) onVariantPickerSet({ product: null as unknown as any, open: false, variants: [], loading: false }) }}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
              Pilih Varian — {variantPicker.product?.name}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400">
              Pilih varian yang diinginkan
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
            {variantPicker.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
              </div>
            ) : variantPicker.variants.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-slate-500">Tidak ada varian tersedia</p>
              </div>
            ) : (
              variantPicker.variants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => onVariantSelect(variant)}
                  disabled={variant.stock <= 0}
                  className={cn(
                    'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all text-left',
                    variant.stock <= 0
                      ? 'bg-white/[0.02] border-white/[0.04] opacity-50 cursor-not-allowed'
                      : 'aether-card hover:bg-white/[0.04] active:scale-[0.98]'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-medium text-slate-200">{variant.name}</span>
                    {variant.sku && (
                      <span className="text-[10px] text-slate-500 font-mono">{variant.sku}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {variant.stock <= 0 ? (
                      <span className="text-[10px] text-red-400 font-medium">Habis</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Stok: {variant.stock}</span>
                    )}
                    <span className="text-xs font-bold text-slate-300 tabular-nums">{formatCurrency(variant.price)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={onPaymentDialogOpen}
        {...paymentDialogProps}
      />

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={onReceiptDialogOpen}
        {...receiptDialogProps}
      />

      {/* Add Customer Dialog */}
      <ResponsiveDialog open={addCustomerOpen} onOpenChange={onAddCustomerOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              Pelanggan Baru
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-500">
              Tambahkan pelanggan baru ke database
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-slate-400 font-medium">Nama *</Label>
              <Input
                value={newCustomer.name}
                onChange={(e) => onNewCustomerChange({ ...newCustomer, name: e.target.value })}
                placeholder="Nama pelanggan"
                className="h-10 text-sm bg-white/[0.04] border-white/[0.08] text-white rounded-xl"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-slate-400 font-medium">WhatsApp</Label>
              <Input
                value={newCustomer.whatsapp}
                onChange={(e) => onNewCustomerChange({ ...newCustomer, whatsapp: e.target.value })}
                placeholder="08xxxxxxxxxx"
                className="h-10 text-sm bg-white/[0.04] border-white/[0.08] text-white rounded-xl"
              />
            </div>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => onAddCustomerOpen(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">
              Batal
            </Button>
            <Button onClick={onAddCustomer} disabled={addingCustomer}
              className="theme-bg hover:theme-hover text-white text-xs rounded-xl font-medium">
              {addingCustomer ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Menyimpan...</> : <><UserPlus className="mr-1.5 h-3 w-3" /> Simpan</>}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Pending Transactions Dialog */}
      <ResponsiveDialog open={pendingListOpen} onOpenChange={onPendingListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-md rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <ClockArrowDown className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              Transaksi Ditunda
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400 flex items-center gap-2 pt-1">
              Keranjang yang ditunda bisa dilanjutkan kapan saja
              {pendingCount > 0 && (
                <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] px-2 py-0.5 h-5 font-semibold">{pendingCount}</Badge>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <PendingListContent
            onResume={onResumePending}
            onDelete={onDeletePending}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Hold Note Dialog */}
      <ResponsiveDialog open={holdNoteOpen} onOpenChange={onHoldNoteOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-amber-400" strokeWidth={1.5} /> Catatan Tunda
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-500">
              Tambahkan catatan opsional untuk transaksi ini
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            <textarea
              value={holdNote}
              onChange={(e) => onHoldNoteChange(e.target.value)}
              placeholder="Contoh: customer minta ditunda, menunggu pembayaran..."
              rows={3}
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-slate-600 text-sm rounded-xl px-3.5 py-2.5 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 focus-visible:border-cyan-500/30 transition-all"
            />
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={onCancelHold}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">
              Batal
            </Button>
            <Button onClick={onConfirmHold}
              className="theme-bg hover:theme-hover text-white text-xs rounded-xl font-medium">
              <ClockArrowDown className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
              Tunda Transaksi
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Mobile Cart Sheet */}
      <Sheet open={mobileCartOpen} onOpenChange={onMobileCartOpen}>
        <SheetContent side="bottom" className="flex flex-col h-[85vh] p-0 bg-deep-space rounded-t-2xl">
          {/* Sheet Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 theme-text" strokeWidth={1.5} />
              <h2 className="text-sm font-bold text-white">Keranjang</h2>
              <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[10px] px-1.5 py-0 h-5">
                {mobileCartItemCount} · {mobileCartTotalQty} item
              </Badge>
            </div>
            <button onClick={() => onMobileCartOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          {/* Sheet Body — scrollable */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <CustomerSelector
              {...mobileCartCustomerProps}
              isMobileView={true}
            />
            <CartItemList
              cart={mobileCartItemsProps.cart}
              compact={false}
              {...mobileCartItemsProps}
            />

            {/* Summary Section */}
            {mobileCartItemsProps.cart.length > 0 && (
              <div className="px-4 py-3 space-y-2 border-t border-white/[0.06] mt-2">
                <CartSummary
                  {...mobileCartSummaryProps}
                  formatCurrency={formatCurrency}
                />
              </div>
            )}
          </div>

          {/* Sheet Footer — sticky action buttons */}
          {mobileCartItemsProps.cart.length > 0 && (
            <div className="shrink-0 px-4 py-3 border-t border-white/[0.06] bg-nebula/95 backdrop-blur-xl space-y-2">
              <div className="flex gap-2">
                <Button onClick={mobileCartActionsProps.onHoldTransaction} variant="outline"
                  className="flex-1 h-11 font-semibold text-sm rounded-xl border-white/[0.08] text-slate-300">
                  <ClockArrowDown className="mr-1 h-4 w-4" strokeWidth={1.5} />
                  Tunda
                </Button>
                <Button onClick={mobileCartActionsProps.openPaymentDialog} disabled={mobileCartActionsProps.hasBelowHpp}
                  className={`flex-1 h-11 font-bold text-sm rounded-xl transition-all ${
                    !mobileCartActionsProps.hasBelowHpp
                      ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow'
                      : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
                  }`}>
                  <Check className="mr-1 h-4 w-4" strokeWidth={1.5} />
                  Bayar {formatCurrency(mobileCartActionsProps.cartTotal)}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Offline Sync List Dialog */}
      <ResponsiveDialog open={offlineListOpen} onOpenChange={onOfflineListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-lg rounded-2xl max-h-[85vh] flex flex-col">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <CloudOff className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              Daftar Offline
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400">
              Transaksi yang belum tersinkronisasi ke server
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <PendingTransactionsList
            isOnline={isOnline}
            onSynced={onSynced}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

export default POSDialogsLayer
