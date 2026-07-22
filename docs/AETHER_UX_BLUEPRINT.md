# AETHER UX BLUEPRINT v1.3 (LOCKED)

> **Status**: LOCKED — founder-approved with v1.3 cleanup. POS pilot redesign may begin.
> **Owner**: Product (Z.ai) + Founder (Ahtjong)
> **Predecessor**: `docs/CHECKPOINT-PHASE-0.5.md` (platform declared stable)
> **Successor**: POS Pilot Redesign (`docs/POS-REDESIGN-PILOT.md`)
> **Mandate**: Make Aether easy for humans to understand. **No new audits.**
> **Hard constraint**: Do NOT touch core, sync, FEFO, HPP, or consumption engine.

---

## 0. Reading Order

This document follows the agreed sequence:

1. Outlet Business Configuration
2. User Role
3. User Intent
4. First-Time Journey
5. Daily Operational Journey
6. Navigation
7. Page Guidance
8. System Feedback
9. (Pilot) POS Redesign Principles

Each section ends with **"Design Implications"** — concrete rules the redesign must obey.

---

## 1. Outlet Business Configuration

### 1.1 What Aether actually is (one paragraph)

Aether is a **point-of-sale and inventory platform** for Indonesian small-to-medium businesses. It is **single-tenant per outlet** at the Starter tier (internal code: `FREE` — see §1.4 for the branding decision) and **multi-outlet per group** at Pro/Enterprise. The unit of work is **one outlet** doing four things every day: **sell, restock, count, and review**. Every feature in the app must trace back to one of those four verbs.

### 1.2 The four operational verbs

| Verb | What it means | Where it lives in the app |
|------|---------------|---------------------------|
| **Jual (Sell)** | Take money from a customer in exchange for goods | POS → Transaction |
| **Beli (Restock)** | Menerima barang, bahan, material, spare part, packaging, atau consumable ke inventory outlet | Purchase → InventoryBatch |
| **Hitung (Count)** | Verify what is actually on the shelf vs what the system thinks | Stock Opname → InventoryBatch adjustment |
| **Lihat (Review)** | Understand what happened and decide what to do next | Dashboard, Reports, Audit Log, Insights |

> Every menu item, every modal, every empty state must answer: **which verb is this helping with?** If none — cut it.

### 1.3 Outlet Business Configuration (3-layer model — NOT yet implemented; proposed)

Today Aether is industry-agnostic at the schema level: every outlet has the same fields. The v1.1 draft of this blueprint proposed "industry modes" that bundled vocabulary + feature set + cadence into one preset per industry. Founder review flagged four problems with that approach (see §1.3.7 for the full critique), and this v1.3 revision replaces it with a **three-layer model** that decouples what users *call things* from what modules *are active* from what they *configure later*.

The entire model is called **Outlet Business Configuration**, composed of three sub-layers:

```
Outlet Business Configuration
├── 1. Industry Preset          (vocabulary — cosmetic)
├── 2. Operational Capabilities (modules — functional)
└── 3. Outlet Settings          (runtime — operational)
```

#### 1.3.1 The three layers

| Layer | What it does | What it controls | Changeable? |
|-------|--------------|------------------|-------------|
| **1. Industry Preset** | Vocabulary + initial recommendations | UI labels (Product/Menu/Layanan, Stock/Bahan/Material, Pelanggan/Klien), suggested cadences, dashboard card emphasis | Yes, anytime — only labels shift, no data loss |
| **2. Operational Capabilities** | Which modules and workflows are active in the cockpit | Sidebar items visible, dashboard cards rendered | Yes, anytime — turning off hides module, data preserved |
| **3. Outlet Settings** | Runtime settings within active modules | Payment methods, promo rules, crew permissions, theme, etc. | Yes, anytime — already changeable today in Settings |

**Key principle**: Layer 1 (preset) is cosmetic. Layer 2 (capabilities) is functional. Layer 3 (settings) is operational. **A business can pick any preset and turn on any combination of capabilities** — the preset does NOT lock the capability set.

**Critical security note — capability visibility ≠ authorization.**
Capability OFF means a module is hidden from the cockpit UI. It does **NOT** mean:
- The API routes are automatically forbidden (server authorization stands alone, gated by role + plan + outlet scope + historical data access)
- The data is deleted (data is preserved; re-enabling restores full visibility)
- The user cannot access the resource by any means (server-side checks remain authoritative)

UI hidden ≠ security. Capability OFF ≠ data deleted. Server authorization is the single source of truth for access control; capabilities only control cockpit presentation.

#### 1.3.2 Layer 1 — Industry presets (vocabulary)

Presets are **vocabulary lenses**, not exclusive categories. They can **overlap**: a coffee shop that also sells packaged beans is F&B + Retail; a print shop that also does design services is Percetakan + Jasa. The user picks the preset whose vocabulary fits best; the system never forces exclusivity.

| Preset | Who it's for | Product term | Stock term | Customer term |
|--------|--------------|--------------|-----------|---------------|
| **F&B** | Coffee shops, milk bars, warung makan, bakeries, resto | Menu | Bahan | Pelanggan |
| **Retail / Minimarket** | Minimarkets, toko sembako, butik, toko elektronik, toko kelontong | Produk | Stok | Pelanggan |
| **Jasa / Service** | Barbershop, salon (jasa), laundry (jasa cuci), bengkel, klinik, les | Layanan | (off by default) | Klien |
| **Produksi / Manufaktur** | Manufaktur kecil, produksi makanan, konveksi, kerajinan | Produk Jadi | Material | Pelanggan |
| **Percetakan** | Percetakan, sablon, undangan, banner | Produk / Pesanan | Material | Pelanggan |
| **Hybrid (default)** | Most SMBs that don't fit one box, or unsure | Produk | Stok | Pelanggan |

Notes:
- **"Pelanggan" is the default customer term** for all material/produksi/cetakan presets because these businesses can be B2C or B2B. "Tetap" (regular) is a relationship status, not an entity name, and was dropped per founder review.
- **"Output" was rejected** as too abstract for manufaktur/percetakan. Sub-preset vocabulary (Menu / Produk Jadi / Pesanan) is more natural.
- **`materialSubtype` is deferred** — not part of v1. Workshop, laundry, and beauty sub-vocabulary may be introduced as a **future vocabulary extension** if real merchant validation proves that preset-level terminology is insufficient. Do not design schema around unvalidated industries.

#### 1.3.3 Layer 2 — Operational capabilities (what's active)

Capabilities are **independent of preset**. Each capability is a yes/no toggle. Some are plan-gated. The user answers 5 onboarding questions (see §1.3.4) to set initial capability state; all are changeable later in Settings.

| Capability | Activates modules | Activation trigger | Plan gate |
|------------|-------------------|--------------------|-----------| 
| **Sell** (always on) | POS, Transactions, Pelanggan | Default active | — |
| **Manage Stock** | Products (stock fields), Inventory, Stock Opname | Onboarding Q1: "Apakah Anda mengelola stok?" | — |
| **Use Material** | Recipe/BOM (future), material vocabulary on Products | Onboarding Q2: "Apakah produk memakai bahan/material?" | — |
| **Purchase** | Pembelian, Suppliers | Onboarding Q3: "Apakah Anda melakukan pembelian?" | — |
| **Multi-Location** | Transfer, Multi-Outlet | Onboarding Q4: "Apakah Anda memiliki lebih dari satu lokasi?" | Pro+ |
| **Expiry-Sensitive** | Freshness/FEFO, Waste Report | Onboarding Q5: "Apakah barang memiliki expiry?" | — |
| **Insights/AI** | Insights, Forecasting | Available to all; full features Pro+ | Pro+ for full |

**Critical decoupling — FEFO is NOT tied to any preset.** It activates when the **Expiry-Sensitive** capability is on, regardless of preset. A minimarket selling food (Retail preset + Expiry-Sensitive capability) gets FEFO. A print shop (Percetakan preset, no Expiry-Sensitive) does not. An apotek (Retail preset + Expiry-Sensitive) gets FEFO. A manufaktur logam (Produksi preset, no Expiry-Sensitive) does not. This fixes the v1.1 fallacy where FEFO was bundled into Material-Based mode.

**Transfer is NOT "rare for Material-Based".** It activates when the **Multi-Location** capability is on, regardless of preset. A manufacturer with gudang bahan baku + area produksi + gudang barang jadi + multiple outlets (Produksi preset + Multi-Location) uses Transfer heavily. A single-outlet coffee shop (F&B preset, no Multi-Location) doesn't see Transfer at all.

**Capability dependencies.** Capabilities are not all fully independent — some have prerequisites because they rely on inventory being tracked:

| Capability | Requires | Why |
|------------|----------|-----|
| **Use Material** | Manage Stock | Material consumed must be recorded as inventory to track consumption and waste |
| **Expiry-Sensitive** | Manage Stock | FEFO/batch tracking requires inventory batches to exist |
| **Stock Transfer** | Manage Stock + Multi-Location | Transferring stock between locations requires both inventory tracking and multiple locations |
| **Purchase** (inventory-receiving) | Manage Stock | Receiving goods into inventory requires inventory tracking. (Future: expense-only procurement may exist without Manage Stock, but that feature does not exist today — do not promise it.) |

**Auto-enable behavior (v1 simplicity).** When a user turns on **Use Material** or **Expiry-Sensitive** during onboarding or in Settings, **Manage Stock automatically turns on** with a brief explanation: *"Mengelola material/expiry otomatis mengaktifkan Manajemen Stok."* The user can see the dependency but doesn't have to navigate it manually. Turning off Manage Stock while a dependent capability is on shows a warning: *"Matikan dulu Use Material dan Expiry-Sensitive untuk mematikan Manajemen Stok."*

**Purchase is inventory-oriented for now.** The current Purchase module receives goods into InventoryBatch. Do not frame it as general expense procurement — that feature does not exist. If a Jasa/Service business (no Manage Stock) wants Purchase, they currently cannot use it meaningfully. This is a known gap; future expense-procurement is out of scope for v1.

#### 1.3.4 Layer 2 default — Hybrid adaptive onboarding

The default path (Hybrid preset) is **NOT "all modules on"**. That was the v1.1 blind spot — a new user who picked Hybrid got the most complex cockpit. The v1.3 revision replaces it with **adaptive setup**: core modules on by default, additional capabilities gated by 5 onboarding questions.

**Default active (always on, no question):**
- ✓ POS
- ✓ Produk
- ✓ Transaksi
- ✓ Pelanggan

**Onboarding questions (each toggles a capability):**
1. □ Apakah Anda mengelola stok? → toggles **Manage Stock** (activates Inventory, Stock Opname)
2. □ Apakah produk memakai bahan/material? → toggles **Use Material** (activates Recipe/BOM future, material vocab)
3. □ Apakah Anda melakukan pembelian? → toggles **Purchase** (activates Pembelian, Suppliers)
4. □ Apakah Anda memiliki lebih dari satu lokasi? → toggles **Multi-Location** (activates Transfer, Multi-Outlet; Pro+ required)
5. □ Apakah barang memiliki expiry? → toggles **Expiry-Sensitive** (activates Freshness/FEFO, Waste Report)

A user who answers "no" to all 5 gets a clean cockpit: POS + Produk + Transaksi + Pelanggan. That's a service business or a simple reseller. A user who answers "yes" to all 5 gets the full operational suite. Most users land somewhere in between — and that's the point.

#### 1.3.5 Suggested cadences (recommendations, NOT preset locks)

The v1.1 draft hardcoded "Retail → weekly opname" and "Material-Based → monthly opname". That was wrong. Opname frequency depends on the business, not the preset. The v1.3 revision makes cadence a **suggestion shown at onboarding**, editable anytime, never enforced.

| Preset / Context | Suggested Stock Opname cadence |
|------------------|-------------------------------|
| Retail (small, low SKU count) | weekly or monthly |
| Retail (minimarket, high turnover) | weekly |
| F&B (perishable bahan) | daily for sensitive bahan, weekly for dry goods |
| Produksi / Manufaktur | cycle count weekly, full count monthly |
| Percetakan | monthly (material usually non-perishable) |
| Jasa / Service | not applicable (no stock by default) |

These are **defaults the user can override**. A coffee shop that wants daily opname for all bahan can set it. A retail toko that wants quarterly opname can set it. The system never locks cadence to preset.

#### 1.3.6 Preset overlap — handled by capabilities, not secondary presets

A business is not forced into one preset, but **v1 does NOT model a secondary preset**. That would add data-model complexity without direct benefit. Instead, the user picks **one primary preset** for vocabulary, and **capabilities bridge any overlap**.

| Business | Primary preset | Capabilities turned on | How overlap is handled |
|----------|---------------|------------------------|----------------------|
| Coffee shop selling packaged beans | F&B | Sell, Manage Stock, Purchase, Expiry-Sensitive | F&B vocab ("Menu", "Bahan") covers both; packaged beans are just products with stock |
| Print shop + design services | Percetakan | Sell, Manage Stock, Purchase, Use Material | Percetakan vocab ("Pesanan", "Material") covers both; design is a service-type product |
| Salon + retail products | Jasa | Sell, Manage Stock, Purchase, Expiry-Sensitive (for cosmetics) | Jasa vocab ("Layanan", "Klien") covers services; retail products use generic "Produk" |
| Manufaktur + retail outlet | Produksi | Sell, Manage Stock, Purchase, Use Material, Multi-Location | Produksi vocab ("Produk Jadi", "Material") covers both; retail is just another outlet |

**The user picks ONE primary preset** (drives vocabulary). Capabilities are set independently via the 5 onboarding questions. **Preset overlap never unlocks a capability by itself** — capabilities are always explicit toggles. If a business finds that preset-level vocabulary is insufficient for their overlap case, per-product label override (future) can bridge the gap. **No `secondaryPreset` field in v1.**

#### 1.3.7 Why the 3-layer model (critique of v1.1)

The v1.1 draft bundled preset + capability + cadence into one row per industry. Founder review flagged four problems:

1. **FEFO ≠ Material-Based.** Percetakan usually doesn't need FEFO. Manufaktur logam doesn't. But minimarket makanan and apotek DO need FEFO — and they're Retail, not Material-Based. FEFO is an **expiry capability**, not an industry trait. → Decoupled into Expiry-Sensitive capability (§1.3.3).
2. **Transfer ≠ "rare for Material-Based".** Manufaktur with gudang bahan baku + area produksi + gudang barang jadi + multiple outlets uses Transfer heavily. Marking it "rare" was wrong. → Transfer is now a Multi-Location capability, independent of preset.
3. **Opname cadence ≠ preset-locked.** Coffee shops opname daily for sensitive bahan. Manufaktur does cycle count weekly. Retail kecil does monthly. Hardcoding "weekly" or "monthly" to a preset ignores operational reality. → Cadence is now a suggestion (§1.3.5), user-editable.
4. **Hybrid "all modules" = overwhelming.** A new user picking Hybrid (the default) got every module visible — the most complex cockpit, for the least-decided user. That's backwards. → Hybrid is now adaptive: core 4 modules on, 5 questions toggle the rest (§1.3.4).

Plus two terminology fixes:
5. **"Tetap" dropped.** "Tetap" (regular) is a relationship status, not an entity name. Material-based businesses can be B2C or B2B, so "Pelanggan" stays as the default customer term. Jasa uses "Klien".
6. **"Output" dropped.** Too abstract for manufaktur/percetakan. Replaced with sub-preset vocabulary: "Produk Jadi" (manufaktur), "Produk/Pesanan" (percetakan), "Menu" (F&B).

#### 1.3.8 Design implications

- **Outlet must persist industry preset and operational capabilities.** The exact Prisma representation (JSON field, typed columns, or a configuration relation table) will be decided in a separate **Outlet Configuration Contract** document — the blueprint does not prescribe Prisma types. What matters is the **behavior**: the outlet stores its preset + capability state, and the UI reads that state to determine cockpit composition.
- For v1, two pieces of state are required:
  - `industryPreset`: one of `'fnb' | 'retail' | 'service' | 'produksi' | 'percetakan' | 'hybrid'` (defaults to `'hybrid'`)
  - `capabilities`: the set of active operational capabilities (Sell always on; Manage Stock, Use Material, Purchase, Multi-Location, Expiry-Sensitive toggleable; Insights/AI plan-gated)
- **`materialSubtype` is NOT part of v1** — deferred to future vocabulary extension (see §1.3.2 notes).
- **No `secondaryPreset`** — v1 uses single primary preset + capabilities to handle overlap (see §1.3.6).
- **Capabilities are the single source of truth** for "which modules show in sidebar" and "which dashboard cards render". Preset never hides a module — only capabilities do. But capability visibility is **cockpit-only** — server authorization stands alone (see §1.3.1 security note).
- **Preset only changes**: (a) UI labels (Product/Menu/Layanan etc.), (b) suggested opname cadence default, (c) dashboard card ordering/emphasis, (d) empty-state copy.
- All three layers are **reversible** — changing preset, toggling capability, or editing settings never deletes data. Hidden modules preserve their data; re-enabling restores visibility.
- The migration to introduce this 3-layer model is **out-of-scope** for the POS pilot. The pilot will use current behavior (all modules visible, no capability gating). 3-layer work comes after the pilot proves out the design language.

### 1.4 Plan tiers (already implemented — for context)

#### 1.4.1 The three tiers

| Tier (display) | Internal code | Price | Limits | Who it's for |
|----------------|---------------|-------|--------|--------------|
| **Starter** | `FREE` | Rp 0 | 50 produk, 5 kategori, 2 crew, 100 pelanggan, 500 transaksi/bln, 1 outlet | Bisnis yang baru mulai menggunakan Aether (see §1.4.3 for full positioning) |
| **Pro** | `PRO` | paid | Unlimited most things, 5 outlets, AI insights + forecasting | Growing chain / serious single-outlet |
| **Enterprise** | `ENTERPRISE` | paid | Same as Pro + unlimited outlets + larger bulk uploads | Multi-outlet groups, franchises |

#### 1.4.2 The Starter decision (UX/branding only — entitlements unchanged)

**Decision**: The entry plan is renamed from "Free" to **"Starter"** in all user-facing surfaces. This is a **commercial/branding rename only**.

- **Internal code stays `FREE`** — do NOT rename the enum, the `accountType` column, the `PLANS.free` config key, the `getPlanFeatures('free')` calls, the database rows, or any migration. The string `'free'` continues to flow through every entitlement check, every limit gate, every ProGate component.
- **Display label becomes "Starter"** everywhere a user reads it: Plan & Pricing page, sidebar footer chip, onboarding plan picker, upgrade prompts, limit warnings, marketing site.
- Implementation: a single helper `getPlanLabel(accountType)` already exists in `src/lib/config/plan-config.ts` and already returns the display string. **Only that helper's `free` case changes** from `return 'Free'` to `return 'Starter'`. Everywhere else in the codebase calls `getPlanLabel(...)` and inherits the rename automatically. Zero logic changes, zero migration, zero entitlement change.
- **Scope guard**: This rename does **NOT** change any entitlement, limit, feature flag, or plan-tier logic unless separately approved in a future decision. Starter = same limits as the old Free plan, same ProGate behavior, same upgrade flow.

#### 1.4.3 Starter positioning

> **Starter** — Untuk bisnis yang baru mulai menggunakan Aether.

Cocok untuk:
- Satu outlet
- Operasional dasar
- Penjualan
- Produk
- Pelanggan
- Stok sederhana

The word "Free" sounded like a limited trial. "Starter" sounds like a real starting package — the first step in an operational journey, not a giveaway. The price can stay Rp 0; the framing is what changes.

#### 1.4.4 Preset/Capability × Tier orthogonality

> Plan tier is orthogonal to outlet business configuration. A Starter (FREE) F&B-preset outlet with Expiry-Sensitive capability and a Pro Retail-preset outlet without it both exist; the tier gates capacity, the preset gates vocabulary, the capability gates which modules are active in the cockpit.

**Design Implications**:
- Never blame the user for hitting a plan limit — show the limit **before** they hit it (e.g., "Produk 48/50 — tambah 2 lagi untuk mencapai batas Starter").
- Upgrade prompts are always one click away from a limit, never modal-blocking the user's flow.
- Plan-gated features are visually distinct (ProGate blur + lock icon) but **never** silently disabled — the user must always know the feature exists.
- When showing the current plan in UI, always use the display label ("Starter"), never the internal code ("FREE"). The only place `FREE` should appear is in code, logs, and DB rows — never in a user-visible string.

---

## 2. User Role

### 2.1 The two roles Aether actually has

Aether has exactly **two roles** at the data level (`User.role`): `OWNER` and `CREW`. There is no Manager, no Admin, no Super-Admin at the application layer. (The `webmaster` tier is platform-internal, uses `COMMAND_SECRET`, and is NOT a user-facing role.)

| Role | Sees | Cannot see | Auth comes from |
|------|------|-----------|----------------|
| **OWNER** | Every page, every setting, every financial figure | (nothing) | NextAuth credentials, marked `OWNER` at signup |
| **CREW** | Only pages the owner explicitly grants via `CrewPermission.pages` (CSV: `pos,dashboard,...`) | Owner-only pages: Pengaturan, Plan & Pricing, Kelola Crew, Multi-Outlet | Owner creates crew account; permissions editable from "Kelola Crew" |

### 2.2 Role reality check (from HC observations)

- **OWNER** is usually the founder or their family member. They have 30 minutes a day to review the business and 5 hours a week to manage it. They care about: **money in, stock accuracy, crew trustworthiness**.
- **CREW** is usually a kasir (cashier) or gudang (stock clerk). They have one job per shift: **sell** or **restock**. They care about: **speed, no errors, no angry customers**. They do NOT care about dashboards, forecasts, or plan tiers.
- The biggest UX risk is **treating Crew like a mini-Owner** — showing them financial figures they can't act on, or settings they can't change. The redesign must aggressively narrow Crew's view to their job.

### 2.3 Role-based defaults

| Setting | OWNER default | CREW default |
|---------|---------------|--------------|
| Landing page after login | Dashboard | POS (or their first granted page) |
| Sidebar sections visible | All 3 (Utama, Operasional, Manajemen) | Only granted pages, grouped under "Pekerjaan Saya" |
| Financial figures (HPP, profit, margin) | Visible | Hidden — Crew only sees price and stock |
| Audit log access | Yes | No (always) |
| Plan & Pricing | Yes | No (always) |
| Crew management | Yes | No (always) |
| Settings (outlet name, theme, payments, promos) | Yes | No (always) |
| Customer delete | Yes | No (Crew can add, cannot delete) |
| Void transaction | Yes | Configurable per outlet (default: no) |

**Design Implications**:
- Crew's sidebar is **one section** called "Pekerjaan Saya" — not three. No "Manajemen" section. No "Operasional" section. Just the pages they were granted.
- Crew's POS shows **price + stock + product name** only. No HPP, no profit, no margin. (Today this is already true in POS — preserve it.)
- Crew's dashboard (if granted) shows **today's transaction count, today's revenue, low-stock alerts** — NOT profit, NOT forecasts, NOT plan usage.
- The redesign must add a **role-awareness** check to every dashboard card, every sidebar item, every empty state. If the user is Crew and the content is Owner-only, the content is omitted — never blurred, never "locked", just not rendered.

---

## 3. User Intent

### 3.1 The seven intents Aether must serve

Users come to Aether with one of seven intents. Every page should map to exactly one primary intent; pages that try to serve more than one become confusing.

| # | Intent | Example trigger | Primary page | Secondary pages |
|---|--------|----------------|--------------|-----------------|
| 1 | **"Saya mau jual"** | Customer walks in / order placed | POS | (none — POS is the entire flow) |
| 2 | **"Saya mau tahu stok"** | Owner wonders "is item X running low?" | Products (search) | Purchase, Stock Opname |
| 3 | **"Saya mau beli bahan/barang"** | Supplier delivery arrives / owner places order | Purchase (create PO → receive) | Products, Suppliers |
| 4 | **"Saya mau hitung"** | End-of-month physical count | Stock Opname | Inventory Movement |
| 5 | **"Saya mau lihat hasil"** | Morning review, weekly review, monthly review | Dashboard | Transactions, Audit Log, Insights |
| 6 | **"Saya mau atur"** | Change payment methods, add promo, add crew, change theme | Settings | Crew, Plan |
| 7 | **"Saya mau pindah barang"** | Stock transfer between branches (Pro+ only) | Transfer | Multi-Outlet |

### 3.2 Intent → first-screen mapping

When the user logs in, **where they land should depend on their last intent**, not always on a fixed default.

| Role | Default landing | Override rule |
|------|-----------------|---------------|
| OWNER | Dashboard | If last action was POS checkout within 4 hours → land on POS (continue shift) |
| CREW | Their first granted page | If their first granted page is POS → land on POS directly |

> Today both roles land on Dashboard. This is wrong for Crew (they bounce to POS anyway) and forgetful for Owner (they lose context). The redesign should track `lastIntent` in localStorage and use it to route landing.

### 3.3 Anti-intents (what users DON'T want)

These are flows users get dragged into today that the redesign must eliminate:

- **"I just want to add one product"** → today requires navigating to Products → clicking "Tambah" → filling 8 fields. The redesign should allow adding a product **from the POS** when a barcode scan returns no match (intent 1 interrupted by intent 2 sub-task).
- **"I just want to void one transaction"** → today requires Audit Log → find → void. The redesign should allow void from the Transactions page directly (where the user is already looking at the transaction).
- **"I just want to know what sold today"** → today requires Dashboard → wait for chart → switch tab. The redesign should show today's top 5 items as the **first card** on Dashboard, not the third.
- **"I just want to know what's expiring"** → today requires Inventory → Freshness → wait for heatmap. The redesign should show "expiring this week" count as a Dashboard badge.

**Design Implications**:
- The redesign introduces a **"quick action"** concept that lets the user complete a small intent without leaving their current page. (Today's `quick-actions.tsx` already does this for Dashboard → POS; extend the pattern.)
- Every list view should have **inline actions** (void, edit, restock, delete) — no "go to detail page first" detours.
- The number of clicks to complete any of the 7 intents should be: **Jual (3), Lihat Stok (1), Beli (4), Hitung (3), Lihat Hasil (1), Atur (2), Pindah (3)**. Anything beyond that is waste.

---

## 4. First-Time Journey

### 4.1 The cold-start problem

Today, a brand-new Starter (FREE) outlet signs up and sees an empty Dashboard with zero context. They have to figure out: (a) add products, (b) configure payments, (c) try POS, (d) come back to Dashboard. Most don't. The redesign must **shepherd** the first 10 minutes.

### 4.2 The 4-step first-time journey (proposed)

| Step | Screen | What user does | What Aether shows |
|------|--------|---------------|-------------------|
| **1. Perkenalan** | Onboarding modal (post-signup) | Pick industry preset, pick plan (Starter default, internal: FREE), enter outlet name, answer 5 capability questions | Founder quote, 6-preset picker (F&B / Retail / Jasa / Produksi / Percetakan / Hybrid), 5 capability toggles (see §1.3.4), outlet name input |
| **2. Isi Produk Pertama** | Guided Products empty state | Add 1–3 products (or import Excel if Pro+) | Big friendly "Tambah Produk Pertama" CTA, shortcut to barcode-scan-and-add |
| **3. Coba POS Sekali** | POS with a hint bubble | Add the product to cart, click "Bayar", pick CASH, done | Tooltip: "Klik produk → lihat keranjang → Bayar". Confetti on first successful checkout |
| **4. Lihat Dashboard** | Dashboard with first data | See today's 1 transaction, today's revenue, freshness score | Empty-state replaced with "1 transaksi pertama Anda" card |

After step 4, the user is "warm" — they have data, they understand the loop, and the Dashboard starts being useful.

### 4.3 What the first-time journey must NOT do

- **No 12-field product form on first product.** Reduce to 3 fields: Nama, Harga, Stok. HPP and category can come later.
- **No "configure your payment methods" wall.** CASH is always available by default; QRIS/DEBIT are opt-in from Settings.
- **No "invite your crew" prompt during onboarding.** Crew setup is available in Starter within its current limit (2 crew), but should be suggested only after the owner has completed the first operational loop (first sale + first product added), not before. Crew is NOT a Pro-tier-only concern — Starter users can add crew — but crew setup is premature during first-time onboarding.
- **No forced tour with next/prev buttons.** Hints should be contextual (one bubble at a time), dismissable, and never block the UI.

**Design Implications**:
- Build an `OnboardingProgress` tracker (localStorage, keyed by outletId): `{ pickedPreset, addedFirstProduct, completedFirstSale, viewedDashboard }`. Show progress as a thin top banner that disappears when all 4 are done.
- Empty states must **never be silent**. Every empty state has: (a) what's missing, (b) why it matters, (c) one button to fix it.
- The 4-step journey is **skippable** but **not dismissable forever** — if the user skips, the progress banner stays until they complete step 2 (add product) at minimum.

---

## 5. Daily Operational Journey

### 5.1 The Owner's day

| Time | What they do | In Aether |
|------|--------------|-----------|
| 07:00 (open) | Review last night, check today's plan | Dashboard (today's revenue target, low-stock alerts, expiring items) |
| 09:00 (mid-morning) | Restock if needed | Purchase (create PO, receive goods, inventory updates) |
| 12:00 (lunch rush) | Watch transactions live | Transactions (live filter: today) |
| 17:00 (afternoon) | Spot-check crew | Audit Log (filter: today, by crew) |
| 21:00 (close) | Review the day | Dashboard (today's summary), Insights (top items, forecast) |
| Weekly Sunday | Plan next week | Insights (forecast), Reports (Excel export), Promos (set up weekly promo) |

### 5.2 The Crew's day

| Time | What they do | In Aether |
|------|--------------|-----------|
| 07:00 (shift start) | Log in, land on POS | POS (clean state, today's date, outlet name visible) |
| 07:00–21:00 | Sell, sell, sell | POS (cart, payment, receipt) |
| (rare) | Customer wants to know points | Customers (search by phone) |
| (rare) | Item not in system | Quick-add product inline (if permitted) |
| 21:00 (shift end) | Log out | (no other screen needed) |

### 5.3 The weekly and monthly loops

| Loop | Trigger | Primary action |
|------|---------|---------------|
| **Weekly stock count** | Sunday evening | Stock Opname (count → review → finalize) |
| **Weekly promo review** | Sunday evening | Promos (check active, deactivate stale) |
| **Monthly P&L review** | 1st of month | Dashboard → Laba & Rugi tab, Reports export |
| **Monthly freshness audit** | 1st of month | Inventory → Freshness heatmap, Waste Report |
| **Quarterly plan review** | Every 3 months | Plan & Pricing (upgrade if hitting limits) |

**Design Implications**:
- Dashboard must distinguish **"today" view** (default on entry) from **"review" view** (period selectable). Today = operational, Review = analytical. Don't mix them.
- The weekly/monthly loops should be **prompted, not enforced**. A non-intrusive banner: "Sudah akhir minggu — mau mulai Stock Opname mingguan?" with a "Mulai" button and a "Nanti" dismiss.
- Crew should NEVER see weekly/monthly prompts — those are Owner intents.

---

## 6. Navigation

### 6.1 Today's navigation (sidebar)

The sidebar today groups 13 pages into 3 sections:

| Section | Pages |
|---------|-------|
| **Utama** | Dashboard, Produk, Pelanggan |
| **Operasional** | POS, Transaksi, Pembelian & Inventori, Stock Opname (if inventory), Kirim Stock/Barang (if group) |
| **Manajemen** | Audit Log, Pengaturan, Kelola Crew, Plan & Pricing, Multi Outlet (if group) |

### 6.2 Problems with today's navigation

1. **3 sections is too many for Crew.** Crew sees their granted pages scattered across 3 sections — feels arbitrary.
2. **"Pembelian & Inventori" is two concepts merged.** Pembelian = beli bahan. Inventori = lihat stok + movement + freshness + waste. They should split.
3. **"Manajemen" mixes owner-config (Pengaturan, Crew, Plan) with audit (Audit Log) with admin (Multi-Outlet).** Audit Log is operational review, not management config.
4. **No "Pekerjaan Saya" concept.** The user's most-used pages aren't surfaced above the fold.
5. **Mobile bottom-nav has 5 items** but doesn't adapt to role or mode. Crew sees icons they can't tap.

### 6.3 Proposed navigation restructure (for the redesign)

**OWNER sidebar (4 sections, clearer names):**

```
PEKERJAAN SAYA          (auto-pinned: top 3 most-used by this user)
  - POS
  - Dashboard
  - Produk

JUAL & BELI
  - POS (Kasir)
  - Transaksi
  - Pembelian Bahan/Barang
  - Stock Opname
  - Kirim Stock/Barang     (if group)

STOK & LAPORAN
  - Inventaris (stok, movement, freshness, waste — one page, tabs)
  - Audit Log
  - Insights (AI, forecasting — Pro+)

PENGATURAN
  - Pengaturan Outlet
  - Kelola Crew
  - Pelanggan (loyalty, points)
  - Plan & Pricing
  - Multi-Outlet            (if group)
```

**CREW sidebar (1 section, role-narrowed):**

```
PEKERJAAN Saya
  - POS                     (if granted)
  - Dashboard (lite)        (if granted)
  - Produk (view-only)      (if granted)
  - Pelanggan (search-only) (if granted)
  - Transaksi (own only)    (if granted)
```

> Crew's sidebar is **one section, no headers, no grouping**. They have 1–5 pages, full stop.

**Mobile bottom-nav:**
- OWNER: POS, Dashboard, Produk, Transaksi, More (overflow to full sidebar)
- CREW: POS, (their 2nd granted page), (their 3rd granted page), Profile. No "More" — Crew's nav is always visible.

### 6.4 Navigation rules

1. **Current page is always visible** in the sidebar (highlighted, persistent — never hidden by scroll).
2. **Sidebar collapses on mobile** to bottom-nav + hamburger for the full menu.
3. **No more than 3 clicks** to reach any page from any other page.
4. **Page-switching preserves context** where possible: switching from POS to Products and back should not lose the cart (today it doesn't — preserve this).
5. **Capability-aware ordering**: nav order is driven by **active capabilities**, not by preset. If **Purchase** capability is on, "Pembelian" appears under JUAL & BELI. If **Manage Stock** is on, "Stock Opname" appears. If **Multi-Location** is on, "Kirim Stock/Barang" appears. If **Expiry-Sensitive** is on, the Freshness tab appears inside Inventori. The order within a section is stable regardless of preset — preset only changes labels, not order. (This replaces the v1.1 "mode-aware ordering" rule that hardcoded order per mode.)

**Design Implications**:
- Navigation config moves from a hardcoded array in `sidebar.tsx` to a function `getNavFor({ role, preset, capabilities, plan, grantedPages })` that returns the tree. `preset` drives labels; `capabilities` drives which items appear; `role` + `grantedPages` drive Crew narrowing; `plan` drives Pro/Enterprise gating. This makes the rules testable and the sidebar deterministic.
- The "Pekerjaan Saya" section tracks usage in localStorage (last 7 days, weighted by recency). Top 3 most-visited pages get pinned.
- Crew's "Dashboard (lite)" is a new variant of the Dashboard page that filters out financial figures — same component, different props. (Implementation: pass `role` to `<DashboardPage>` and conditionally render cards.)

---

## 7. Page Guidance

### 7.1 The Page Guidance contract

Every page in Aether must answer 4 questions for the user, **within 2 seconds of load**:

1. **Where am I?** (page title, breadcrumb if nested)
2. **What can I do here?** (primary CTA, secondary actions)
3. **What's the state?** (data summary: count, total, freshness, status)
4. **What should I do next?** (insight, alert, or empty-state CTA)

### 7.2 Page-by-page guidance (the 13 existing pages)

| Page | Where am I? | What can I do? | What's the state? | What's next? |
|------|-------------|----------------|-------------------|--------------|
| **Dashboard** | "Dashboard — [outlet name]" | Quick actions: Buka Kasir, Tambah Produk, Beli Bahan | Today's revenue, txn count, freshness score | Top insight (e.g., "Kopi Susu hampir habis — restock?") |
| **Produk** | "Produk — [count] item" | Tambah Produk, Import Excel (Pro+), Cetak Barcode | Total produk, kategori count, low-stock count | "3 produk stok menipis" alert |
| **Pelanggan** | "Pelanggan — [count] orang" | Tambah Pelanggan, Cari (by WhatsApp) | Total pelanggan, total points outstanding | "5 pelanggan belum transaksi 30 hari" |
| **POS** | "Kasir — [outlet name] — [kasir name]" | Scan/click produk → Bayar | Cart total, item count, sync status | (none — POS is the action) |
| **Transaksi** | "Transaksi — [filter]" | Filter (today/week/month), Export Excel (Pro+), Void | Txn count, total revenue, voided count | "1 transaksi perlu review" (if pending void) |
| **Pembelian** | "Pembelian — [tab: PO/Diterima/Inventori]" | Buat PO, Terima Barang, Lihat Movement | Open POs, received today, total batches | "2 PO menunggu diterima" |
| **Inventori** | "Inventori — [tab: Stok/Movement/Freshness/Waste]" | Adjust stock, Export Waste Report | Total batches, expiring soon count, waste this month | "4 batch expiring <7 hari" |
| **Stock Opname** | "Stock Opname — [status: draft/review/final]" | Mulai Opname, Lanjutkan Draft, Finalize | Draft count, last opname date, variance total | "Opname terakhir 14 hari lalu — mulai baru?" |
| **Kirim Stock** | "Kirim Stock — [if group]" | Buat Transfer, Lacak Pengiriman | In-transit count, completed this month | "1 transfer in-transit" |
| **Audit Log** | "Audit Log — [filter]" | Filter (by user/action/page/date), Export | Total events today, void count, login count | (none — read-only review) |
| **Pengaturan** | "Pengaturan — [tab: Outlet/Pembayaran/Promo/Tampilan]" | Edit, Save | (per-tab summary) | "Promo aktif: 2" |
| **Kelola Crew** | "Kelola Crew — [count] orang" | Tambah Crew, Edit Permission, Hapus | Crew count, plan limit | "1 slot crew tersisa (Starter plan)" |
| **Plan & Pricing** | "Plan — [current tier]" | Upgrade, Lihat Usage | Usage bars (produk, kategori, crew, pelanggan, transaksi) | "Produk 48/50 — hampir batas Starter" |
| **Multi-Outlet** | "Multi-Outlet — [group name]" | Tambah Outlet, Switch Outlet | Outlet count, plan limit | (none) |
| **Insights** | "Insights — AI & Forecast" (Pro+) | Lihat insight, Lihat forecast | Health score, top 3 insights | "Health score 78 — 2 aksi rekomendasi" |

### 7.3 Empty-state guidance

Every empty state follows this template:

```
[Icon — large, preset-appropriate]

[Title — what's missing, in plain Indonesian]
  e.g., "Belum ada produk"

[Description — why it matters, 1 sentence]
  e.g., "Tambahkan produk pertama untuk mulai menjual di kasir."

[Primary CTA — one button]
  e.g., "Tambah Produk"

[Secondary CTA — text link, optional]
  e.g., "Atau import dari Excel →"
```

**Never**: "No data found." / "Empty." / "Tidak ada data." — these are hostile. Always explain and offer a path forward.

**Design Implications**:
- Create a `<PageHeader>` component that takes `{ title, state, primaryAction, secondaryAction, alert }` and renders the top of every page consistently.
- Create an `<EmptyState>` component that takes `{ icon, title, description, primaryCta, secondaryCta }` and is used everywhere.
- Audit all 13 pages and ensure they all use `<PageHeader>` and `<EmptyState>`. (This is the POS pilot's first deliverable — apply to POS, then propagate.)

---

## 8. System Feedback

### 8.1 The 5 feedback channels

Aether communicates with the user through 5 channels. Each has a specific job:

| Channel | Used for | Example | Implementation |
|---------|---------|---------|----------------|
| **Toast (ephemeral)** | Action confirmed/rejected | "Transaksi tersimpan" | `sonner` (already in use) |
| **Inline status** | Page state changes | "Sync: 3 transaksi pending" | Status pill in `<PageHeader>` |
| **Banner (page-top)** | Important, dismissable | "Sudah akhir minggu — Stock Opname?" | `<Banner>` component (to build) |
| **Modal (blocking)** | Destructive confirmation | "Void transaksi #123? Tidak bisa dibatalkan." | `<AlertDialog>` (shadcn) |
| **Empty state** | No data, here's why + what next | "Belum ada transaksi hari ini" | `<EmptyState>` |

### 8.2 Feedback rules

1. **Toasts auto-dismiss in 3s** for success, **5s** for warning, **never auto-dismiss** for error (user must close).
2. **Never more than 1 toast at a time**. If two actions succeed in quick succession, queue the second toast after the first dismisses.
3. **Banners never block** — they sit below the page header, push content down, and have a dismiss (X) button.
4. **Modals are only for irreversible actions**: void transaction, delete product, delete crew, downgrade plan. Everything else is inline.
5. **Loading states must show progress**, not just spinners. "Memuat 24 produk..." is better than a spinner. "Menyinkronkan 3 transaksi..." is better than "Loading..."
6. **Errors must be actionable.** Not "Something went wrong." But: "Gagal menyimpan produk — kolom 'Harga' kosong. Klik untuk perbaiki." with the field highlighted.
7. **Offline state is first-class.** When POS is offline, the entire header turns amber, a "OFFLINE — transaksi disimpan lokal" banner appears, and the sync icon pulses. Never let the user wonder "did my sale go through?"

### 8.3 The 4 system states every user must always know

| State | Where shown | How |
|-------|-------------|-----|
| **Am I online?** | POS header (top-right icon) | Green dot = online, Amber dot = offline |
| **Is my data synced?** | POS header (sync icon + count) | "Synced ✓" or "3 pending sync" |
| **Am I on the right outlet?** | Sidebar header + POS header | Outlet name visible in both places |
| **Am I close to a plan limit?** | Sidebar footer + Dashboard card | "Produk 48/50" with amber when >80% |

**Design Implications**:
- Build a `<SystemStatus>` component that shows online/offline + sync state + current outlet. Mount in both sidebar header and POS header.
- Plan-usage indicator moves from a hidden Plan page to a persistent sidebar footer chip.
- Every API failure surfaces a toast with the failed action's name + a "Coba lagi" button (where retry is safe).

---

## 9. POS Pilot Redesign — Principles

> This section defines the **scope and rules** for the POS redesign. It is NOT the redesign itself — the redesign happens in a separate doc once this blueprint is approved.

### 9.1 The pilot's one job

Make **"buka POS → pilih produk → bayar → selesai"** feel like one continuous motion, not 4 separate screens.

### 9.2 POS redesign hard constraints (CANNOT touch)

- **Core checkout API** (`/api/pos/checkout/route.ts`) — logic stays
- **Transaction sync** (`/api/transactions/sync/route.ts`) — logic stays
- **FEFO consumption** (inventory batch selection) — logic stays
- **HPP calculation** — logic stays
- **Offline IndexedDB layer** — logic stays
- **Payment method validation** — logic stays
- **Promo application logic** — logic stays

### 9.3 POS redesign CAN touch (pilot scope — narrowly defined)

The POS pilot is about **clarity of the existing flow**, not new features. The pilot may touch:

- **Layout** of the POS page (grid splits, panel sizes, responsive breakpoints)
- **Visual hierarchy** (what's prominent, what's secondary)
- **Product discovery** (search prominence, category chips, barcode-scan affordance)
- **Cart clarity** (add, edit qty, remove — gestures and shortcuts, visual state of the cart)
- **Payment clarity** (modal vs inline, success animation, receipt preview)
- **System status visibility** (online/offline, sync state, outlet name — where and how prominent)
- **Responsive behavior** (mobile/tablet/desktop breakpoints, bottom-nav integration)

That's it. The pilot does NOT add features. Ideas like quick-add product from POS, lastIntent routing, auto-pin sidebar, Dashboard Lite, or role-awareness checks are **future platform UX backlog** (see §9.6) — NOT part of this pilot unless separately scoped in a future decision.

### 9.4 POS redesign success criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| **Time to first item in cart** | From POS load → first product click | < 3 seconds |
| **Time to checkout** | From first item in cart → "Bayar" click | < 8 seconds (1-item sale) |
| **Time to complete sale** | From "Bayar" click → success state | < 2 seconds (online), < 1 second (offline) |
| **Error recovery** | From error toast → user knows what to do | 100% (every error is actionable) |
| **Offline transparency** | User always knows sync state | 100% (visual indicator never absent) |
| **Crew comprehension** | New crew can complete a sale with 0 training | 90% (tested with 5-min think-aloud) |

### 9.5 POS redesign anti-goals (what NOT to do)

- ❌ Do NOT add features (no loyalty redemption UI, no split payments, no table management) — pilot is about clarity, not features
- ❌ Do NOT redesign the receipt format — out of scope
- ❌ Do NOT change the data model — `Transaction`, `TransactionItem`, `InventoryBatch`, `LoyaltyLog` schemas stay as-is
- ❌ Do NOT introduce new dependencies — use existing shadcn/ui + Framer Motion + Zustand
- ❌ Do NOT touch mobile native gestures that work today (swipe-to-delete in cart stays)
- ❌ Do NOT include platform-wide UX features in the pilot (see §9.6 for the backlog list)

### 9.6 Future platform UX backlog — NOT part of POS pilot

The following ideas appear elsewhere in this blueprint (§3.3, §4, §6) as **platform-level UX improvements**. They are valuable, but they are **NOT part of the POS pilot** unless separately scoped in a future decision. The POS pilot stays narrowly focused on §9.3.

| Idea | Where it appears in blueprint | Why it's deferred from pilot |
|------|-------------------------------|------------------------------|
| **Quick-add product from POS** (barcode scan returns no match → inline product create) | §3.3 anti-intents, §5.2 Crew day | Adds a feature (inline product form inside POS); pilot is clarity-only |
| **lastIntent routing** (land on POS if last action was checkout within 4h) | §3.2 intent → first-screen mapping | Platform-level routing logic; not POS-page-specific |
| **Auto-pin "Pekerjaan Saya"** (top 3 most-used pages) | §6.3 nav restructure, §6.4 design implications | Platform-level nav feature; not POS-page-specific |
| **Dashboard Lite for Crew** (filtered dashboard variant) | §2.3 role defaults, §6.3 Crew sidebar | Platform-level dashboard feature; not POS-page-specific |
| **Role-awareness check** on every card/sidebar/empty-state | §2.3 design implications | Platform-wide architecture change; not POS-page-specific |
| **OnboardingProgress tracker** (4-step banner) | §4.2 design implications | Platform-level onboarding feature; not POS-page-specific |

These items belong in a **Platform UX Roadmap** doc (future), not in the POS pilot. The POS pilot proves the design language on one page (POS); platform-wide features propagate after the pilot succeeds.

### 9.7 POS redesign deliverables (separate doc, post-approval)

1. POS Information Architecture diagram
2. POS Component tree (existing → proposed diff)
3. POS Interaction spec (every click, every keyboard shortcut, every state transition)
4. POS Visual spec (colors, spacing, typography — using existing Tailwind tokens)
5. POS Accessibility spec (keyboard nav, screen-reader labels, focus order)
6. POS Pilot implementation plan (file-by-file changes, no core touched)

---

## 10. Glossary — Indonesian terms used in this blueprint

| Term | English | Notes |
|------|---------|-------|
| Kasir | Cashier / POS station | Both the role and the screen |
| Crew | Staff | Aether-specific term, includes kasir + gudang |
| Pelanggan | Customer | Default term — used by F&B, Retail, Produksi, Percetakan, Hybrid presets. Material-based businesses can be B2C or B2B, so "Pelanggan" stays neutral. |
| Klien | Client | Jasa / Service preset term |
| Member | Member / loyalty member | Relationship status (not entity name) — used when describing loyalty program membership, regardless of preset |
| Produk | Product | Generic — Retail, Hybrid default |
| Menu | Menu item | F&B preset term |
| Produk Jadi | Finished good | Produksi / Manufaktur preset term |
| Pesanan | Order / job | Percetakan preset term (alternate to "Produk") |
| Layanan | Service | Jasa / Service preset term |
| Stok | Stock / inventory | Retail, Hybrid default |
| Bahan | Ingredient / raw material | F&B preset term |
| Material | Material / raw stock | Produksi, Percetakan preset term |
| Spare Part | Spare part | Future vocabulary extension (deferred — not in v1); would apply to workshop sub-preset if `materialSubtype` is introduced |
| Beli | Buy / purchase | |
| Jual | Sell | |
| Hitung | Count | As in stock opname |
| Lihat | Look / review | |
| Restock | Restock | Loanword, common in ID retail |
| Opname | Stock take | From Dutch "opname" |
| Pembelian | Purchase (noun) | |
| Pengaturan | Settings | |
| Pekerjaan Saya | My Work | Proposed nav section name |
| Void | Void | Loanword, common in ID POS |
| HPP | Harga Pokok Penjualan | COGS — cost of goods sold |
| FEFO | First-Expire-First-Out | Inventory consumption rule — activates when Expiry-Sensitive capability is on (NOT tied to any preset) |
| Freshness | Freshness score | Aether-specific: % of stock not expiring soon — shown only when Expiry-Sensitive capability is on |
| Capability | Operational toggle | Layer 2 of the 3-layer model — determines which modules are active, independent of preset |
| Preset | Industry vocabulary | Layer 1 of the 3-layer model — determines UI labels, not which modules are active |
| Sinkron / Sync | Sync | |

---

## 11. Open questions (deferred to blueprint review)

These are flagged for the founder/product review. They do NOT block the POS pilot.

1. **Should preset-switching be allowed after the outlet has data?** (Recommendation: yes, but warn that labels will change. Data never deletes. Capability toggles are independently reversible — hidden modules preserve data.)
2. **Should Crew see the customer's loyalty points balance?** (Recommendation: yes, but only at checkout — not in customer search list. Helps Crew upsell.)
3. **Should the "Pekerjaan Saya" auto-pin be based on clicks or time-spent?** (Recommendation: clicks, weighted by recency — simpler, less creepy.)
4. **Should the system suggest a preset based on the first 3 products added?** (Recommendation: no — too presumptuous. Let user pick at onboarding, change in Settings. But the system CAN suggest capability toggles based on behavior, e.g. "You added 5 products with expiry dates — enable Expiry-Sensitive?" with user opt-in.)
5. **Should Insights (AI) be available to Starter (FREE) users as a teaser?** (Recommendation: yes — show 1 insight read-only, blur the rest with ProGate. Drives upgrades.)
6. **Material sub-preset vocabulary — deferred to future.** v1 does NOT include `materialSubtype`. Workshop, laundry, and beauty sub-vocabulary will be introduced only if real merchant validation proves preset-level terminology is insufficient. (Decision: defer — do not design schema around unvalidated industries.)
7. **Starter rename — should the marketing site also drop "Free"?** (Recommendation: yes, but coordinate with founder. The app-side rename is safe and immediate; the marketing-site rename is a separate brand decision.)
8. **Capability toggles — reversible without data loss?** When a user turns off "Manage Stock" after having used Stock Opname, what happens to the historical opname data? (Recommendation: hide the module + preserve data. Re-enabling restores full history. Never auto-delete. This is already stated in §1.3.1 security note — confirmed as locked decision.)
9. **Onboarding capability questions — all 5 at once, or progressive?** Showing 5 questions on day 1 may overwhelm. Should we ask Q1-Q3 at signup and Q4-Q5 in a later "setup completion" prompt? (Recommendation: ask Q1-Q3 at signup (they're fundamental), defer Q4 (Multi-Location, plan-gated) and Q5 (Expiry) to first POS load or first product add, when context makes the question concrete.)
10. **Preset overlap — resolved.** v1 uses single primary preset + capabilities to handle overlap. No `secondaryPreset` field, no combined presets. Per-product label override (future) can bridge vocabulary gaps if they arise. (This was an open question in v1.2; v1.3 resolves it — see §1.3.6.)

---

## 12. Approval gate

This blueprint is **LOCKED v1.3** — founder-approved with the v1.3 conceptual cleanup (capability≠authorization, capability dependencies, no secondary preset, materialSubtype deferred, storage type deferred to Outlet Configuration Contract, layer 3 renamed to Outlet Settings, Beli verb clarified, Crew/Starter contradiction fixed, POS pilot scope narrowed, version/title consistency restored).

### 12.1 Locked decisions (founder-confirmed, v1.3)

The following 10 decisions are **locked** and cannot be re-opened without explicit founder approval:

1. **Aether is one platform, one core.** No industry-specific forks.
2. **Preset only controls vocabulary and recommendations.** It does not lock the feature set.
3. **Capabilities control which modules and workflows are active in the cockpit.**
4. **Presets are not exclusive to operational types.** A preset can overlap with another business type; capabilities bridge the gap.
5. **FEFO follows the Expiry-Sensitive capability**, not any industry preset.
6. **Transfer follows the Multi-Location capability**, not any industry preset.
7. **Hybrid uses guided setup** (core 4 + 5 capability questions), not "all modules on".
8. **"Starter" is the display label; internal code `FREE` stays unchanged.** Entitlements unchanged.
9. **Data is never deleted when a capability is turned off.** Hidden modules preserve data; re-enabling restores visibility.
10. **POS pilot does not touch core, sync, FEFO, HPP, or consumption engine.** Hard constraint, non-negotiable.

### 12.2 Sign-off checklist

- [x] **Founder (Ahtjong)**: 3-layer Outlet Business Configuration model (preset / capabilities / settings) + role defaults + first-time journey + Starter positioning + capability dependencies + POS pilot scope — **APPROVED v1.3**
- [ ] **Product (Z.ai)**: navigation restructure + page guidance contract + feedback rules + capability-gated module visibility — pending implementation planning
- [ ] **Engineering (Z.ai)**: confirm POS hard constraints are correct + draft Outlet Configuration Contract (Prisma representation of preset + capabilities) + identify any uncovered dependencies — pending

Once Product + Engineering sign off, the POS Pilot Redesign doc will be drafted as `docs/POS-REDESIGN-PILOT.md`, scoped strictly to Section 9 of this blueprint.

---

**End of AETHER_UX_BLUEPRINT v1.3 (LOCKED).**

> Next action: Product + Engineering sign-off on §12.2, then draft `docs/POS-REDESIGN-PILOT.md`.
> Platform state at time of writing: see `docs/CHECKPOINT-PHASE-0.5.md` — Phase 0.5 closed, 0 live P0/P1/P2.
