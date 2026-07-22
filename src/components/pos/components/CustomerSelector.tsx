'use client'

import { User, UserPlus, X, Coins } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Represents a customer entity used in the POS customer selector.
 */
export interface CustomerData {
  id: string
  name: string
  whatsapp: string
  points: number
}

/**
 * Props for the CustomerSelector component.
 */
export interface CustomerSelectorProps {
  // Data
  selectedCustomer: CustomerData | null
  customerSearch: string
  filteredCustomers: CustomerData[]
  customerDropdownOpen: boolean
  manualDiscountEnabled: boolean

  // Callbacks
  onCustomerSearchChange: (value: string) => void
  onCustomerDropdownOpen: (open: boolean) => void
  onSelectCustomer: (customer: CustomerData) => void
  onClearCustomer: () => void
  onAddNewCustomer: () => void
  onSetPointsToUse: (points: number) => void

  // UI
  isMobileView?: boolean
}

/**
 * CustomerSelector — Presentational UI component for selecting a customer in POS.
 *
 * Renders a search input with dropdown, selected customer badge, and points display.
 * Supports both desktop and mobile view variants.
 *
 * @param props - Component props as defined in CustomerSelectorProps
 * @returns JSX element containing the customer selection UI
 */
export function CustomerSelector({
  // Data
  selectedCustomer,
  customerSearch,
  filteredCustomers,
  customerDropdownOpen,
  manualDiscountEnabled,

  // Callbacks
  onCustomerSearchChange,
  onCustomerDropdownOpen,
  onSelectCustomer,
  onClearCustomer,
  onAddNewCustomer,
  onSetPointsToUse,

  // UI
  isMobileView = false,
}: CustomerSelectorProps) {
  return (
    <div className={isMobileView ? 'aether-card rounded-2xl p-3.5 space-y-2' : 'border-b border-white/[0.06] px-4 py-3'}>
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-slate-500 font-medium tracking-wide uppercase">Customer</Label>
        <button onClick={onAddNewCustomer} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-1 transition-colors">
          <UserPlus className="h-3 w-3" strokeWidth={1.5} /> Tambah Baru
        </button>
      </div>
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
        <Input
          placeholder={selectedCustomer ? selectedCustomer.name : 'Cari customer (walk-in jika kosong)'}
          value={customerSearch}
          onChange={(e) => { onCustomerSearchChange(e.target.value); onCustomerDropdownOpen(true) }}
          onFocus={() => onCustomerDropdownOpen(true)}
          className="pl-10 pr-8 h-10 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl backdrop-blur-sm"
        />
        {selectedCustomer && (
          <button onClick={() => { onClearCustomer(); onSetPointsToUse(0) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
        <div className={cn(
          'absolute z-30 mt-1 aether-card-elevated rounded-2xl max-h-44 overflow-y-auto',
          isMobileView ? 'w-[calc(100%-1.75rem)]' : 'w-full'
        )}>
          {filteredCustomers.map((customer) => (
            <button key={customer.id} onClick={() => { onSelectCustomer(customer); onCustomerDropdownOpen(false); onSetPointsToUse(0) }}
              className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
              <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
            </button>
          ))}
        </div>
      )}
      {selectedCustomer && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl theme-bg-very-light border theme-border-light">
            <User className="h-3 w-3 theme-text" strokeWidth={1.5} />
            <span className="text-[11px] theme-text font-medium">{selectedCustomer.name}</span>
          </div>
          {selectedCustomer.points > 0 && (
            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] rounded-lg">
              <Coins className="mr-1 h-2.5 w-2.5" strokeWidth={1.5} />
              {selectedCustomer.points} poin
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}

export default CustomerSelector
