'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Banknote,
  QrCode,
  CreditCard,
  ArrowRightLeft,
  Loader2,
  Coins,
  Tag,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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

interface Customer {
  id: string
  name: string
  whatsapp: string
  points: number
}

export interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Cart data
  cart: CartItem[]
  subtotal: number
  pointsDiscount: number
  promoDiscount: number
  manualDiscountTotal: number
  ppnAmount: number
  total: number
  // Customer
  selectedCustomer: Customer | null
  maxPointsToUse: number
  pointsToUse: number
  onPointsChange: (value: string) => void
  // Promo
  selectedPromo: { id: string; name: string; type: string; discount: number; description: string } | null
  // Payment
  paymentMethod: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'
  onPaymentMethodChange: (method: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER') => void
  paidAmount: string
  onPaidAmountChange: (value: string) => void
  change: number
  availablePaymentMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  // Theme
  themeColors: { bg: string; text: string; border: string; activeBg: string }
  // Quick nominals
  quickNominals: number[]
  ppnRate: number
  // Actions
  onCheckout: () => void
  checkingOut: boolean
}

// ==================== HELPERS ====================

const getItemPrice = (item: CartItem) => item.variant ? item.variant.price : item.product.price
const getItemEffectivePrice = (item: CartItem) => item.customPrice != null ? item.customPrice : getItemPrice(item)
const getItemDisplayName = (item: CartItem) => item.variant ? `${item.product.name} - ${item.variant.name}` : item.product.name
const getCartKey = (productId: string, variantId: string | null) => variantId ? `${productId}_${variantId}` : productId

const PAYMENT_METHOD_CONFIG: Record<string, { icon: typeof Banknote; label: string; description: string }> = {
  CASH: { icon: Banknote, label: 'Tunai', description: 'Bayar dengan uang tunai' },
  QRIS: { icon: QrCode, label: 'QRIS', description: 'Scan QR untuk bayar' },
  DEBIT: { icon: CreditCard, label: 'Debit', description: 'Tap atau gesek kartu' },
  TRANSFER: { icon: ArrowRightLeft, label: 'Transfer', description: 'Transfer bank' },
}

// ==================== COMPONENT ====================

export function PaymentDialog({
  open,
  onOpenChange,
  cart,
  subtotal,
  pointsDiscount,
  promoDiscount,
  manualDiscountTotal,
  ppnAmount,
  total,
  selectedCustomer,
  maxPointsToUse,
  pointsToUse,
  onPointsChange,
  selectedPromo,
  paymentMethod,
  onPaymentMethodChange,
  paidAmount,
  onPaidAmountChange,
  change,
  availablePaymentMethods,
  themeColors,
  quickNominals,
  ppnRate,
  onCheckout,
  checkingOut,
}: PaymentDialogProps) {
  const [animKey, setAnimKey] = useState(0)

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onOpenChange(false)
      // Reset animation key for next open
      setAnimKey(k => k + 1)
    } else {
      onOpenChange(true)
    }
  }

  const totalItems = cart.reduce((s, i) => s + i.qty, 0)

  const canPay =
    cart.length > 0 &&
    !checkingOut &&
    (paymentMethod !== 'CASH' || Number(paidAmount) >= total)

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="max-w-lg rounded-2xl overflow-hidden !p-0"
        className="!p-0"
        showCloseButton={false}
      >
        <div className="flex flex-col max-h-[90vh] sm:max-h-[85vh]">
          {/* Header */}
          <div className="shrink-0 px-5 pt-5 pb-4 bg-gradient-to-b from-white/[0.03] to-transparent">
            <div className="flex items-center justify-between mb-3">
              <ResponsiveDialogHeader className="space-y-0 !p-0">
                <ResponsiveDialogTitle className="text-base font-bold text-white flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg theme-bg-subtle flex items-center justify-center">
                    <Banknote className="h-3.5 w-3.5 theme-text" strokeWidth={1.5} />
                  </div>
                  Pembayaran
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-[11px] text-slate-500">
                  {totalItems} item dalam keranjang
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Total</p>
                <p className="text-xl font-black text-white tabular-nums">{formatCurrency(total)}</p>
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-5 pb-5 space-y-4">
              {/* Order Summary */}
              <div className="aether-card p-3.5 space-y-2">
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Ringkasan Pesanan</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {cart.map((item) => {
                    const itemSubtotal = getItemPrice(item) * item.qty
                    const effSubtotal = getItemEffectivePrice(item) * item.qty
                    const hasCustomPrice = item.customPrice != null
                    return (
                    <div
                      key={getCartKey(item.product.id, item.variant?.id || null)}
                    >
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-slate-300 truncate">
                          {getItemDisplayName(item)}
                          <span className="text-slate-500 ml-1">×{item.qty}</span>
                          {hasCustomPrice && (
                            <span className="ml-1 text-amber-400">@{formatCurrency(item.customPrice!)}</span>
                          )}
                        </span>
                        <span className={cn('font-medium shrink-0 tabular-nums', hasCustomPrice ? 'text-amber-400' : 'text-slate-200')}>
                          {formatCurrency(effSubtotal)}
                        </span>
                      </div>
                    </div>
                    )
                  })}
                </div>
                <Separator className="bg-white/[0.04] !my-2" />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal</span>
                    <span className="text-slate-200 tabular-nums">{formatCurrency(subtotal)}</span>
                  </div>
                  {pointsDiscount > 0 && (
                    <div className="flex justify-between theme-text">
                      <span className="flex items-center gap-1"><Coins className="h-3 w-3" strokeWidth={1.5} /> Diskon Poin</span>
                      <span className="tabular-nums">-{formatCurrency(pointsDiscount)}</span>
                    </div>
                  )}
                  {promoDiscount > 0 && selectedPromo && (
                    <div className="flex justify-between text-amber-400">
                      <span className="flex items-center gap-1"><Tag className="h-3 w-3" strokeWidth={1.5} /> {selectedPromo.name}</span>
                      <span className="tabular-nums">-{formatCurrency(promoDiscount)}</span>
                    </div>
                  )}
                  {manualDiscountTotal > 0 && (
                    <div className="flex justify-between text-amber-400">
                      <span className="flex items-center gap-1"><Tag className="h-3 w-3" strokeWidth={1.5} /> Diskon Manual</span>
                      <span className="tabular-nums">-{formatCurrency(manualDiscountTotal)}</span>
                    </div>
                  )}
                  {ppnAmount > 0 && (
                    <div className="flex justify-between text-sky-300 font-medium">
                      <span>PPN ({ppnRate}%)</span>
                      <span className="tabular-nums">+{formatCurrency(ppnAmount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Points (if applicable) */}
              {maxPointsToUse > 0 && selectedCustomer && (
                <div className="aether-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Coins className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.5} />
                      <span className="text-xs text-slate-300 font-medium">Pakai Poin</span>
                      <span className="text-[10px] text-slate-500">({maxPointsToUse} tersedia)</span>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={maxPointsToUse}
                      value={pointsToUse || ''}
                      onChange={(e) => onPointsChange(e.target.value)}
                      placeholder="0"
                      className="w-24 h-8 text-right text-xs bg-white/[0.04] border-white/[0.08] text-white rounded-lg"
                    />
                  </div>
                </div>
              )}

              {/* Customer info */}
              {selectedCustomer && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl aether-card">
                  <User className="h-3.5 w-3.5 text-slate-500 shrink-0" strokeWidth={1.5} />
                  <span className="text-xs text-slate-300 font-medium truncate">{selectedCustomer.name}</span>
                  {selectedCustomer.whatsapp && (
                    <span className="text-[10px] text-slate-500 ml-auto shrink-0">{selectedCustomer.whatsapp}</span>
                  )}
                </div>
              )}

              {/* Payment Method Selection — Large Cards */}
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Metode Pembayaran</p>
                <div className="grid grid-cols-2 gap-2">
                  {availablePaymentMethods.map((method) => {
                    const config = PAYMENT_METHOD_CONFIG[method]
                    const Icon = config.icon
                    const isActive = paymentMethod === method
                    return (
                      <button
                        key={method}
                        onClick={() => onPaymentMethodChange(method)}
                        className={cn(
                          'relative flex flex-col items-center gap-1.5 p-4 rounded-2xl border text-center transition-all duration-200',
                          isActive
                            ? 'theme-bg-very-light border-theme-border-light shadow-sm'
                            : 'aether-card hover:border-white/[0.1] active:scale-[0.98]'
                        )}
                      >
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
                          isActive ? 'theme-bg-subtle' : 'bg-white/[0.06]'
                        )}>
                          <Icon className={cn('h-5 w-5', isActive ? 'theme-text' : 'text-slate-500')} strokeWidth={1.5} />
                        </div>
                        <div>
                          <p className={cn('text-xs font-bold', isActive ? 'text-white' : 'text-slate-300')}>{config.label}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{config.description}</p>
                        </div>
                        {isActive && (
                          <motion.div
                            key={method + animKey}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute top-2 right-2 w-4 h-4 rounded-full theme-bg flex items-center justify-center"
                          >
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </motion.div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Cash Payment Section */}
              <AnimatePresence mode="wait">
                {paymentMethod === 'CASH' && (
                  <motion.div
                    key="cash-section"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Jumlah Bayar</p>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={paidAmount}
                          onChange={(e) => onPaidAmountChange(e.target.value)}
                          placeholder="0"
                          className="h-12 text-base font-bold bg-white/[0.03] border-white/[0.08] text-white placeholder:text-slate-600 rounded-xl text-right pr-14 tabular-nums"
                        />
                        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">Rp</span>
                      </div>
                    </div>

                    {/* Change display */}
                    {Number(paidAmount) >= total && total > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center justify-between theme-bg-very-light border theme-border-light rounded-xl px-4 py-3"
                      >
                        <span className="theme-text font-medium text-sm">Kembalian</span>
                        <span className="theme-text font-black text-lg tabular-nums">{formatCurrency(change)}</span>
                      </motion.div>
                    )}

                    {/* Quick nominals */}
                    <div className="space-y-2">
                      <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Nominal Cepat</p>
                      <div className="grid grid-cols-3 gap-2">
                        {quickNominals.map((nom) => (
                          <button
                            key={nom}
                            onClick={() => onPaidAmountChange(String(nom))}
                            className={cn(
                              'py-2.5 rounded-xl text-xs font-bold border transition-all active:scale-95',
                              Number(paidAmount) === nom
                                ? 'theme-bg-subtle theme-text theme-border-medium shadow-sm'
                                : 'bg-white/[0.04] border-white/[0.06] text-slate-300 hover:border-white/[0.1] active:bg-white/[0.04]'
                            )}
                          >
                            {nom >= 1000 ? `${nom / 1000}K` : nom}
                          </button>
                        ))}
                        {total > 0 && (
                          <button
                            onClick={() => onPaidAmountChange(String(Math.ceil(total / 1000) * 1000))}
                            className="py-2.5 rounded-xl text-xs font-bold border bg-amber-500/5 border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-all active:scale-95"
                          >
                            Uang Pas
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Non-cash confirmation */}
              {paymentMethod !== 'CASH' && (
                <div className="aether-card p-5 text-center">
                  <p className="text-xs text-slate-400">
                    Pembayaran <span className="font-bold text-slate-200 uppercase">{paymentMethod}</span>
                  </p>
                  <p className="text-2xl font-black text-white mt-2 tabular-nums">{formatCurrency(total)}</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer — sticky */}
          <div className="shrink-0 border-t border-white/[0.06] bg-deep-space/95 backdrop-blur-sm px-5 pt-3.5 pb-5 sm:pb-5">
            <Button
              onClick={onCheckout}
              disabled={!canPay}
              className={cn(
                'w-full h-12 font-bold text-sm rounded-2xl transition-all active:scale-[0.99]',
                canPay
                  ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow'
                  : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
              )}
            >
              {checkingOut ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Memproses...
                </>
              ) : (
                `Bayar Sekarang · ${formatCurrency(total)}`
              )}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}