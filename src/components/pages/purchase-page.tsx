'use client'

import {
  ShoppingCart,
  PackagePlus,
  FileText,
  Clock,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function PurchasePage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 theme-text" />
          Purchase
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Kelola pembelian stok dari supplier
        </p>
      </div>

      {/* Coming Soon Placeholder */}
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="bg-white/[0.02] border-white/[0.06] max-w-md w-full">
          <CardContent className="p-8 text-center space-y-6">
            {/* Icon */}
            <div className="mx-auto w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <PackagePlus className="h-8 w-8 theme-text" />
            </div>

            {/* Title */}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">
                Fitur Purchase Segera Hadir
              </h2>
              <p className="text-sm text-slate-400 max-w-xs mx-auto">
                Kelola pembelian stok dari supplier, tracking purchase order, dan histori pembelian dalam satu tempat.
              </p>
            </div>

            {/* Upcoming Features */}
            <div className="space-y-3 text-left">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="h-4 w-4 theme-text" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">Purchase Order</p>
                  <p className="text-xs text-slate-500">Buat dan kelola PO ke supplier</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="h-4 w-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">Tracking Status</p>
                  <p className="text-xs text-slate-500">Lacak status pembelian dari order sampai diterima</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                  <ArrowRight className="h-4 w-4 text-sky-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">Auto Restock</p>
                  <p className="text-xs text-slate-500">Stok otomatis bertambah saat PO diterima</p>
                </div>
              </div>
            </div>

            {/* Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
              <span className="w-1.5 h-1.5 rounded-full theme-bg animate-pulse" />
              <span className="text-xs text-slate-400">Coming in Stage 2</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}