'use client'

import { Button } from '@/components/ui/button'
import { PlusCircle, ShoppingCart, FileBarChart } from 'lucide-react'
import { usePageStore } from '@/hooks/use-page-store'
import { motion } from 'framer-motion'

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

export function QuickActions() {
  const { setCurrentPage } = usePageStore()

  return (
    <motion.div variants={itemVariants}>
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { icon: <PlusCircle className="h-4 w-4 theme-text" />, label: 'Tambah Produk', page: 'products' as const },
          { icon: <ShoppingCart className="h-4 w-4 text-violet-400" />, label: 'Transaksi Baru', page: 'pos' as const },
          { icon: <FileBarChart className="h-4 w-4 text-sky-400" />, label: 'Laporan', page: 'transactions' as const },
        ].map((item) => (
          <Button
            key={item.page}
            variant="outline"
            className="h-auto py-2.5 px-2 bg-nebula border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.06] text-slate-300 hover:text-white transition-all rounded-xl gap-2 justify-center"
            onClick={() => setCurrentPage(item.page)}
          >
            {item.icon}
            <span className="text-[11px] font-medium">{item.label}</span>
          </Button>
        ))}
      </div>
    </motion.div>
  )
}