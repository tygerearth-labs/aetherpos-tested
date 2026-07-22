'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Loader2,
  Coins,
  Check,
  AlertTriangle,
  Banknote,
  QrCode,
  CreditCard,
  ArrowRightLeft,
  Tag,
} from 'lucide-react'

// ==================== TYPES ====================

/** Available payment method option */
export interface PaymentMethodOption {
  value: string
  label: string
}

/** Selected promo information */
export interface PromoInfo {
  id: string
  name: string
  type: string
  discount: number
  description: string
}

/**
 * Props for the PaymentPanel component.
 * Contains all state and callbacks needed to render the payment UI.
 */
export interface PaymentPanelProps {
  // Payment state from usePosCheckout
  /** Currently selected payment method (e.g., 'CASH', 'QRIS', 'TRANSFER') */
  paymentMethod: string
  /** Amount entered by customer as payment */
  paidAmount: string
  /** Calculated change amount */
  change: number
  /** Total amount to be paid */
  total: number

  // Available options
  /** List of available payment methods */
  availablePaymentMethods: Array<{ value: string; label: string }>
  /** Quick nominal amounts for fast cash entry */
  quickNominals: number[]

  // Processing state
  /** Whether checkout is currently processing */
  isProcessing: boolean
  /** Whether checkout can be performed */
  canCheckout: boolean

  // Promo info (optional)
  /** Currently selected promo, if any */
  selectedPromo: PromoInfo | null
  /** Whether promo data is loading */
  promoLoading: boolean
  /** Discount amount from promo */
  promoDiscount: number

  // Callbacks
  /** Called when payment method changes */
  onPaymentMethodChange: (method: string) => void
  /** Called when paid amount changes */
  onPaidAmountChange: (amount: string) => void
  /** Called when checkout is initiated */
  onCheckout: () => void
  /** Called when a quick nominal button is pressed */
  onQuickNominal: (amount: number) => void

  // UI state
  /** Whether the view is in mobile mode */
  isMobile: boolean
}

// ==================== CONSTANTS ====================

/** Configuration for each payment method type */
const PAYMENT_METHOD_CONFIG: Record<
  string,
  { icon: typeof Banknote; label: string; description: string }
> = {
  CASH: { icon: Banknote, label: 'Tunai', description: 'Bayar dengan uang tunai' },
  QRIS: { icon: QrCode, label: 'QRIS', description: 'Scan QR untuk bayar' },
  QRISS: { icon: QrCode, label: 'QRIS', description: 'Scan QR untuk bayar' },
  DEBIT: { icon: CreditCard, label: 'Debit', description: 'Tap atau gesek kartu' },
  TRANSFER: { icon: ArrowRightLeft, label: 'Transfer', description: 'Transfer bank' },
}

// ==================== COMPONENT ====================

/**
 * PaymentPanel — Presentational component for POS payment selection and processing.
 *
 * Renders:
 * - Payment method selector (card-based or dropdown)
 * - Cash payment input with quick nominal buttons
 * - Change calculation display
 * - Non-cash confirmation summary
 * - Checkout/Pay button
 * - Promo information badge
 *
 * This component is purely presentational — all business logic and state management
 * is handled by the parent via props and callbacks.
 *
 * @example
 * ```tsx
 * <PaymentPanel
 *   paymentMethod="CASH"
 *   paidAmount="50000"
 *   change={5000}
 *   total={45000}
 *   availablePaymentMethods={[{ value: 'CASH', label: 'Tunai' }]}
 *   quickNominals={[5000, 10000, 20000, 50000]}
 *   isProcessing={false}
 *   canCheckout={true}
 *   selectedPromo={null}
 *   promoLoading={false}
 *   promoDiscount={0}
 *   onPaymentMethodChange={(m) => setPaymentMethod(m)}
 *   onPaidAmountChange={(a) => setPaidAmount(a)}
 *   onCheckout={() => handlePay()}
 *   onQuickNominal={(n) => setPaidAmount(String(n))}
 *   isMobile={false}
 * />
 * ```
 */
export function PaymentPanel({
  paymentMethod,
  paidAmount,
  change,
  total,
  availablePaymentMethods,
  quickNominals,
  isProcessing,
  canCheckout,
  selectedPromo,
  promoLoading,
  promoDiscount,
  onPaymentMethodChange,
  onPaidAmountChange,
  onCheckout,
  onQuickNominal,
  isMobile,
}: PaymentPanelProps) {
  const isCash = paymentMethod === 'CASH'
  const paidNum = Number(paidAmount) || 0
  const showChange = isCash && paidNum >= total && total > 0

  return (
    <div className="space-y-4">
      {/* ══════════ PROMO DISPLAY ══════════ */}
      {(selectedPromo || promoLoading) && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/[0.12]">
          <Tag className="h-3.5 w-3.5 text-amber-400 shrink-0" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            {promoLoading ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                <span className="text-[11px] text-amber-400/80">Memuat promo...</span>
              </div>
            ) : selectedPromo ? (
              <>
                <p className="text-xs font-medium text-amber-300 truncate">
                  {selectedPromo.name}
                </p>
                {selectedPromo.description && (
                  <p className="text-[10px] text-amber-400/70 truncate mt-0.5">
                    {selectedPromo.description}
                  </p>
                )}
              </>
            ) : null}
          </div>
          {promoDiscount > 0 && (
            <Badge
              variant="secondary"
              className="shrink-0 bg-amber-500/15 text-amber-300 border-amber-500/20 text-[10px] px-2 py-0 h-5 font-semibold"
            >
              -{formatCurrency(promoDiscount)}
            </Badge>
          )}
        </div>
      )}

      {/* ══════════ PAYMENT METHOD SELECTION ══════════ */}
      <div className="space-y-2">
        <Label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
          Metode Pembayaran
        </Label>

        {/* Desktop: Card-based selector */}
        {!isMobile && (
          <div className="grid grid-cols-2 gap-2">
            {availablePaymentMethods.map((methodOption) => {
              const config = PAYMENT_METHOD_CONFIG[methodOption.value]
              if (!config) return null

              const Icon = config.icon
              const isActive = paymentMethod === methodOption.value

              return (
                <button
                  key={methodOption.value}
                  type="button"
                  onClick={() => onPaymentMethodChange(methodOption.value)}
                  className={cn(
                    'relative flex flex-col items-center gap-1.5 p-4 rounded-2xl border text-center transition-all duration-200',
                    isActive
                      ? 'theme-bg-very-light border-theme-border-light shadow-sm'
                      : 'aether-card hover:border-white/[0.1] active:scale-[0.98]'
                  )}
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
                      isActive ? 'theme-bg-subtle' : 'bg-white/[0.06]'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isActive ? 'theme-text' : 'text-slate-500'
                      )}
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <p
                      className={cn(
                        'text-xs font-bold',
                        isActive ? 'text-white' : 'text-slate-300'
                      )}
                    >
                      {config.label}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {config.description}
                    </p>
                  </div>
                  {/* Active indicator */}
                  {isActive && (
                    <motion.div
                      key={methodOption.value}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute top-2 right-2 w-4 h-4 rounded-full theme-bg flex items-center justify-center"
                    >
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </motion.div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Mobile: Compact dropdown selector */}
        {isMobile && (
          <Select value={paymentMethod} onValueChange={onPaymentMethodChange}>
            <SelectTrigger className="w-full h-11 bg-nebula border-white/[0.08] text-slate-200 text-sm rounded-xl">
              <SelectValue placeholder="Pilih metode pembayaran" />
            </SelectTrigger>
            <SelectContent className="bg-nebula border-white/[0.08]">
              {availablePaymentMethods.map((methodOption) => {
                const config = PAYMENT_METHOD_CONFIG[methodOption.value]
                if (!config) return null

                const Icon = config.icon
                return (
                  <SelectItem
                    key={methodOption.value}
                    value={methodOption.value}
                    className="text-sm text-slate-200 focus:bg-white/[0.04] focus:text-white"
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                      <span>{config.label}</span>
                    </div>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ══════════ CASH PAYMENT SECTION ══════════ */}
      <AnimatePresence mode="wait">
        {isCash && (
          <motion.div
            key="cash-section"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {/* Paid Amount Input */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                Jumlah Bayar
              </Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={paidAmount}
                  onChange={(e) => onPaidAmountChange(e.target.value)}
                  placeholder="0"
                  className={cn(
                    'h-12 text-base font-bold bg-white/[0.03] border-white/[0.08] text-white placeholder:text-slate-600 rounded-xl text-right pr-14 tabular-nums',
                    paidNum > 0 && paidNum < total && total > 0
                      ? 'border-amber-500/30 focus:border-amber-500/50'
                      : ''
                  )}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">
                  Rp
                </span>
              </div>
              {/* Warning for insufficient payment */}
              {paidNum > 0 && paidNum < total && total > 0 && (
                <p className="flex items-center gap-1 text-[10px] text-amber-400/80 mt-1">
                  <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
                  Kurang {formatCurrency(total - paidNum)}
                </p>
              )}
            </div>

            {/* Change Display */}
            {showChange && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-between theme-bg-very-light border theme-border-light rounded-xl px-4 py-3"
              >
                <span className="theme-text font-medium text-sm">Kembalian</span>
                <span className="theme-text font-black text-lg tabular-nums">
                  {formatCurrency(change)}
                </span>
              </motion.div>
            )}

            {/* Quick Nominals */}
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                Nominal Cepat
              </p>
              <div className={cn('grid gap-2', isMobile ? 'grid-cols-3' : 'grid-cols-3')}>
                {quickNominals.map((nom) => (
                  <button
                    key={nom}
                    type="button"
                    onClick={() => onQuickNominal(nom)}
                    className={cn(
                      'py-2.5 rounded-xl text-xs font-bold border transition-all active:scale-95',
                      paidNum === nom
                        ? 'theme-bg-subtle theme-text theme-border-medium shadow-sm'
                        : 'bg-white/[0.04] border-white/[0.06] text-slate-300 hover:border-white/[0.1] active:bg-white/[0.04]'
                    )}
                  >
                    {nom >= 1000 ? `${nom / 1000}K` : nom}
                  </button>
                ))}
                {/* "Uang Pas" (Exact Amount) button */}
                {total > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onQuickNominal(Math.ceil(total / 1000) * 1000)
                    }
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

      {/* ══════════ NON-CASH CONFIRMATION ══════════ */}
      {!isCash && paymentMethod && (
        <div className="aether-card p-5 text-center">
          <p className="text-xs text-slate-400">
            Pembayaran{' '}
            <span className="font-bold text-slate-200 uppercase">
              {PAYMENT_METHOD_CONFIG[paymentMethod]?.label || paymentMethod}
            </span>
          </p>
          <p className="text-2xl font-black text-white mt-2 tabular-nums">
            {formatCurrency(total)}
          </p>
        </div>
      )}

      {/* ══════════ CHECKOUT BUTTON ══════════ */}
      <Button
        onClick={onCheckout}
        disabled={!canCheckout || isProcessing}
        className={cn(
          'w-full h-12 font-bold text-sm rounded-2xl transition-all active:scale-[0.99]',
          canCheckout && !isProcessing
            ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow'
            : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
        )}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Memproses...
          </>
        ) : (
          <>
            <Check className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
            Bayar Sekarang · {formatCurrency(total)}
          </>
        )}
      </Button>
    </div>
  )
}

export default PaymentPanel
