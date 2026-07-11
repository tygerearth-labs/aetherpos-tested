'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Plus, X, CheckCircle2, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'

interface SupplierOption {
  id: string
  name: string
}

interface SupplierSearchInputProps {
  value: string
  onChange: (id: string) => void
  options: SupplierOption[]
  onCreateSupplier: (name: string, phone?: string) => Promise<{ id: string; name: string } | null>
  placeholder?: string
}

export default function SupplierSearchInput({
  value,
  onChange,
  options,
  onCreateSupplier,
  placeholder = 'Ketik nama supplier...',
}: SupplierSearchInputProps) {
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedName = value ? options.find(s => s.id === value)?.name || '' : ''
  const filtered = options.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setShowAddForm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const result = await onCreateSupplier(newName.trim(), newPhone.trim() || undefined)
      if (result) {
        onChange(result.id)
        setSearch('')
        setShowDropdown(false)
        setShowAddForm(false)
        setNewName('')
        setNewPhone('')
        toast.success(`Supplier "${result.name}" berhasil ditambahkan`)
      }
    } catch {
      toast.error('Gagal menambahkan supplier')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
          <input
            value={value ? selectedName : search}
            onChange={(e) => {
              if (value) { onChange(''); setSearch('') }
              setSearch(e.target.value)
              setShowDropdown(true)
              setShowAddForm(false)
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={placeholder}
            className="w-full bg-white/[0.04] border border-white/[0.04] text-white text-xs h-9 rounded-lg pl-8 pr-2 outline-none focus:border-emerald-500/40 placeholder:text-slate-500"
          />
        </div>
        {value && (
          <button
            className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.04] flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
            onClick={() => { onChange(''); setSearch('') }}
            title="Hapus supplier"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && !value && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0d1117] border border-white/[0.08] rounded-lg shadow-xl z-50 min-w-[240px]">
          {!showAddForm ? (
            <>
              <div className="max-h-[160px] overflow-y-auto">
                {filtered.length > 0 ? (
                  filtered.map((s) => (
                    <button
                      key={s.id}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors first:rounded-t-lg last:rounded-b-lg"
                      onClick={() => { onChange(s.id); setSearch(''); setShowDropdown(false) }}
                    >
                      <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span className="text-xs text-slate-200">{s.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="py-4 text-center px-3">
                    <p className="text-[11px] text-slate-500">Supplier tidak ditemukan</p>
                  </div>
                )}
              </div>
              <div className="border-t border-white/[0.06]">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors rounded-b-lg"
                  onClick={() => { setShowAddForm(true); setNewName(search); setNewPhone('') }}
                >
                  <Plus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs text-emerald-400 font-medium">Tambah Supplier Baru</span>
                </button>
              </div>
            </>
          ) : (
            <div className="p-3 space-y-2">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Supplier Baru</p>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowAddForm(false) }}
                placeholder="Nama supplier *"
                className="w-full bg-white/[0.04] border border-white/[0.08] text-white text-xs h-8 rounded-lg px-2.5 outline-none focus:border-emerald-500/40 placeholder:text-slate-500"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowAddForm(false) }}
                placeholder="No. telepon (opsional)"
                className="w-full bg-white/[0.04] border border-white/[0.08] text-white text-xs h-8 rounded-lg px-2.5 outline-none focus:border-emerald-500/40 placeholder:text-slate-500"
              />
              <div className="flex gap-2">
                <button
                  className="flex-1 h-7 rounded-lg text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
                  onClick={() => setShowAddForm(false)}
                >
                  Batal
                </button>
                <button
                  className="flex-1 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-[11px] font-medium flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                  onClick={handleCreate}
                  disabled={!newName.trim() || creating}
                >
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Simpan
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}