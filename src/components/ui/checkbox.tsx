'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    variant?: 'default' | 'emerald'
  }
>(({ className, variant = 'emerald', ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer shrink-0 rounded-[5px] border transition-all duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
      'disabled:cursor-not-allowed disabled:opacity-40',
      'data-[state=unchecked]:border-white/15 data-[state=unchecked]:bg-white/[0.03] data-[state=unchecked]:hover:border-white/25 data-[state=unchecked]:hover:bg-white/[0.06]',
      variant === 'emerald' && [
        'data-[state=checked]:border-emerald-500/60 data-[state=checked]:bg-emerald-500/15 data-[state=checked]:hover:bg-emerald-500/25',
      ],
      variant === 'default' && [
        'data-[state=checked]:border-white/30 data-[state=checked]:bg-white/10 data-[state=checked]:hover:bg-white/15',
      ],
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn(
        'flex items-center justify-center text-current transition-transform duration-150',
        'data-[state=checked]:animate-in data-[state=checked]:zoom-in-50',
        variant === 'emerald' && 'text-emerald-400',
        variant === 'default' && 'text-slate-300'
      )}
    >
      <Check className="h-3 w-3 stroke-[2.5]" strokeWidth={2.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }