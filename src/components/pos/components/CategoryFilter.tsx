'use client'

import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Category color palette mapping
 * Maps category color names to their respective Tailwind CSS classes
 */
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; activeBg: string }> = {
  emerald: { bg: 'theme-bg-very-light', text: 'theme-text', border: 'theme-border-light', activeBg: 'theme-bg-subtle' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', activeBg: 'bg-blue-500/20' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', activeBg: 'bg-violet-500/20' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', activeBg: 'bg-rose-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', activeBg: 'bg-amber-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', activeBg: 'bg-cyan-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', activeBg: 'bg-orange-500/20' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20', activeBg: 'bg-pink-500/20' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', activeBg: 'bg-teal-500/20' },
  zinc: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', activeBg: 'bg-slate-500/20' },
}

/**
 * Category data structure
 */
export interface CategoryData {
  id: string
  name: string
  color: string
}

/**
 * Theme colors for the filter component
 */
export interface ThemeColors {
  bg: string
  text: string
  border: string
  activeBg: string
}

/**
 * Props for CategoryFilter component
 */
export interface CategoryFilterProps {
  /** Array of available categories */
  categories: CategoryData[]
  /** Currently selected category ID, or null for "All" */
  selectedCategoryId: string | null
  /** Callback when a category is selected */
  onSelect: (categoryId: string | null) => void
  /** Theme color classes for the default/active state */
  themeColors: ThemeColors
}

/**
 * CategoryFilter - Horizontal scrollable chip-based category selector
 *
 * Renders a row of category chips with an "All" (Semua) option.
 * Each chip shows the category name and uses color-coded styling
 * based on the category's assigned color.
 *
 * @example
 * ```tsx
 * <CategoryFilter
 *   categories={categories}
 *   selectedCategoryId={selectedId}
 *   onSelect={handleSelect}
 *   themeColors={themeColors}
 * />
 * ```
 */
export default function CategoryFilter({
  categories,
  selectedCategoryId,
  onSelect,
  themeColors,
}: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1">
      {/* "All" button */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm',
          !selectedCategoryId
            ? `${themeColors.activeBg} ${themeColors.text} ${themeColors.border} shadow-sm`
            : 'aether-card text-slate-500 hover:text-slate-300'
        )}
      >
        <LayoutGrid className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={1.5} />
        Semua
      </button>
      {/* Category buttons */}
      {categories.map((cat) => {
        const colors = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.zinc
        const isActive = selectedCategoryId === cat.id
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={cn(
              'shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm',
              isActive
                ? `${colors.activeBg} ${colors.text} ${colors.border} shadow-sm`
                : 'aether-card text-slate-500 hover:text-slate-300'
            )}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )
}
