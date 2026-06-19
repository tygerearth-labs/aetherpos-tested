'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter } from '@/components/ui/responsive-dialog'
import { Loader2 } from 'lucide-react'

interface Customer {
  id: string
  name: string
  whatsapp: string
}

interface CustomerFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer | null
  onSaved: () => void
}

export default function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: CustomerFormDialogProps) {
  const isEdit = !!customer
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (customer) {
      setName(customer.name)
      setWhatsapp(customer.whatsapp)
    } else {
      setName('')
      setWhatsapp('')
    }
    setError('')
  }, [customer, open])

  const validateWhatsapp = (value: string): boolean => {
    const cleaned = value.replace(/[\s-]/g, '')
    return cleaned.startsWith('+62') || cleaned.startsWith('08')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Customer name is required')
      return
    }

    if (!validateWhatsapp(whatsapp)) {
      setError('WhatsApp must start with +62 or 08')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        whatsapp: whatsapp.trim(),
      }

      const url = isEdit ? `/api/customers/${customer.id}` : '/api/customers'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Customer updated' : 'Customer created')
        onOpenChange(false)
        onSaved()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save customer')
      }
    } catch {
      toast.error('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="bg-nebula border-white/[0.06] p-4">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-sm font-semibold text-white">
            {isEdit ? 'Edit Customer' : 'Add Customer'}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">Customer Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter customer name"
              className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">WhatsApp Number *</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+6281234567890"
              className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
            />
            <p className="text-[11px] text-slate-500">Must start with +62 or 08</p>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="theme-bg hover:theme-hover text-white h-8 text-xs"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
