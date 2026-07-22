# AETHER UX DESIGN CONTRACT v1.0

> **Scope**: Seluruh layer UX AetherPOS — Design System, Navigation, Form Patterns, Mutation Lifecycle, States, Mobile, Permission-aware UX
> **Status**: 🔒 APPROVED v1.0
> **Contract Date**: 2026-01-29
> **Approval Date**: 2026-01-29
> **Last Updated**: 2026-01-29 (v1.0-approved+guardrails+phase1-methodology)
> **Basis**: Full UX Surface Audit (13 domains) + Code Verification
> **Companion Documents**:
> - `docs/ARCHITECTURE-LOCK.md` — Core Inventory Engine (LOCKED)
> - `docs/PLATFORM-ARCHITECTURE-REVIEW.md` — Platform Layers (REVIEWED)
>
---

## CORE PRINCIPLE

> **"Improve the cockpit without touching the engine."**
>
> A UX redesign may improve presentation, interaction, state management, and component architecture, but must not alter established business semantics, domain contracts, mutation semantics, or frozen invariants.

---

## 0. LOCK STATEMENT & BOUNDARIES

### Apa yang TERKUNCI (tidak boleh diubah tanpa ADR)

```
┌─────────────────────────────────────────────────────────────┐
│                  ARCHITECTURE LOCK                          │
│                    🔒🔒🔒 FROZEN 🔒🔒🔒                       │
├─────────────────────────────────────────────────────────────┤
│  ✅ Core Inventory Engine                                   │
│     → InventoryConsumptionService                           │
│     → FEFOEngine                                            │
│     → InventoryItem.stock = Σ(AVAILABLE InventoryBatch)     │
│     → 17 mutation paths (semua teraudit)                    │
│                                                             │
│  ✅ Costing Contract                                        │
│     → Estimated COGS (Product.hpp) vs Actual COGS           │
│     → TransactionConsumption (append-only)                  │
│                                                             │
│  ✅ Void / Restoration Contract                             │
│     → Atomic, full rollback or fail                         │
│                                                             │
│  ✅ Audit Trail                                             │
│     → Semua mutation wajib teraudit                         │
│     → Historical records never deleted                     │
│                                                             │
│  ✅ Offline/Online Equivalence                              │
│     → Same server-side processing on sync                  │
└─────────────────────────────────────────────────────────────┘
```

### Apa yang BOLEH diubah (UX Redesign Scope)

```
┌─────────────────────────────────────────────────────────────┐
│                 UX REDESIGN SCOPE                            │
│                  ✏️✏️✏️ OPEN ✏️✏️✏️                        │
├─────────────────────────────────────────────────────────────┤
│  ✅ Pecah halaman besar menjadi hooks/components            │
│  ✅ Ubah dialog ↔ drawer                                    │
│  ✅ Ubah navigasi & information architecture                │
│  ✅ Tambah search/filter/sort/pagination                    │
│  ✅ Tambah keyboard shortcuts                               │
│  ✅ Ubah layout mobile/desktop                              │
│  ✅ Tambah stale-data indicator                             │
│  ✅ Tambah loading skeleton/empty/error states              │
│  ✅ Tambah confirmation dialogs                             │
│  ✅ Tambah inline validation                                │
│  ✅ Standardisasi toast/notification                        │
│  ✅ Standardisasi button hierarchy & color tokens           │
│  ✅ Implementasi Mutation Contract hook                      │
└─────────────────────────────────────────────────────────────┘
```

### Apa yang DILARANG (tanpa Architecture Review)

```
❌ Bypass InventoryConsumptionService
❌ Bypass FEFO
❌ Membuat inventory engine kedua
❌ Mengubah authoritative ledger (InventoryItem.stock)
❌ Mengubah Product.stock menjadi InventoryItem.stock
❌ Mengubah mekanisme COGS
❌ Mengubah permission boundary (server-side)
❌ Mengubah mutation menjadi direct DB update
❌ Menghilangkan audit trail dari mutation wajib
❌ Mengubah void restoration non-atomic
```

---

## 0.5 ARCHITECTURE GUARDRAILS ⭐

**5 Guardrails ini WAJID dipatuhi sebelum dan selama UX redesign.** Mereka adalah safety net yang mencegah "cockpit" (UX) mencemari "engine" (domain logic).

### Guardrail 1: NO BUSINESS LOGIC DRIFT

```
BUSINESS LOGIC DRIFT PREVENTION
═══════════════════════════════

Setiap redesign WAJIB mempertahankan:

  Existing Business Rule
        ↓
  Existing API Contract
        ↓
  Existing Data Model
        ↓
  Existing Mutation Semantics

Ketika GLM menemukan logic yang terlihat aneh:

  ❌ Jangan langsung refactor
        ↓
  🔍 Audit (trace execution flow)
        ↓
  📋 Classify (bug? feature? intentional?)
        ↓
  Confirmed Bug?
   ├── YES → Buat Separate Bug Task → Fix terpisah
   └── NO  → Preserve behavior (jangan sentuh)

PENTING: Kita sudah alami static audit false positive sebelumnya.
Execution-flow audit jauh lebih reliable daripada pattern matching.
```

**Contoh Kasus:**
| Temuan | Klasifikasi | Tindakan |
|--------|-------------|----------|
| `if (stock < 0) stock = 0` | Boundary protection | ✅ Preserved |
| Double settings fetch di POS | Code smell, bukan bug | ⚠️ Refactor saat Phase POS |
| Composition FIX-COMP comments | Bug fix artifacts | ❌ Jangan "clean up" tanpa audit |
| FEFO sort order yang tidak intuitif | Intentional design decision | ✅ Preserved |

---

### Guardrail 2: READ-ONLY AUDIT BEFORE WRITE

```
AUDIT-BEFORE-WRITE PROTOCOL
═════════════════════════════

Setiap domain yang akan di-redesign HARUS melalui:

  AUDIT (Read-only)
    ↓
  Trace User Journey     → Apa flow user?
    ↓
  Trace Mutation Surface → Di mana semua titik mutate?
    ↓
  Trace Data Flow       → Data dari mana ke mana?
    ↓
  Identify Confirmed Bugs → Bug beneran atau false positive?
    ↓
  Classify:
    ├── UX issue      → Masuk scope redesign
    ├── Data issue     → Buat task terpisah
    ├── Architecture issue → Escalate ke architect
    └── False positive → Dokumentasi, ignore
    ↓
  IMPLEMENTATION (Write)
    ↓
  REGRESSION TEST

LARANGAN:
❌ GLM tidak boleh edit source HANYA berdasarkan grep/pattern matching
❌ GLM tidak boleh refactor tanpa trace execution flow dulu
✅ Execution-flow audit adalah sumber kebenaran utama
```

**Audit Output Template (per domain):**
```markdown
## [DOMAIN] AUDIT REPORT

### User Journey Trace
- Step 1: User opens page → fetches X from API Y
- Step 2: User clicks action Z → triggers mutation W
- ...

### Mutation Surface Map
| Mutation | API Endpoint | Source | Side Effects |
|----------|-------------|--------|-------------|
| Create   | POST /api/x | Form   | Invalidates Q1, Q2 |

### Data Flow Diagram
[Component] → [Hook] → [API] → [DB]

### Findings Classification
| # | Finding | Type | Action |
|---|---------|------|--------|
| 1 | ... | UX issue | Fix in redesign |
| 2 | ... | False positive | Document & ignore |
```

---

### Guardrail 3: DOMAIN FREEZE BOUNDARY

```
DOMAIN FREEZE BOUNDARY
═══════════════════════

Kalau domain sudah FROZEN, UX redesign TIDAK BOLEH
membuka kembali freeze secara implisit.

PRODUCT DOMAIN 🔒 FROZEN
─────────────────────────────

UX BOLEH:
  ✅ Redesign layout
  ✅ Split component menjadi hooks/sub-components
  ✅ Refactor state management (useState → useReducer/hooks)
  ✅ Improve form UX
  ✅ Improve dialog/drawer patterns
  ✅ Improve search/filter/pagination
  ✅ Improve mobile responsiveness
  ✅ Improve loading/error/empty states
  ✅ Improve feedback (toast, confirmation)
  ✅ Add keyboard shortcuts
  ✅ Add stale-data indicators

UX TIDAK BOLEH:
  ❌ Mengubah Product.stock semantics
  ❌ Mengubah HPP (Product.hpp) semantics
  ❌ Mengubah variant invariant
  ❌ Mengubah composition behavior
  ❌ Mengubah barcode identity rules
  ❌ Mengubah mutation API contract
  ❌ Mengubah validation business rules
  ❌ Menambah field baru di schema tanpa ADR

KETIKA BUG BARU DITEMUKAN:

  UX Task (sedang berjalan)
       ↓
  New Bug Found (domain-related)
       ↓
  STOP UX TASK
       ↓
  Create Separate Bug Task
       ↓
  Audit (execution-flow)
       ↓
  Fix (terpisah dari UX task)
       ↓
  Regression Test (bun run test:invariant)
       ↓
  Resume UX Task
```

**Domain Freeze Status:**

| Domain | Freeze Status | Notes |
|--------|--------------|-------|
| Core Inventory Engine | 🔒 LOCKED | ARCHITECTURE-LOCK.md |
| Costing Contract | 🔒 LOCKED | ARCHITECTURE-LOCK.md §4 |
| Void/Restoration | 🔒 LOCKED | ARCHITECTURE-LOCK.md §5 |
| Product Domain | 🔒 FROZEN | Business rules preserved |
| Purchase Domain | 🟡 REVIEWED | May evolve with constraints |
| Transaction Domain | 🟡 REVIEWED | Void path locked |
| Platform Layers | 🟢 OPEN | Crew, Customer, Settings, Plan, Migration |

---

### Guardrail 4: MUTATION CONTRACT ENFORCEMENT

```
MUTATION CONTRACT ENFORCEMENT
═════════════════════════════

Mutation Contract BERLAKU untuk SETIAP mutation
yang menghasilkan perubahan state yang TERLIHAT USER.

Bukan hanya POST/PUT/DELETE HTTP.

MUTASI YANG WAJIKAN IKUT KONTRAK:
────────────────────────────────────────

Product:
  ✅ Product Create     → UI shows new product in list
  ✅ Product Edit       → UI reflects updated data
  ✅ Product Delete     → UI removes product from list
  ✅ Product Restock    → UI shows updated stock
  ✅ Product Adjust     → UI shows adjusted stock
  ✅ Bulk Upload        → UI shows imported products
  ✅ Bulk Update        → UI shows updated products
  ✅ Category CRUD      → UI reflects category changes

Purchase:
  ✅ Purchase Create    → UI shows new PO in list
  ✅ Purchase Edit      → UI reflects changes
  ✅ Purchase Delete     → UI removes PO
  ✅ Purchase Post      → UI updates inventory indicators
  ✅ Excel Import       → UI shows imported items

Customer:
  ✅ Customer Create    → UI shows new customer
  ✅ Customer Edit      → UI reflects changes
  ✅ Customer Delete     → UI removes customer
  ✅ Points Adjust      → UI shows new points

Crew:
  ✅ Crew Invite       → UI shows new crew member
  ✅ Crew Edit         → UI reflects changes
  ✅ Crew Delete       → UI removes crew
  ✅ Permission Toggle  → UI reflects permission change

Settings:
  ✅ Settings Update   → UI reflects new setting
  ✅ Theme Change       → UI applies theme immediately
  ✅ Payment Toggle    → UI shows/hides method

Plan:
  ✅ Plan Upgrade      → UI unlocks features
  ✅ Plan Change        → UI reflects new limits

Transaction:
  ✅ Transaction Void  → UI marks as voided, restores stock display
  ✅ Export            → Triggers download

Transfer:
  ✅ Transfer Create   → UI shows new transfer
  ✅ Transfer Send      → UI updates to IN_TRANSIT
  ✅ Transfer Receive   → UI updates to RECEIVED
  ✅ Transfer Cancel   → UI restores stock display

Stock Opname:
  ✅ Opname Start      → UI enters counting mode
  ✅ Opname Complete   → UI shows adjustments
  ✅ Opname Cancel     → UI exits cleanly

Migration:
  ✅ Import Execute    → UI shows progress → success screen

OFFLINE MUTATION LIFECYCLE (POS Specific):
═════════════════════════════════════════

  LOCAL COMMIT (IndexedDB write)
       ↓
  LOCAL UI REFRESH (optimistic update)
       ↓
  SYNC QUEUE (add to queue)
       ↓
  SERVER COMMIT (when online)
       ↓
  SYNC RESOLUTION (conflict handling)
       ↓
  FINAL UI STATE (reflects server truth)

CATATAN PENTING:
"COMMIT pada offline TIDAK berarti server sudah sukses.
 COMMIT berarti local authoritative commit.
UI harus menunjukkan status: 'Tersimpan (menunggu sinkronisasi)'"
```

---

### Guardrail 5: UX REDESIGN MUST BE DOMAIN-SCOPED

```
DOMAIN SCOPE BOUNDARY
═══════════════════════

Setiap task UX HARUS punya boundary yang jelas.

TASK SCOPE TEMPLATE:
─────────────────────────────────────────────────

Task:          [Domain] UX Redesign
Domain:        [e.g., Product]
Priority:      [Critical/High/Medium/Low]

ALLOWED FILES:
  ✅ src/components/pages/[domain]-page.tsx
  ✅ src/components/[domain]/**/*.tsx
  ✅ src/hooks/use-[domain]*.ts
  ✅ src/lib/actions/[domain].ts
  ✅ src/app/api/[domain]/**/route.ts  (hanya untuk UX-related changes)
  ✅ src/components/ui/*.tsx           (shared components)
  ✅ src/components/shared/*.tsx        (shared components)

FORBIDDEN ZONES (tanpa explicit exception):
  ❌ src/lib/inventory-consumption-service.ts
  ❌ src/lib/fefo-engine.ts
  ❌ src/lib/offline/*                          (dormant code)
  ❌ prisma/schema.prisma                       (schema changes = ADR)
  ❌ src/lib/comp-stock.ts
  ❌ src/lib/expiry-notify.ts
  ❌ Unrelated domain files
                    
EXCEPTION PROCESS:
  Jika task memerlukkan perubahan di forbidden zone:
  1. Stop task
  2. Document why needed
  3. Create separate Architecture Review task
  4. Get explicit approval before proceeding
  5. Only then modify with regression test

SHARED UX INFRASTRUCTURE EXCEPTION:
  ✅ Diizinkan membuat/modifikasi shared UX components
    (loading states, empty states, error boundaries,
     toast wrappers, pagination, etc.)
  ✅ Ini adalah "Phase 0" work (lihat Section 12.1)
```

**Contoh Scope Definition:**

```
┌─────────────────────────────────────────────────────────────┐
│ TASK: Product Domain UX Redesign                             │
│ DOMAIN: Product                                             │
│ PRIORITY: Critical                                          │
├─────────────────────────────────────────────────────────────┤
│ ALLOWED:                                                   │
│   • products-page.tsx (split into modules)                  │
│   • product-form-dialog.tsx                                 │
│   • New hooks: use-product-list, use-product-form, etc.     │
│   • Shared: EmptyState, LoadingSkeleton, ConfirmDialog      │
│                                                             │
│ FORBIDDEN:                                                 │
│   • inventory-consumption-service.ts                        │
│   • fefo-engine.ts                                          │
│   • Any purchase/transaction/pos logic                      │
│   • Prisma schema                                           │
└─────────────────────────────────────────────────────────────┘
```

---

### Guardrail Compliance Checklist

Sebelum mendeklarasikan domain task SELESAI:

```
GUARDRAIL COMPLIANCE CHECKLIST
═══════════════════════════════════

Guardrail 1: No Business Logic Drift
  □ Semua existing business rules preserved
  □ Logic yang terlihat aneh sudah diaudit
  □ Bug fixes dipisahkan dari UX tasks
  
Guardrail 2: Read-Only Audit Before Write
  □ User journey traced
  □ Mutation surface mapped
  □ Data flow documented
  □ Findings classified (UX/Data/Arch/False-Positive)
  
Guardrail 3: Domain Freeze Boundary
  □ Tidak ada implicit freeze violation
  □ Frozen domain contracts untouched
  □ Bug findings escalated properly
  
Guardrail 4: Mutation Contract Enforcement
  □ SEMUA mutations mengikuti 5-phase lifecycle
  □ Offline mutations memiliki local-commit semantics
  □ UI reflects committed state (not pending)
  
Guardrail 5: Domain-Scoped
  □ Task scope terdefinisi dengan jelas
  □ Tidak ada cross-domain contamination
  □ Forbidden zones tidak disentuh
  □ Exceptions didokumentasikan dan di-approve
```

---

## 1. MUTATION CONTRACT v1.0

**Ini adalah kontrak lintas SEMUA fitur.** Setiap mutation (create, update, delete, post, void, transfer, adjust) WAJIB mengikuti lifecycle ini.

### 1.1 Mutation Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    MUTATION LIFECYCLE                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. PREPARE                                                │
│      ┌─────────────────────────────────────────┐            │
│      │ • User Intent (apa yang user mau?)       │            │
│      │ • Validate (client-side validation)      │            │
│      │ • setLoading(true)                       │            │
│      │ • Disable duplicate action               │            │
│      └─────────────────────────────────────────┘            │
│                        ↓                                    │
│   2. COMMIT                                                 │
│      ┌─────────────────────────────────────────┐            │
│      │ • await API call (HTTP) OR              │            │
│      │ • await IndexedDB write (offline-first)  │            │
│      │ • Server/local transaction succeeds      │            │
│      └─────────────────────────────────────────┘            │
│                        ↓                                    │
│   3. INVALIDATE                                             │
│      ┌─────────────────────────────────────────┐            │
│      │ • Invalidate affected query keys         │            │
│      │ • Cache bust (HTTP sources)             │            │
│      │ • Mark stale (offline/cache sources)    │            │
│      └─────────────────────────────────────────┘            │
│                        ↓                                    │
│   4. REFRESH                                                │
│      ┌─────────────────────────────────────────┐            │
│      │ • Re-fetch affected resources           │            │
│      │ • Pastikan UI merefleksikan state baru  │            │
│      └─────────────────────────────────────────┘            │
│                        ↓                                    │
│   5. FEEDBACK                                               │
│      ┌─────────────────────────────────────────┐            │
│      │ • Success → toast.success() + visual    │            │
│      │ • Error   → toast.error() + actionable  │            │
│      │ • Finally → setLoading(false)            │            │
│      └─────────────────────────────────────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Kontrak Utama

> **"Setelah mutation selesai, UI tidak boleh menampilkan state yang tidak merefleksikan hasil mutation yang sudah committed."**

### 1.3 Implementasi: useMutation Hook (Standard)

```typescript
// src/hooks/use-mutation.ts — Hook standar untuk semua mutation

interface UseMutationOptions<TData, TVariables> {
  // Mutation function
  mutationFn: (variables: TVariables) => Promise<TData>
  
  // Keys to invalidate after success
  invalidateKeys?: string[]
  
  // Refetch after invalidation
  refetchKeys?: string[]
  
  // Success feedback
  successMessage?: string | ((data: TData) => string)
  
  // Error handler (return user-friendly message)
  getErrorMessage?: (error: Error) => string
  
  // On success callback
  onSuccess?: (data: TData) => void
  
  // On error callback
  onError?: (error: Error) => void
  
  // Finally callback
  onSettled?: () => void
  
  // Confirmation dialog options (for destructive actions)
  confirm?: {
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'danger' | 'warning'
  }
}

// Return type
interface UseMutationReturn<TData, TVariables> {
  mutate: (variables: TVariables) => Promise<TData>
  isLoading: boolean
  error: Error | null
  data: TData | null
  reset: () => void
}
```

### 1.4 Domain-Specific Mutation Sources

| Domain | Source of Truth | Mutation Mechanism |
|--------|------------------|-------------------|
| **Product** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Purchase** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Customer** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Crew** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Settings** | HTTP + Cache | `mutationFn` → API → refetch settings |
| **Plan** | HTTP + PlanContext | `mutationFn` → API → refetch plan |
| **Transaction** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Transfer** | HTTP + React Query | `mutationFn` → API → invalidate queries |
| **Stock Opname** | Dexie (local) + HTTP | Local first → sync → invalidate |
| **Migration** | HTTP only | `mutationFn` → API → redirect |
| **Dashboard** | Read-only | N/A (no mutations) |
| **POS (Online)** | HTTP | Direct API → optimistic update |
| **POS (Offline)** | IndexedDB → Sync Queue | Local write → background sync |

### 1.5 POS Offline Mutation Contract (Khusus)

POS offline memiliki implementasi berbeda karena source of truth-nya IndexedDB/event queue, bukan HTTP cache.

```
POS OFFLINE MUTATION LIFECYCLE
═══════════════════════════════

1. PREPARE (sama)
   → Validate client-side
   → setLoading(true)

2. COMMIT (BERBEDA)
   → Write to IndexedDB (localDB)
   → Generate eventId (UUID)
   → Add to SyncQueue
   → Optimistic UI update

3. INVALIDATE (BERBEDA)
   → Mark local data as "pending sync"
   → Show sync indicator

4. REFRESH (BERBEDA)
   → No immediate re-fetch
   → Background sync attempts
   → On sync success: reconcile with server response

5. FEEDBACK (sama)
   → Success: "Transaksi tersimpan (offline)"
   → Pending: "Menunggu sinkronisasi..."
   → Error: Gagal menyimpan lokal
```

### 1.6 Contoh: Implementasi Mutation Contract

```typescript
// ❌ SEBELUM (anti-pattern — tidak mengikuti kontrak)
const handleDelete = async (id: string) => {
  if (confirm('Hapus?')) {  // Native confirm (buruk untuk mobile)
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
    toast.success('Deleted')  // Tapi UI belum refresh!
    // User masih lihat produk yang dihapus 😱
  }
}

// ✅ SESUDAH (mengikuti Mutation Contract)
const { mutate: deleteProduct, isLoading } = useMutation({
  mutationFn: async (id: string) => {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Gagal menghapus produk')
    return res.json()
  },
  
  invalidateKeys: ['products', 'product-list'],
  
  confirm: {
    title: 'Hapus Produk',
    description: 'Produk yang dihapus tidak dapat dikembalikan. Lanjutkan?',
    confirmLabel: 'Ya, Hapus',
    variant: 'danger'
  },
  
  successMessage: 'Produk berhasil dihapus',
  
  getErrorMessage: (error) => {
    if (error.message.includes('403')) return 'Anda tidak memiliki izin'
    if (error.message.includes('409')) = 'Produk sedang digunakan dalam transaksi'
    return 'Gagal menghapus produk. Coba lagi.'
  }
})

// Penggunaan:
// <Button onClick={() => deleteProduct(productId)} disabled={isLoading}>
```

---

## 2. GLOBAL DESIGN SYSTEM

### 2.1 Design Tokens (Color System)

```css
/* === THEME TOKENS (wajib digunakan, dilarang hardcoded) === */

/* Primary Brand */
--theme-primary: #10b981;           /* Emerald — primary actions */
--theme-primary-hover: #059669;
--theme-primary-muted: #10b981/10;

/* Semantic Colors */
--theme-success: #22c55e;           /* Success states */
--theme-warning: #f59e0b;           /* Warning, near-limit */
--theme-danger: #ef4444;            /* Error, destructive, at-limit */
--theme-info: #3b82f6;              /* Information */

/* Surface Colors */
--theme-bg: #0a0a0a;                /* Main background */
--theme-surface: #111111;           /* Card/surface background */
--theme-surface-hover: #1a1a1a;     /* Hover state */
--theme-border: rgba(255,255,255,0.06); /* Border color */

/* Text Colors */
--theme-text: #f8fafc;              /* Primary text */
--theme-text-secondary: #94a3b8;    /* Secondary text */
--theme-text-muted: #64748b;        /* Muted/disabled text */

/* Status Colors (untuk badges) */
--status-draft: #64748b;            /* Draft/gray */
--status-pending: #f59e0b;          /* Pending/amber */
--status-active: #22c55e;           /* Active/green */
--status-in-transit: #3b82f6;       /* In transit/blue */
--status-completed: #10b981;        /* Completed/emerald */
--status-voided: #ef4444;           /* Voided/red */
--status-cancelled: #94a3b8;        /* Cancelled */
```

### 2.2 Typography Scale

```css
/* === TYPOGRAPHY (gunakan kelas ini, bukan custom sizes) === */

.text-display    → text-3xl font-bold     /* Page titles */
.text-title      → text-xl font-semibold   /* Section titles */
.text-heading    → text-lg font-medium     /* Card titles */
.text-body       → text-sm font-normal     /* Body text */
.text-caption    → text-xs font-normal     /* Captions, hints */
.text-micro      →text-[11px]             /* Badges, timestamps */
```

### 2.3 Spacing Scale

```css
/* === SPACING (gunakan kelipatan 4) === */

space-1 → 4px   /* Inline spacing */
space-2 → 8px   /* Small gaps */
space-3 → 12px  /* Medium gaps */
space-4 → 16px  /* Card padding */
space-5 → 20px  /* Section gaps */
space-6 → 24px  /* Large section gaps */
space-8 → 32px  /* Page padding */
```

### 2.4 Button Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                   BUTTON HIERARCHY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PRIMARY (Emerald solid)                                    │
│  ├── Usage: CTA utama, save, create, confirm               │
│  ├── Style: bg-emerald-600 hover:bg-emerald-500 text-white │
│  └── Example: "Simpan", "Buat Produk", "Proses Pembayaran" │
│                                                             │
│  SECONDARY (Outline)                                        │
│  ├── Usage: Aksi sekunder, cancel, back                    │
│  ├── Style: border border-white/10 hover:bg-white/5        │
│  └── Example: "Batal", "Kembali", "Download Template"      │
│                                                             │
│  GHOST (Text only)                                          │
│  ├── Usage: Tersier, dismiss, less important               │
│  ├── Style: text-slate-400 hover:text-white hover:bg-white/5│
│  └── Example: "Tutup", "Nanti saja", "Lihat detail"       │
│                                                             │
│  DESTRUCTIVE (Red)                                          │
│  ├── Usage: Hapus, void, batalkan (destructive actions)    │
│  ├── Style: text-red-400 hover:bg-red-500/10               │
│  └── Example: "Hapus", "Void Transaksi", "Batalkan"        │
│                                                             │
│  DISABLED                                                   │
│  ├── Style: opacity-50 cursor-not-allowed pointer-events-none│
│  └── ALWAYS show tooltip explaining why disabled           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.5 Component Library Rules

| Rule | Detail |
|------|--------|
| **Use shadcn/ui** | Selalu gunakan komponen dari `src/components/ui/` |
| **No custom UI primitives** | Jangan buat sendiri button, input, dialog |
| **Extend via composition** | Wrap shadcn components, don't rewrite |
| **ResponsiveDialog** | Gunakan untuk dialog yang harus adaptif mobile |
| **Sheet** | Gunakan untuk bottom sheet di mobile |
| **AlertDialog** | Gunakan untuk destructive action confirmation |

---

## 3. NAVIGATION & INFORMATION ARCHITECTURE

### 3.1 Sidebar Structure

```
SIDEBAR NAVIGATION HIERARCHY
═════════════════════════════

┌─────────────────────────────┐
│  📊 Dashboard               │  ← Entry point (KPI overview)
├─────────────────────────────┤
│  🛍️ Produk                  │  ← Product management
│  📦 Pembelian               │  ← Purchase orders
│  🧾 POS                     │  ← Point of Sale (primary)
├─────────────────────────────┤
│  📊 Transaksi               │  ← Transaction history
│  🔄 Transfer                │  ← Inter-outlet transfer (Pro)
│  📋 Stok Opname             │  ← Stock counting
├─────────────────────────────┤
│  👥 Pelanggan                │  ← Customer management
│  👨‍💼 Crew                    │  ← Crew & permissions
├─────────────────────────────┤
│  📜 Audit Log                │  ← Activity log
│  ⚙️ Pengaturan               │  ← Settings
│  💳 Paket                    │  ← Plan & pricing
└─────────────────────────────┘
```

### 3.2 Terminology Standard (Bahasa Indonesia)

| Term | Penggunaan | Jangan gunakan |
|------|-----------|----------------|
| **Produk** | Item yang dijual | Product, Barang |
| **Pelanggan** | Pembeli | Customer |
| **Pembelian** | Purchase order dari supplier | PO, Purchase |
| **Transaksi** | Penjualan di POS | Order, Sale, Payment |
| **Stok Opname** | Stock counting | Stock take, Counting |
| **Crew** | Karyawan/pengelola toko | Staff, Employee, User |
| **Pengaturan** | Konfigurasi sistem | Settings, Config |
| **Struk** | Receipt/bukti pembayaran | Receipt |
| **HPP** | Harga Pokok Penjualan | COGS, Cost |
| **Laba/Rugi** | Profit/Loss | P&L |

### 3.3 Mobile Bottom Navigation

```
MOBILE BOTTOM NAV (max 5 items)
═══════════════════════════════

┌─────────┬─────────┬─────────┬─────────┬─────────┐
│   🏠    │   🛍️   │   🧾   │   📊   │   ⋯    │
│  Home   │ Produk │  POS   │Transaksi│  More  │
└─────────┴─────────┴─────────┴─────────┴─────────┘

More menu contains:
  • Pembelian
  • Transfer
  • Stok Opname
  • Pelanggan
  • Crew
  • Audit Log
  • Pengaturan
  • Paket
```

### 3.4 Settings Information Architecture (Restructured)

Settings saat ini flat (2613 baris dalam 1 file). Restructure:

```
SETTINGS RESTRUCTURED IA
═════════════════════════

📁 Pengaturan
├── 🏪 Outlet & Struk          ← Outlet info, receipt template
├── 💰 Pembayaran              ← Payment methods, tax (PPN)
├── 🎁 Promo & Loyalty          ← Promos, loyalty program
├── 🔔 Notifikasi              ← Notifications, Telegram
├── 🎨 Tampilan                ← Theme, language
├── ⚙️ Operasional             ← POS behavior, inventory behavior
├── 👤 Akun                    ← Password, email (Owner only)
└── 📦 Multi-Outlet (Pro)      ← Outlet management (Pro only)
```

---

## 4. FORM & DIALOG PATTERNS

### 4.1 Form Layout Standard

```
FORM LAYOUT PATTERN
═════════════════════

┌─────────────────────────────────────────────┐
│  📝 [Title]                    [Cancel][Save]│  ← Header with actions
├─────────────────────────────────────────────┤
│                                             │
│  [Label]                                    │  ← Label above input
│  [Input field]                              │
│  💡 Hint text (optional)                    │  ← Helper text below
│                                             │
│  [Label]*                                   │  ← Asterisk for required
│  [Input field]                              │
│  ⚠️ Error message                           │  ← Inline error below
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 📁 Section Label (collapsible)      │    │  ← Group related fields
│  │   [Field 1]                         │    │
│  │   [Field 2]                         │    │
│  └─────────────────────────────────────┘    │
│                                             │
├─────────────────────────────────────────────┤
│  [⚠️ Changes not saved]                     │  ← Unsaved changes warning
└─────────────────────────────────────────────┘
```

### 4.2 Dialog vs Drawer Decision Matrix

| Condition | Use Dialog | Use Drawer (Sheet) |
|-----------|-----------|-------------------|
| Simple form (<5 fields) | ✅ | - |
| Complex form (>5 fields) | - | ✅ |
| Confirmation only | ✅ | - |
| Detail view (read-heavy) | - | ✅ |
| Quick action | ✅ | - |
| Multi-step wizard | - | ✅ |
| Desktop | ✅ Default | Optional |
| Mobile | - | ✅ Default |

### 4.3 Validation Pattern

```typescript
// Validation timing:
// 1. onBlur → Show validation for touched fields
// 2. onSubmit → Validate all fields, focus first error
// 3. onChange → Clear error on edit (for previously invalid)

// Error display rules:
// - Inline below input (red text, micro size)
// - Show icon indicator in input (red outline)
// - Summary at top of form if multiple errors
// - Never use alert() or confirm()

// Required field indicators:
// - Visual: Red asterisk (*) after label
// - Accessibility: aria-required="true"
// - Screen reader: "Nama produk, required"
```

### 4.4 Confirmation Dialog Pattern

```typescript
// Untuk setiap DESTRUCTIVE action, WAJIB pakai AlertDialog:

<AlertDialog>
  <Trigger><Button variant="destructive">Hapus</Button></Trigger>
  
  <Content>
    <Title>Konfirmasi Hapus</Title>
    <Description>
      Produk "Kopi Arabika" akan dihapus permanen.
      Tindakan ini tidak dapat dibatalkan.
    </Description>
    
    {/* Explain consequences clearly */}
    <Consequences>
      • Stok produk akan hilang<br/>
      • Riwayat transaksi tetap ada<br/>
      • Data analytics terpengaruh
    </Consequences>
    
    <Actions>
      <Cancel>Batal</Cancel>
      <Confirm variant="danger">Ya, Hapus</Confirm>
    </Actions>
  </Content>
</AlertDialog>

// NON-destructive actions: optional confirmation
// - Sign out: Confirm (data loss risk)
// - Navigate away with unsaved changes: Confirm
// - Close cart: NO confirm (easy to re-add)
```

---

## 5. LOADING / ERROR / EMPTY STATES

### 5.1 Loading States

```
LOADING STATE HIERARCHY
═════════════════════════

1. SKELETON (untuk initial page load)
   ┌────────────────────────────────┐
   │ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ │  ← Match final layout shape
   │ ▓▓▓ ▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓ │  ← Animate pulse
   │ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ │
   └────────────────────────────────┘

2. SPINNER (untuk inline actions)
   [Save ⏳]  ← Button dengan spinner, tetap clickable area sama

3. PROGRESS BAR (untuk multi-step operations)
   ████████░░░░ 85%  ← Upload, import, export

4. OVERLAY BLOCKER (untuk modal operations)
   ┌────────────────────────┐
   │        ⏳              │  ← Centered, with message
   │   Menyimpan data...    │
   │                        │
   │   (background dimmed)  │
   └────────────────────────┘
```

### 5.2 Error States

```
ERROR STATE PATTERN
═════════════════════

┌─────────────────────────────────────────────┐
│                                             │
│           ⚠️ (icon)                         │
│                                             │
│   Gagal memuat data produk                 │  ← Clear, human message
│                                             │
│   Terjadi kesalahan saat menghubungi        │  ← Explanation (optional)
│   server. Pastikan internet Anda aktif.     │
│                                             │
│   [Coba Lagi]  [Refresh]                   │  ← Actionable buttons
│                                             │
└─────────────────────────────────────────────┘

Error Message Rules:
- Jangan tunjuk technical details ke user (stack trace, status code)
- Tunjuk technical details di console/dev mode saja
- Selalu berikan actionable recovery button
- Network errors: "Periksa koneksi internet"
- Permission errors: "Anda tidak memiliki izin"
- Not found: "Data tidak ditemukan"
- Server errors: "Terjadi kesalahan. Coba lagi."
```

### 5.3 Empty States

```
EMPTY STATE PATTERN
═════════════════════

┌─────────────────────────────────────────────┐
│                                             │
│           📦 (illustration/icon)            │
│                                             │
│   Belum ada produk                         │  ← Clear statement
│                                             │
│   Mulai tambahkan produk pertama Anda       │  ← Helpful guidance
│   atau impor dari Excel.                   │
│                                             │
│   [+ Tambah Produk]  [📥 Import Excel]     │  ← CTAs
│                                             │
└─────────────────────────────────────────────┘

Empty State Variants:
- Search empty: "Tidak ditemukan untuk '[query]'"
- Filter empty: "Tidak ada produk dalam kategori ini"
- Tab empty: "Belum ada data di tab ini"
- Permission empty: "Fitur ini memerlukan paket Pro"
- Offline empty: "Tidak dapat memuat data. Mode offline."
```

---

## 6. CACHE & FRESHNESS INDICATORS

### 6.1 Stale Data Pattern

```
STALE DATA INDICATOR
═══════════════════════

┌─────────────────────────────────────────────────────────────┐
│  Transaksi                    🔄 2 menit lalu    [↻ Refresh]│
└─────────────────────────────────────────────────────────────┘

Rules:
- Show "last updated" timestamp on data-heavy pages
- Color code freshness:
  • < 1 menit: hijau (fresh)
  • 1-5 menit: abu (normal)
  • > 5 menit: kuning (stale)
  • Offline: merah dengan indikator
- Always provide manual refresh button
- Auto-refresh on window focus (configurable)
```

### 6.2 Offline Indicator

```
OFFLINE BANNER (already implemented ✅)
═══════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│  📴 Mode Offline — Data terakhir yang dimuat masih bisa     │
│  dilihat. Refresh dinonaktifkan.                    [✕]    │
└─────────────────────────────────────────────────────────────┘

Placement: Fixed top, z-index 100, above everything
Behavior: 
- Block all refresh actions
- Allow read-only operations
- Queue write operations (POS)
- Auto-dismiss when online
```

### 6.3 Sync Status (POS Specific)

```
SYNC STATUS INDICATOR
═══════════════════════

Status          Icon    Color    Description
─────────────── ──────  ───────  ─────────────────────
Synced          ✓       hijau   Semua data tersinkron
Syncing         ⏳       biru    Sedang menyinkronkan...
Pending         ◷       kuning  X transaksi menunggu
Failed          ✗       merah   Sinkronisasi gagal
Stale           🕐       abu     Data mungkin tidak terbaru
```

---

## 7. MOBILE / DESKTOP RESPONSIVENESS

### 7.1 Breakpoint Strategy

```css
/* BREAKPOINTS (Tailwind standard) */
sm: 640px   /* Large phones */
md: 768px   /* Tablets */
lg: 1024px  /* Small desktops */
xl: 1280px  /* Desktops */
```

### 7.2 Responsive Pattern: Table → Card

```
DESKTOP (≥ md)                          MOBILE (< md)
═══════════                             ═══════════

┌─────────────────────────────────┐     ┌─────────────────────┐
│ ID │ Nama     │ Stok │ Aksi  │     │ 📦 Kopi Arabika       │
│ 1  │ Kopi     │ 50   │ ✏️ 🗑️ │     │    Stok: 50           │
│ 2  │ Teh      │ 30   │ ✏️ 🗑️ │     │    Kategori: Minuman  │
│ 3  │ Susu     │ 20   │ ✏️ 🗑️ │     │                     │
└─────────────────────────────────┘     │ [✏️ Edit] [🗑️ Hapus] │
                                         ├─────────────────────┤
  Table layout                          │ 📦 Teh Poci         │
  Horizontal scroll OK                 │    Stok: 30           │
  Sortable headers                     │    Kategori: Minuman  │
  Row selection                        │                     │
                                         │ [✏️ Edit] [🗑️ Hapus] │
                                         └─────────────────────┘

  Card layout
  Vertical stack
  Touch-friendly taps
  Swipe actions (optional)
```

### 7.3 Touch Targets

```
TOUCH TARGET RULES
═══════════════════

Minimum size:  44px × 44px (WCAG 2.5.5)
Recommended:   48px × 48px

Spacing:       Minimum 8px between touch targets

Components that MUST be touch-friendly:
- Table row actions (edit, delete buttons)
- Checkbox/radio inputs
- Navigation links
- Form inputs
- Pagination controls
- Tab headers
- Filter chips
```

### 7.4 Safe Areas

```css
/* Mobile safe areas (notch, home indicator) */
padding-bottom: env(safe-area-inset-bottom);  /* Bottom nav */
padding-top: env(safe-area-inset-top);        /* Status bar */
```

---

## 8. PERMISSION-AWARE UX

### 8.1 Visibility vs Authorization Principle

> **"Visibility ≠ Authorization. Kalau cashier tidak boleh melakukan action, UX juga tidak menawarkan action tersebut. Tapi server tetap menjadi security boundary."**

### 8.2 Permission Display Matrix

| User Role | Sees Feature | Can Use | UX Treatment |
|-----------|-------------|---------|--------------|
| Owner | ✅ Visible | ✅ Enabled | Normal |
| Manager | ✅ Visible | ✅ Enabled | Normal |
| Cashier (allowed) | ✅ Visible | ✅ Enabled | Normal |
| Cashier (restricted) | 🔒 Hidden | ❌ Blocked | Don't show at all |
| Free user (Pro feature) | 🫥 Visible but blurred | ❌ Blocked | ProGate overlay |
| Over-limit user | ⚠️ Visible | ❌ Disabled | Disable + explain why |

### 8.3 ProGate Usage Rules

```typescript
// Feature gating pattern:

<ProGate feature="exportExcel">
  {/* Content yang digate */}
  <Button onClick={handleExport}>Export Excel</Button>
</ProGate>

// ProGate variants:
// - "card": Full card overlay with upgrade CTA (default)
// - "inline": Button-style lock indicator  
// - "badge": Minimal pill badge

// Rules:
// - Always explain WHAT is locked
// - Always explain WHY (briefly)
// - Always provide UPGRADE CTA
// - Never hide free features behind ProGate
```

### 8.4 Disabled State Communication

```
DISABLED STATE PATTERN
═══════════════════════

┌─────────────────────────────────────────────┐
│  📊 Export Excel        ┌─────────────────┐ │
│                        │ 🔒 Fitur Pro     │ │
│  Fitur ini memerlukan  │                  │ │
│  paket Pro untuk       │ [Upgrade Sekarang]│
│  mengekspor data.      │                  │ │
│                        └─────────────────┘ │
└─────────────────────────────────────────────┘

Rules for disabled:
- Show lock icon
- Show tooltip on hover/tap
- Explain WHY disabled
- Provide path to enable (upgrade link)
- NEVER silently disable without explanation
```

---

## 9. SEARCH & FILTER PATTERNS

### 9.1 Search Pattern

```
SEARCH INPUT PATTERN
═════════════════════

┌─────────────────────────────────────────────┐
│  🔍 Cari produk, SKU, atau barcode...   [×] │  ← Placeholder guides
└─────────────────────────────────────────────┘

Rules:
- Debounce 300ms (jangan query per keystroke)
- Clear button (×) to reset search
- Auto-focus on mount (hanya jika context jelas)
- Keyboard shortcut: "/" to focus (global)
- Show result count: "12 produk ditemukan"
- Handle empty state: "Tidak ditemukan untuk 'xyz'"
- Accessible: aria-label, role="search", aria-live results
```

### 9.2 Filter Pattern

```
FILTER BAR PATTERN
═════════════════════

┌─────────────────────────────────────────────────────────────┐
│ [Semua] [Aktif] [Non-aktif] [📂 Kategori ▾] [📅 Tanggal ▾] │
│                                                              │
│ Active filters:                                              │
│ [Kategori: Minuman ×] [Tanggal: Bulan Ini ×]    [Reset All] │
└─────────────────────────────────────────────────────────────┘

Rules:
- Filter chips: horizontal scroll on mobile
- Active filters shown as removable tags
- "Reset All" when any filter active
- Dropdown filters for many options (category, date)
- Persist filters in URL params (shareable/bookmarkable)
```

### 9.3 DateFilter Component (Standardized)

```
DATE FILTER PATTERN
═════════════════════

Quick ranges: [Hari Ini] [7 Hari] [30 Hari] [Bulan Ini] [Custom ▾]

Custom date picker:
┌────────────────────────────────┐
│  Dari: [📅 dd/mm/yyyy]         │
│  Sampai: [📅 dd/mm/yyyy]       │
│        [Terapkan] [Reset]      │
└────────────────────────────────┘

Usage: Dashboard, Transactions, Audit Log, Reports
```

---

## 10. PAGINATION PATTERN

### 10.1 Standard Pagination

```
PAGINATION COMPONENT
═════════════════════

┌─────────────────────────────────────────────────────────────┐
│  Menampilkan 1-20 dari 250 transaksi                       │
│                                                              │
│  [< Prev] [1] [2] [3] ... [13] [Next >]                    │
│                                                              │
│  Tampil per halaman: [20 ▾]                                 │
└─────────────────────────────────────────────────────────────┘

Features:
- Page size selector: 10, 25, 50, 100
- Total count display ("1-20 dari 250")
- Prev/Next navigation
- Ellipsis for many pages
- Current page highlighted
- Keyboard: Arrow keys to navigate pages
```

### 10.2 Infinite Scroll (Optional)

```
INFINITE SCROLL USE CASES:
- Activity feeds (Audit Log)
- Chat-like interfaces
- Long lists where pagination feels heavy

NOT suitable for:
- Data tables (need visible row count)
- Financial data (precision matters)
- Print/export scenarios
```

---

## 11. TOAST NOTIFICATION SYSTEM

### 11.1 Toast Types

```
TOAST VARIANTS (Sonner library)
═════════════════════════════════

SUCCESS (emerald):
┌──────────────────────────────────┐
│  ✅ Produk berhasil disimpan     │
└──────────────────────────────────┘
Duration: 3s | Position: top-right

ERROR (red):
┌──────────────────────────────────┐
│  ❌ Gagal menyimpan produk      │
│     Periksa koneksi internet    │
└──────────────────────────────────┘
Duration: 5s | Position: top-right | Manual dismiss

WARNING (amber):
┌──────────────────────────────────┐
│  ⚠️ Stok hampir habis (3 sisa)  │
└──────────────────────────────────┘
Duration: 5s | Position: top-right

INFO (blue):
┌──────────────────────────────────┐
│  ℹ️ Perubahan tersimpan otomatis │
└──────────────────────────────────┘
Duration: 3s | Position: top-right
```

### 11.2 Toast Rules

- Max 3 toasts visible simultaneously
- Newest appears on top
- Click to dismiss
- Auto-dismiss after duration
- Error toasts require manual dismiss (longer duration)
- No stacking identical messages
- Include actionable CTA when relevant ("Undo", "Retry")

---

## 12. DOMAIN-BY-DOMAIN UX GUIDELINES

### 12.1 Implementation Priority Order

```
AETHER UX REDESIGN ROADMAP
═══════════════════════════════════════

╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║  PHASE 0 — UX FOUNDATION 🏗️                                  ║
║  ═══════════════════                                         ║
║  Bukan redesign domain. Ini membangun "bahasa UI"             ║
║  yang dipakai SEMUA domain.                                   ║
║                                                               ║
║  Deliverables:                                               ║
║  ├── useMutation hook (Mutation Contract implementation)     ║
║  ├── Shared loading states (skeletons, spinners)             ║
║  ├── Shared empty states (illustrations + CTAs)              ║
║  ├── Shared error states (actionable errors)                 ║
║  ├── Confirmation dialog component                         ║
║  ├── Stale data indicator component                         ║
║  ├── Dialog/Drawer responsive wrapper                       ║
║  ├── Mobile card-view table component                       ║
║  ├── Toast notification standards                           ║
║  ├── Button hierarchy tokens                                ║
║  └── Design token documentation                             ║
║                                                               ║
║  Kenapa dulu?                                                ║
║  Kalau Product/Purchase dikerjakan sebelum shared           ║
║  primitives selesai → potensi bikin pattern                ║
║  berbeda-beda → harus standardisasi ulang.                  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 1 — POS 🧾 [VALIDATION GROUND] ⭐                    ║
║  ═══════════════════════════════════                         ║
║  Primary user touchpoint. 3515 baris. 49 useState.            ║
║                                                               ║
║  ⚠️ PRINSIP KRITIS:                                          ║
║  "POS adalah VALIDATION GROUND, bukan target langsung        ║
║   untuk apply semua primitive."                               ║
║                                                               ║
║  Workflow: AUDIT → SCOPE → PRESERVE → REDESIGN → VERIFY      ║
║  (Lihat Section 12.1.1 untuk detail lengkap)                  ║
║                                                               ║
║  Focus Areas (setelah audit):                                ║
║  ├── Barcode detection heuristic                             ║
║  ├── Receipt print (popup blocker)                           ║
║  ├── Cart persistence + recovery                             ║
║  ├── beforeunload integration                                ║
║  ├── Checkout/payment flow                                   ║
║  ├── Offline checkout + sync                                 ║
║  ├── Sync retry cap                                          ║
║  ├── Offline void                                           ║
║  ├── Keyboard shortcut + navigation                          ║
║  ├── Mobile POS usability                                   ║
║  └── Stock/HPP protection verification                       ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 2 — PRODUCT 🛍️                                       ║
║  ═════════════════════                                        ║
║  Terbesar kedua. 4150 baris. 79 useState.                     ║
║                                                               ║
║  Focus:                                                     ║
║  ├── Split into 6+ modules/hooks                            ║
║  ├── Composition × Variant stability                       ║
║  ├── Mobile card view verification                           ║
║  ├── Bulk operation UX                                      ║
║  └── Empty state + offline indicator                        ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 3 — PURCHASE 📦                                       ║
║  ═════════════════════                                        ║
║  TERBESAR! 8900 baris. 153 useState. KRITIS.                 ║
║                                                               ║
║  Focus:                                                     ║
║  ├── Split into 8+ modules/hooks (!!)                       ║
║  ├── Product vs Inventory item clarity                      ║
║  ├── Supplier search accessibility                           ║
║  ├── Posting progress indication                            ║
║  └── Excel import error handling                             ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 4 — SUPPORTING WORKFLOWS                              ║
║  ═══════════════════════════                                 ║
║                                                               ║
║  4a. Transaction  (7/10)  Mobile table, filter simplification║
║  4b. Stock Opname (7/10)  Checkbox fix, mobile view          ║
║  4c. Transfer     (8/10)  Deduplication, dual-tab simplify   ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 5 — PLATFORM & SETTINGS                              ║
║  ═══════════════════════════                                 ║
║                                                               ║
║  5a. Settings     (8/10)  IA restructure, unsaved guard     ║
║  5b. Plan/Pricing (3/10)  Minor polish (already good!)      ║
║  5c. Crew         (5/10)  Permission presets, activity       ║
║  5d. Customer     (5/10)  Language fix, merge UI            ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  PHASE 6 — POLISH                                            ║
║  ═════════════════                                            ║
║                                                               ║
║  6a. Dashboard    (6/10)  Date picker, export               ║
║  6b. Audit Log    (5/10)  Server-side pagination            ║
║  6c. Migration Wizard (4/10)  Real progress (LAST!)         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

KEY PRINCIPLE:
"Phase 0 membangun fondasi. Phase 1-6 menggunakan fondasi itu.
 Jangan skip Phase 0 atau Anda akan membangun di atas pasir."

POS VALIDATION GROUND PRINCIPLE:
"Phase 1 POS adalah laboratorium pertama. Jangan apply semua primitive
 langsung — audit dulu, buktikan pattern bekerja, baru bawa ke domain lain.
 Kalau Phase 1 POS sukses, pattern bisa dibawa ke Product → Purchase → ..."
```

### 12.1.1 ⭐ PHASE 1 POS — DETAILED METHODOLOGY

> **Status**: 🟡 READY FOR EXECUTION (setelah Phase 0 selesai)
> **Principle**: "POS adalah validation ground, bukan target langsung"

#### Mengapa POS Berbeda?

```
POS ARCHITEKTUR OFFLINE-FIRST
═════════════════════════════

ONLINE DOMAIN (biasa):
┌─────────┐    ┌─────────┐    ┌───────┐    ┌──────────────────┐
│   UI    │ →  │   API   │ →  │   DB  │ → │ REFRESH / CACHE   │
└─────────┘    └─────────┘    └───────┘    │   INVALIDATION    │
                                           └────────┬─────────┘
                                                      ↓
                                           ┌──────────────────┐
                                                   UI Update
                                           └──────────────────┘


OFFLINE POS (Aether khusus):
┌─────────┐    ┌───────────┐    ┌───────────┐
│   UI    │ →  │ IndexedDB │ →  │ UI Update  │
└─────────┘    │  Local    │    │ (Optimis)  │
               │  Commit   │    └───────────┘
               └─────┬─────┘           │
                     ↓                 │
               ┌───────────┐          │
               │Sync Queue  │──────────┘
               └─────┬─────┘
                     ↓ (when online)
               ┌───────────┐    ┌───────────┐    ┌──────────────┐
               │  Server   │ →  │ Dedup/    │ →  │ Final UI     │
               │  Commit   │    │ Conflict  │    │ State        │
               └───────────┘    └───────────┘    └──────────────┘


⚠️ IMPLIKASI KRITIS:
"useMutation() jangan dipaksakan ke semua flow POS
 kalau itu membuat IndexedDB/local commit menjadi
 sekadar wrapper HTTP."

Mutation Contract TETAP BERLAKU, tetapi implementasinya
harus mengikuti POS Offline Variant yang sudah disepakati.
```

#### Phase 1 Workflow: 5 Step

```
PHASE 1 — POS REDESIGN WORKFLOW
════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│  STEP 1 — AUDIT (READ-ONLY) 🔍                             │
│  ═══════════════════════════                               │
│                                                             │
│  Trace lengkap POS user journey:                            │
│  ├── Product discovery (search, category, barcode)          │
│  ├── Barcode scan (heuristic, timing, edge cases)          │
│  ├── Add to cart (validation, stock check)                  │
│  ├── Cart persistence/recovery (IndexedDB, beforeunload)    │
│  ├── Checkout (validation, total calculation)              │
│  ├── Payment (method selection, processing)                │
│  ├── Transaction commit (online vs offline)                │
│  ├── Offline transaction (local commit, queue)             │
│  ├── Sync (queue, retry cap, dedup)                        │
│  ├── Void (online void, offline void, restoration)         │
│  └── Error recovery (network, payment, inventory)          │
│                                                             │
│  Trace SETIAP mutation dan data flow.                      │
│  Jangan rely pada grep/static pattern matching saja.        │
│  Follow execution flow ke actual state mutation.            │
│                                                             │
│  OUTPUT: Audit Report dengan classification                 │
│  (UX issue / Data issue / Arch issue / False positive)      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2 — SCOPE 📋                                         │
│  ═════════════════                                          │
│                                                             │
│  Definisikan dengan eksplisit:                              │
│  ├── Files/components allowed to modify                    │
│  ├── Shared UX primitives allowed to use                   │
│  ├── Frozen architecture zones (TIDAK BOLEH DISENTUH)      │
│  ├── Existing business rules that must remain unchanged    │
│  └── Confirmed bugs vs UX issues vs false positives        │
│                                                             │
│  OUTPUT: Scope Document dengan ALLOWED/FORBIDDEN list      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3 — PRESERVE 🛡️                                      │
│  ═══════════════════                                        │
│                                                             │
│  Verifikasi dan pertahankan secara EKSPLISIT:               │
│  ├── ✅ InventoryConsumptionService                         │
│  ├── ✅ FEFOEngine (First Expired First Out)                │
│  ├── ✅ COGS semantics (Cost of Goods Sold)                 │
│  ├── ✅ Inventory invariants                                │
│  ├── ✅ IndexedDB offline-first flow                       │
│  ├── ✅ EventId idempotency                                │
│  ├── ✅ Sync deduplication                                 │
│  ├── ✅ Atomic server mutations                            │
│  ├── ✅ Payment validation                                 │
│  ├── ✅ Void/restoration semantics                         │
│  └── ✅ Permission boundaries                              │
│                                                             │
│  OUTPUT: Preservation Checklist (signed off sebelum step 4) │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4 — REDESIGN ✏️                                       │
│  ════════════════════                                       │
│                                                             │
│  Apply UX Foundation primitives dimana COCOK:               │
│  ├── Loading states (skeletons, spinners)                   │
│  ├── Empty states (illustrations + CTAs)                    │
│  ├── Error states (actionable, retryable)                   │
│  ├── Confirmation dialogs                                  │
│  ├── Stale/freshness indicators                            │
│  └── Mutation feedback (toast, progress)                   │
│                                                             │
│  Improve:                                                  │
│  ├── Barcode workflow (detection, feedback, error)         │
│  ├── Cart UX (persistence, recovery, clear confirm)        │
│  ├── Checkout UX (validation, summary, flow)               │
│  ├── Payment UX (method selection, processing state)       │
│  ├── Offline visibility (indicator, queue status)          │
│  ├── Sync visibility (progress, retry, error)              │
│  ├── Keyboard efficiency (shortcuts, focus management)     │
│  └── Mobile responsiveness (touch targets, layout)         │
│                                                             │
│  ⚠️ JANGAN ubah business semantics atau domain contracts!  │
│                                                             │
│  OUTPUT: Redesigned components + Integration test          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 5 — VERIFY ✓                                         │
│  ══════════════════                                         │
│                                                             │
│  Setelah implementation:                                    │
│  ├── □ Run lint (bun run lint)                             │
│  ├── □ Run TypeScript checks                               │
│  ├── □ Run relevant tests                                  │
│  ├── □ Verify online checkout flow                         │
│  ├── □ Verify offline checkout flow                        │
│  ├── □ Verify sync (queue → server → resolution)           │
│  ├── □ Verify retry cap behavior                           │
│  ├── □ Verify cart recovery (refresh, reconnect)           │
│  ├── □ Verify beforeunload (warning saat cart tidak kosong)│
│  ├── □ Verify void/restoration (stock restored correctly)  │
│  ├── □ Verify inventory/COGS invariants (tidak berubah)    │
│  └── □ UX consistency (pattern compliance)                 │
│                                                             │
│  OUTPUT: Verification Report + Regression sign-off         │
└─────────────────────────────────────────────────────────────┘
```

#### Area Verifikasi Kritis (dari Audit Sebelumnya)

```
POS VERIFICATION CHECKLIST (13 Areas)
═════════════════════════════════════

Area-area ini HARUS diverifikasi ulang selama Step 1 AUDIT.
Jangan diasumsikan benar dari audit sebelumnya.

┌──┬──────────────────────────┬───────────────────────────────┐
│# │ Area                     │ Verifikasi                    │
├──┼──────────────────────────┼───────────────────────────────┤
│1 │Barcode detection         │Timing heuristic reliable?     │
│  │heuristic                 │Edge cases handled?            │
├──┼──────────────────────────┼───────────────────────────────┤
│2 │Cart persistence          │IndexedDB write correct?       │
│  │                          │Recovery on reconnect works?   │
├──┼──────────────────────────┼───────────────────────────────┤
│3 │beforeunload              │Warning triggered when cart    │
│  │integration               │not empty? Data saved?         │
├──┼──────────────────────────┼───────────────────────────────┤
│4 │Checkout/payment flow     │All payment methods work?      │
│  │                          │Validation complete?           │
├──┼──────────────────────────┼───────────────────────────────┤
│5 │Offline checkout          │Local commit works?            │
│  │                          │UI shows correct status?       │
├──┼──────────────────────────┼───────────────────────────────┤
│6 │Sync + retry cap          │Queue processed correctly?     │
│  │                          │Retry cap enforced?            │
├──┼──────────────────────────┼───────────────────────────────┤
│7 │Offline void              │Void works without server?     │
│  │                          │Queued for sync?               │
├──┼──────────────────────────┼───────────────────────────────┤
│8 │Stale cache               │Cache invalidated after        │
│  │                          │mutation? Freshness indicator? │
├──┼──────────────────────────┼───────────────────────────────┤
│9 │Keyboard shortcut         │All shortcuts work?            │
│  │+ navigation              │Focus management correct?      │
├──┼──────────────────────────┼───────────────────────────────┤
│10│Payment dialog            │Tab order logical?             │
│  │navigation                │Escape cancels?                │
├──┼──────────────────────────┼───────────────────────────────┤
│11│Stock/HPP protection      │Stock cannot go negative?      │
│  │                          │HPP preserved on transaction?  │
├──┼──────────────────────────┼───────────────────────────────┤
│12│Void restoration          │Full atomic rollback?          │
│  │                          │Inventory fully restored?      │
├──┼──────────────────────────┼───────────────────────────────┤
│13│Mobile POS usability      │Touch targets ≥44px?           │
│  │                          │Layout usable on small screen? │
└──┴──────────────────────────┴───────────────────────────────┘

CATATAN PENTING:
Cart persistence + beforeunload + retry cap SUDAH diimplementasikan.
Phase 1 harus memastikan implementasinya BENAR-BENAR terintegrasi
dengan flow POS lengkap, bukan cuma lolos lint secara isolated.
```

#### useMutation() Warning untuk POS

```
⚠️ useMutation() DI POS — KAPAN BOLEH, KAPAN TIDAK
═══════════════════════════════════════════════════

BOLEH pakai useMutation() di POS:
  ✅ Mutations yang purely HTTP (settings fetch, non-critical ops)
  ✅ UI-only state mutations (dialog open/close, form field changes)
  ✅ Mutations where local commit ≈ server success semantics
  
TIDAK BOLEH pakai useMutation() standar:
  ❌ Offline checkout (harus ikut LOCAL COMMIT → SYNC QUEUE flow)
  ❌ Offline void (harus preserve restoration semantics)
  ❌ Cart operations yang persist ke IndexedDB
  ❌ Apapun yang mengubah sync queue
  
ALTERNATIF UNTUK POS OFFLINE:
  📦 useOfflineMutation() — custom hook yang:
     - Mengikuti Mutation Contract 5-phase
     - Tetapi COMMIT = IndexedDB local commit
     - REFRESH = optimistic UI update
     - SYNC = background process terpisah
     - FINAL STATE = setelah server confirm
     
  📦 usePosCheckout() — dedicated hook yang:
     - Handle full checkout lifecycle
     - Integrate dengan InventoryConsumptionService
     - Preserve COGS calculation
     - Handle online/offline branching
```

#### Phase 1 GLM Prompt Template

```markdown
PHASE 1 — POS REDESIGN

Read and follow:
1. docs/ARCHITECTURE-LOCK.md
2. docs/PLATFORM-ARCHITECTURE-REVIEW.md
3. docs/UX-DESIGN-CONTRACT.md
4. Existing POS architecture and offline/sync implementation

CORE PRINCIPLE:
"Improve the cockpit without touching the engine."

WORKFLOW:
AUDIT → SCOPE → PRESERVE → REDESIGN → VERIFY

STEP 1 — AUDIT (READ-ONLY)
Trace the complete POS user journey:
- Product discovery
- Barcode scan
- Add to cart
- Cart persistence/recovery
- Checkout
- Payment
- Transaction commit
- Offline transaction
- Sync
- Sync retry
- Void
- Error recovery

Trace every mutation and data flow.
Do not rely on grep/static pattern matching alone.
Follow execution flow to the actual state mutation.

STEP 2 — SCOPE
Define:
- Files/components allowed to modify
- Shared UX primitives allowed to use
- Frozen architecture zones
- Existing business rules that must remain unchanged
- Confirmed bugs vs UX issues vs false positives

STEP 3 — PRESERVE
Explicitly verify and preserve:
- InventoryConsumptionService
- FEFOEngine
- COGS semantics
- Inventory invariants
- IndexedDB offline-first flow
- EventId idempotency
- Sync deduplication
- Atomic server mutations
- Payment validation
- Void/restoration semantics
- Permission boundaries

STEP 4 — REDESIGN
Apply UX Foundation primitives where appropriate:
- Loading states
- Empty states
- Error states
- Confirmation dialogs
- Stale/freshness indicators
- Mutation feedback

Improve:
- Barcode workflow
- Cart UX
- Checkout UX
- Payment UX
- Offline visibility
- Sync visibility
- Keyboard efficiency
- Mobile responsiveness

Do NOT change business semantics or domain contracts.

STEP 5 — VERIFY
After implementation:
- Run lint
- Run TypeScript checks
- Run relevant tests
- Verify online checkout
- Verify offline checkout
- Verify sync
- Verify retry cap
- Verify cart recovery
- Verify beforeunload
- Verify void/restoration
- Verify inventory/COGS invariants

REPORT:
1. Files modified
2. UX improvements
3. Confirmed bugs fixed
4. Business logic preserved
5. Tests executed
6. Regression results
7. Deferred issues

IMPORTANT:
If a new bug is discovered outside the UX scope:
STOP → classify → report separately → do not silently expand scope.

Do not modify frozen architecture unless explicitly approved.
```

---

### 12.2 Domain-Specific Guidelines

#### POS (Domain 1 — Priority: CRITICAL)

```
POS UX REQUIREMENTS
═════════════════════

⚠️ LIHAT Section 12.1.1 untuk methodology lengkap!
Phase 1 POS menggunakan workflow: AUDIT→SCOPE→PRESERVE→REDESIGN→VERIFY

MUST FIX (tentatif — finalisasi setelah AUDIT):
□ Barcode detection heuristic (timing-based → event-based)
□ Receipt print (window.open → iframe/print API)
□ Cart clear confirmation
□ Settings fetch deduplication (70 lines duplicated)
□ Cart persistence integration verification
□ beforeunload integration verification

SHOULD IMPROVE (tentatif — finalisasi setelah AUDIT):
□ Keyboard shortcut reference overlay
□ Low stock warning during product selection
□ Session timeout handling mid-transaction
□ Printer connection detection
□ Offline visibility indicator
□ Sync progress feedback
□ Mobile POS layout optimization

NICE TO HAVE:
□ Hold/restore transaction feature
□ Quick product switcher
□ Recent products memory
```

#### Product (Domain 2 — Priority: CRITICAL)

```
PRODUCT UX REQUIREMENTS
═════════════════════════

MUST FIX:
□ Split 4150-line file into modules:
  - use-product-list.ts (fetching, filtering, pagination)
  - use-product-form.ts (add/edit form logic)
  - use-product-category.ts (category CRUD)
  - use-product-bulk.ts (bulk upload/update)
  - ProductTable.tsx (table component)
  - ProductFormDialog.tsx (form dialog)
  - CategoryManager.tsx (category panel)
  - BulkOperationsPanel.tsx (bulk actions)

SHOULD IMPROVE:
□ Composition × Variant interaction stability
□ Empty state with illustration
□ Offline indicator
□ Mobile card view (partially exists)

NICE TO HAVE:
□ Product duplicate detection
□ Bulk operation progress detail
□ Advanced search (by range, by supplier)
```

#### Purchase (Domain 3 — Priority: CRITICAL)

```
PURCHASE UX REQUIREMENTS
═════════════════════════

MUST FIX:
□ Split 8900-line file into modules (!!)
□ Reduce 153 useState hooks to managed state
□ Clarify Product vs Inventory item distinction

SHOULD IMPROVE:
□ Supplier search accessibility (ARIA roles)
□ Posting progress indicator
□ Excel import error user-friendly messages

NICE TO HAVE:
□ Purchase template presets
□ Recurring purchase detection
□ Supplier performance metrics
```

#### Transaction (Domain 4 — Priority: HIGH)

```
TRANSACTION UX REQUIREMENTS
═════════════════════════════

MUST FIX:
□ Mobile table → card view (exists, verify completeness)
□ Filter panel simplification (7 filters overwhelming)

SHOULD IMPROVE:
□ Void reason character limit display
□ Export filename includes filter context
□ Large dataset warning (>1000 transactions)

NICE TO HAVE:
□ Transaction detail print-friendly view
□ Customer spending timeline from here
```

#### Stock Opname (Domain 5 — Priority: HIGH)

```
STOCK OPNAME UX REQUIREMENTS
═══════════════════════════════

MUST FIX:
□ Zero-stock checkbox (connect to handleStart)
□ Add mobile card view for snapshot table
□ Offline indicator

SHOULD IMPROVE:
□ Batch-level visibility in main table
□ Progress percentage bar
□ Variance monetary value display
□ Cancel confirmation dialog

NICE TO HAVE:
□ Concurrency conflict warning
□ Partial save / pause session
□ Opname session expiry indicator
```

#### Transfer (Domain 6 — Priority: HIGH)

```
TRANSFER UX REQUIREMENTS
═══════════════════════════

MUST FIX:
□ Eliminate product/inventory code duplication
□ Simplify dual-tab cognitive load

SHOULD IMPROVE:
□ Over-transfer prevention (validate against stock)
□ Transfer route presets/templates
□ Receive action prominence

NICE TO HAVE:
□ Partial receive support
□ Batch/expiry awareness in transfers
□ Transfer history timeline
```

#### Settings (Domain 7 — Priority: HIGH)

```
SETTINGS UX REQUIREMENTS
═════════════════════════

MUST FIX:
□ Restructure IA (see Section 3.4)
□ Unsaved changes navigation guard
□ Standardize save patterns (auto-save vs manual)

SHOULD IMPROVE:
□ Settings search/filter (30+ options need findability)
□ Destructive change warnings (disable loyalty, payment methods)
□ Theme preview live
□ Consolidate scattered receipt settings

NICE TO HAVE:
□ Reset to defaults option
□ Import/export configuration
│ Settings change log
```

#### Plan & Pricing (Domain 8 — Priority: LOW)

```
PLAN/PRICING UX REQUIREMENTS
═════════════════════════════

STATUS: Already well-designed! ✅

EXISTING STRENGTHS:
□ UsageRing component with SVG visualization
□ 80% near-limit warning (amber)
□ 100% at-limit indication (red)
□ 5 usage metrics displayed

MINOR IMPROVEMENTS:
□ Post-upgrade celebration/welcome modal
□ Plan comparison table mobile optimization
□ ProGate accessibility (aria-hidden on blur)
```

#### Crew (Domain 9 — Priority: MEDIUM)

```
CREW UX REQUIREMENTS
═════════════════════

MUST FIX:
□ Delete cascade effects communication
□ Activity/last-login visibility

SHOULD IMPROVE:
□ Permission preset templates (Cashier, Manager, Admin)
□ Password strength meter
□ Invite-by-link flow (optional enhancement)

NICE TO HAVE:
□ Crew session management
□ Quick-jump to crew's audit log
□ Bulk permission assignment
```

#### Customer (Domain 10 — Priority: MEDIUM)

```
CUSTOMER UX REQUIREMENTS
═══════════════════════════

MUST FIX:
□ Form dialog language (English → Indonesian)
□ Fix tier calculation proxy (use createdAt, not tier)

SHOULD IMPROVE:
□ Merge customers UI (API exists, no UI)
□ Quick-add customer from POS
□ Loyalty redemption history view

NICE TO HAVE:
□ Customer notes/internal tags
□ Customer export to Excel
□ Duplicate WhatsApp detection warning
```

#### Dashboard (Domain 11 — Priority: MEDIUM)

```
DASHBOARD UX REQUIREMENTS
═══════════════════════════

MUST FIX:
□ Add date range picker (DateFilter exists, just wire it!)
□ Add export functionality (even if Pro-gated)

SHOULD IMPROVE:
□ Information density management (progressive disclosure)
□ Health Score explanation (more discoverable)
□ "Last updated" timestamp

NICE TO HAVE:
□ Customizable dashboard widgets
□ Comparison periods (vs last week, vs last month)
□ Goal tracking / targets
```

#### Audit Log (Domain 12 — Priority: LOW)

```
AUDIT LOG UX REQUIREMENTS
═══════════════════════════

MUST FIX:
□ Server-side pagination (currently limited to 100 records)
□ Tab filtering from complete dataset (not client-side 100)

SHOULD IMPROVE:
□ Real-time / auto-refresh toggle
□ Log severity indication (VOID vs CREATE same weight)
□ Date filter badge formatting

NICE TO HAVE:
□ Actor filter (who did what)
□ Entity type filter
□ Export to Excel (Pro feature)
```

#### Migration Wizard (Domain 13 — Priority: LAST)

```
MIGRATION WIZARD UX REQUIREMENTS
═════════════════════════════════

STATUS: Best-designed flow already! ✅

EXISTING STRENGTHS:
□ Industry guide with mode recommendations
□ 3 import modes with clear differentiation
□ Comprehensive success screen with stats
□ Re-migration handling

MINOR IMPROVEMENTS:
□ Make progress real (not simulated setTimeout)
□ Add data preview step before commit
□ Skip migration option for new users
□ Pre-upload re-migration warning
```

---

## 13. CROSS-FEATURE CONSISTENCY CHECKLIST

Sebelum mendeklarasikan domain selesai, verifikasi:

### 13.1 Pattern Consistency

```
CONSISTENCY CHECKLIST
═══════════════════════

Loading States
  □ Skeleton untuk initial load
  □ Spinner untuk inline actions
  □ Progress bar untuk multi-step
  □ Overlay blocker untuk modal

Empty States
  □ Illustration/icon
  □ Clear message
  □ Helpful guidance
  □ Actionable CTA(s)

Error States
  □ Human-readable message
  □ Explanation (optional)
  □ Recovery action(s)
  □ No technical jargon

Success Feedback
  □ Toast notification
  □ Visual state change
  □ Contextual message

Validation
  □ Inline errors
  □ Required field indicators
  □ Submit-time validation
  □ Error summary for forms

Confirmation
  □ Destructive actions confirmed
  □ Clear consequence explanation
  □ AlertDialog component used
  □ Non-destructive: optional

Search
  □ Debounced (300ms)
  □ Result count shown
  □ Empty search handled
  □ Keyboard accessible

Filter
  □ Active filters visible
  □ Removable individual filters
  □ Reset all option
  □ URL-persisted (where applicable)

Pagination
  □ Page size selector
  □ Total count display
  □ Prev/Next navigation
  □ Keyboard navigable

Mobile Responsiveness
  □ Table → card view conversion
  □ Touch targets ≥ 44px
  □ Safe area handling
  □ Horizontal scroll where appropriate

Permission Visibility
  □ Restricted features hidden for unauthorized
  □ Locked features explained (ProGate)
  □ Disabled states communicated
  □ Server remains security boundary

Language Consistency
  □ All UI text in Indonesian
  □ Technical terms consistent (HPP, SKU, POS)
  □ No English/Indonesian mixing

Theme Token Usage
  □ No hardcoded colors (use theme-* tokens)
  □ Consistent semantic colors
  □ Proper contrast ratios
```

### 13.2 Mutation Contract Compliance

```
MUTATION CONTRACT CHECKLIST (per domain)
═══════════════════════════════════════════

For each mutation (create, update, delete, post, void):
  □ PREPARE: User intent captured
  □ PREPARE: Client-side validation runs
  □ PREPARE: setLoading(true) called
  □ PREPARE: Duplicate action prevented
  □ COMMIT: Awaits API/DB mutation
  □ INVALIDATE: Affected cache keys invalidated
  □ REFRESH: Affected resources re-fetched
  □ FEEDBACK: Success → toast.success()
  □ FEEDBACK: Error → toast.error() with actionable message
  □ FEEDBACK: Finally → setLoading(false)
  □ POST-CONDITION: UI reflects committed state
```

---

## 14. IMPLEMENTATION WORKFLOW

### 14.1 Per-Domain Workflow

```
DOMAIN REDESIGN WORKFLOW
═════════════════════════

1. AUDIT (selesai ✅)
   └── Sudah dilakukan untuk 13 domain

2. PLAN (per domain)
   ├── Identifikasi komponen yang perlu dipecah
   ├── Mapping state ke custom hooks
   ├── List semua mutation points
   └── Define new component structure

3. IMPLEMENT Layer 1 (Infrastructure)
   ├── Apply design tokens
   ├── Implement useMutation hook
   ├── Create shared components (empty states, etc.)
   └── Standardize loading/error patterns

4. IMPLEMENT Layer 2 (Global IA)
   ├── Update sidebar/navigation
   ├── Standardize terminology
   └── Update mobile nav

5. IMPLEMENT Layer 3 (Domain UX)
   ├── Refactor component structure
   ├── Apply domain-specific guidelines
   ├── Implement all checklist items
   └── Cross-feature consistency check

6. VERIFY
   ├── Run lint: bun run lint
   ├── Check dev server log for errors
   ├── Manual testing (or Agent Browser)
   └── Regression: bun run test:invariant
```

### 14.2 Quality Gates

```
QUALITY GATES (sebelum declare done)
═══════════════════════════════════════

GATE 1: Code Quality
  □ bun run lint passes
  □ No TypeScript errors
  □ No console.errors in dev

GATE 2: Architecture Compliance
  □ bun run test:invariant passes
  □ No bypass of InventoryConsumptionService
  □ No bypass of FEFO
  □ Audit trail intact

GATE 3: UX Contract Compliance
  □ All checklist items in Section 13.1 pass
  □ All mutations follow contract (Section 13.2)
  □ Language consistency verified
  □ Theme token compliance verified

GATE 4: Responsive Verification
  □ Mobile viewport (375px) tested
  □ Tablet viewport (768px) tested
  □ Desktop viewport (1280px) tested
  □ Touch targets verified

GATE 5: Accessibility (Basic)
  □ Keyboard navigation works
  □ Screen reader friendly (basic)
  □ Color contrast acceptable
  □ Focus indicators visible
```

---

## 15. APPENDIX

### 15.1 File Size Targets (Post-Refactor)

| File | Current Lines | Target Lines | Strategy |
|------|--------------|-------------|----------|
| purchase-page.tsx | 8,900 | < 2,000 | Split into 6+ modules |
| pos-page.tsx | 3,515 | < 2,000 | Extract hooks, sub-components |
| products-page.tsx | 4,150 | < 2,000 | Split into 6+ modules |
| settings-page.tsx | 2,613 | < 1,500 | Split into tab-modules |
| transfer-page.tsx | 1,944 | < 1,500 | Eliminate duplication |
| transactions-page.tsx | 1,638 | < 1,200 | Extract table/card views |
| dashboard-page.tsx | 274 | < 500 | Add date picker, export |

### 15.2 useState Reduction Targets

| File | Current Hooks | Target Hooks | Strategy |
|------|--------------|-------------|----------|
| purchase-page.tsx | 153 | < 30 | useReducer / custom hooks |
| products-page.tsx | 79 | < 25 | Custom hooks per concern |
| pos-page.tsx | 49 | < 20 | Extract cart, payment, search state |
| settings-page.tsx | 40 | < 15 | Per-tab state modules |
| transfer-page.tsx | 37 | < 15 | Unified transfer hook |

### 15.3 Glossary

| Term | Definition |
|------|-----------|
| **Mutation** | Setiap operasi write: create, update, delete, post, void, adjust |
| **Source of Truth** | Data authoritatif (server DB untuk online, IndexedDB untuk offline) |
| **Invalidation** | Menandai cache sebagai stale, memaksa re-fetch |
| **Optimistic Update** | Update UI sebelum API respond, rollback jika gagal |
| **Stale Data** | Data yang mungkin tidak mencerminkan state terbaru server |
| **ProGate** | Komponen wrapper untuk fitur yang memerlukan paket Pro |
| **Design Token** | Variabel desain (warna, spacing, typography) yang terstandarisasi |
| **IA** | Information Architecture — struktur dan organisasi informasi |
| **ADR** | Architecture Decision Record — dokumen keputusan arsitektur |

---

## 16. CONTRACT APPROVAL

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   AETHER UX DESIGN CONTRACT v1.0                            │
│                                                             │
│   Status:        🔒 APPROVED v1.0               │
│   Version:       1.0-approved+guardrails                       │
│   Created:       2026-01-29                                 │
│   Last Updated:  2026-01-29 (added 5 Architecture Guardrails)│
│   Author:        UX Audit Coordinator                      │
│   Basis:         Full UX Surface Audit (13 domains)        │
│                  + Code Verification                       │
│                                                             │
│   Companion Locks:                                          │
│   ├─ ARCHITECTURE LOCK              🔒 APPROVED           │
│   ├─ PLATFORM ARCHITECTURE          🔒 REVIEWED           │
│   ├─ PRODUCT DOMAIN                 🔒 FROZEN             │
│   ├─ MUTATION CONTRACT              🔒 v1.0 (this doc)    │
│   └─ UX DESIGN CONTRACT             🔒 APPROVED v1.0      │
│                                                             │
│   Guardrails Included:                                      │
│   ├─ ✅ G1: No Business Logic Drift                       │
│   ├─ ✅ G2: Read-Only Audit Before Write                  │
│   ├─ ✅ G3: Domain Freeze Boundary                        │
│   ├─ ✅ G4: Mutation Contract Enforcement                  │
│   └─ ✅ G5: UX Redesign Must Be Domain-Scoped            │
│                                                             │
│   Approvals:                                                 │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ Guardrails Review:  ✅ APPROVED      │  │
│   │ Architecture Review:  ⬜ Pending                     │  │
│   │ UX Review:             ⬜ Pending                     │  │
│   │ Product Owner:         ⬜ Pending                     │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   Implementation Status:                                    │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ UX Foundation (Phase 0):  🟢 IN PROGRESS   │  │
│   │ POS (Phase 1):            🟡 METHODOLOGY READY     │  │
│   │              (AUDIT→SCOPE→PRESERVE→REDESIGN→VERIFY)│  │
│   │ Product (Phase 2):         ⏳ QUEUED                │  │
│   │ Purchase (Phase 3):        ⏳ QUEUED                │  │
│   │ Phases 4-6:               ⏳ QUEUED                │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   Next Steps (after approval):                               │
│   1. ✅ Phase 0: Build UX Foundation primitives             │
│   2. 🔄 Phase 1: POS AUDIT (READ-ONLY) — trace user journey,│
│      mutation surface, data flow, offline flow, sync flow   │
│   3. Phase 1: POS SCOPE — define allowed/forbidden files    │
│   4. Phase 1: PRESERVE — sign off preservation checklist    │
│   5. Phase 1: REDESIGN — apply primitives where appropriate  │
│   6. Phase 1: VERIFY — lint, types, tests, regression       │
│   7. Continue through phases 2-6 in order                   │
│                                                             │
│   Phase 1 Key Principle:                                    │
│   "POS adalah VALIDATION GROUND — audit dulu, buktikan      │
│    pattern bekerja, baru bawa ke domain lain."              │
│                                                             │
│   Phase 1 Methodology: Section 12.1.1                       │
│   Phase 1 Prompt Template: Section 12.1.1 (GLM Prompt)      │
│   POS Verification Checklist: 13 areas (Section 12.1.1)     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

**Document End**

*Companion: ARCHITECTURE-LOCK.md | PLATFORM-ARCHITECTURE-REVIEW.md*
*Version: 1.0-approved+guardrails+phase1-methodology | Last Updated: 2026-01-29*
*
*Core Principle: "Improve the cockpit without touching the engine."*
*Phase 1 Principle: "POS adalah validation ground — audit dulu, buktikan, baru bawa ke domain lain."*
