import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-zinc-500 focus-visible:border-[color-mix(in_srgb,var(--theme-500)_50%,transparent)] focus-visible:ring-[color-mix(in_srgb,var(--theme-500)_20%,transparent)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-3 py-2 text-base shadow-xs transition-all duration-200 outline-none focus-visible:ring-[3px] hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
