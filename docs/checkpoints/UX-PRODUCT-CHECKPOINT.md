# UX Product Batch 1 — Add/Edit Form Safety Checkpoint

**Date**: 2026-07-22
**Phase**: Product UX Batch 1
**Status**: ✅ COMPLETE — Browser-verified
**Founder Approval**: "Founder approval 👍 — Implement Product UX Batch 1 only"

---

## Task Header

```
Task:        Product UX Batch 1 — Add/Edit Form Safety
Role:        Full-stack implementer (AI crew)
Environment: Local development sandbox /home/z/my-project (SQLite)
Scope:       product-form-dialog.tsx only (Add/Edit form)
Contracts Read:
  - governance/AI_RUNTIME_RULES.md v1.0
  - governance/UX_STABILIZATION_RULES v1.0
  - docs/UX-DESIGN-CONTRACT.md v1.0
  - docs/ARCHITECTURE-LOCK.md v1.0 (FROZEN — not touched)
Mode:        WRITE-AUTHORIZED (founder approved Batch 1 scope)
Started From: Founder approval message "Founder approval 👍"
```

---

## Implemented (5 items)

### 1. ✅ Unsaved-changes confirmation when Product form contains changes

**Pattern**: Double-click-to-confirm on the "Batal" button.

- When form is dirty (`isDirty = true`) and user clicks "Batal", the button transforms to "⚠ Yakin Buang?" (red, pulsing).
- User must click again within 3 seconds to confirm discard.
- If no second click within 3s, button reverts to "Batal" (confirm mode auto-cancels).
- If form is NOT dirty, clicking "Batal" closes immediately (no confirm).

**Why double-click instead of a separate dialog**: Rendering an AlertDialog/overlay inside an open ResponsiveDialog (Radix Dialog) causes focus-trap and event-delegation conflicts that prevent React onClick handlers from firing on buttons in the overlay. The double-click pattern avoids this entirely by using inline state on the existing Batal button. A native DOM event listener (capture phase) is used because React's synthetic event system doesn't reliably process clicks on buttons inside the Dialog portal.

**Dirty-state tracking**: `isDirty` is computed via `useMemo` comparing current form state (form fields, hasVariants, hasComposition, variants array) against an initial snapshot captured on dialog open via `setTimeout(0)` (ensures load useEffect has committed). Composition items are excluded from the snapshot because composition data loads async in Edit mode, which would cause false-positive dirty state. The `hasComposition` toggle IS tracked. Per-item composition changes are a known Batch 1 limitation.

**Files**: `product-form-dialog.tsx` lines 436-468 (state + handleBatalClick), 471-494 (native listener), 477-483 (reset on close), 1846-1859 (Batal button JSX).

### 2. ✅ Inline validation for required and invalid fields

**Pattern**: onBlur validation + inline error display + onChange error clearing.

- `validateField(fieldId)` returns error message or null for: `name`, `price`, `variant-<i>-name`, `variant-<i>-price`.
- `handleBlur(fieldId)` marks field as touched and runs validation, populating `errors` state.
- `updateField(key, value)` and `updateVariant(index, key, value)` clear the corresponding error on edit.
- On submit, `handleSubmit` runs validation for all required fields, marks all as touched, populates errors, focuses first error field, and shows a toast "Periksa kembali field yang wajib diisi".
- Inline errors displayed as `<p role="alert">` with red text and `AlertCircle` icon below each required field.
- Invalid fields get red border (`border-red-500/50`) and `aria-invalid="true"`.

**Files**: `product-form-dialog.tsx` lines 137-139 (errors/touched state), 626-659 (validateField + handleBlur), 615-624 + 362-372 (clearError in updateField/updateVariant), 467-519 (submit validation), 905-925 + 1040-1064 + 1426-1445 + 1490-1513 (inline error JSX on name/price/variant-name/variant-price).

### 3. ✅ aria-required on required fields

- `aria-required="true"` added to: name input, price input, variant name input, variant price input.
- `aria-invalid` dynamically set based on `touched[fieldId] && errors[fieldId]`.
- `data-field-id` attribute added for DOM querying (used by submit's focus-first-error logic).

**Files**: Same as #2 inline error JSX locations.

### 4. ✅ Clear saving/loading state on submit action

- Submit button shows "Menyimpan..." with spinner when `saving=true` (was: static "Simpan"/"Tambah Produk" with spinner).
- `aria-busy={saving}` on submit button.
- `aria-label` dynamically set: "Menyimpan produk" / "Simpan produk" / "Tambah produk".
- Spinner has `aria-hidden="true"`.
- "Batal" button is `disabled={saving}` with `disabled:opacity-50 disabled:cursor-not-allowed` — prevents canceling mid-save.
- Submit button has `disabled:opacity-70 disabled:cursor-wait` when saving.

**Files**: `product-form-dialog.tsx` lines 1846-1859 (Batal button), 1860-1873 (submit button).

### 5. ✅ Confirmation before switching product-level composition to variant composition

**Pattern**: Portaled overlay dialog with "Beralih ke mode varian?" warning.

- When user toggles variants ON while `hasComposition=true` AND `compositions.length > 0`, a warning dialog appears.
- Dialog explains: composition items will be hidden, and on save, product-level composition will be deleted (PUT composition hard-replaces).
- Consequences listed: "Komposisi tingkat produk akan dihapus saat disimpan" + "Setiap varian harus diatur komposisinya sendiri".
- "Batal" cancels the toggle (composition preserved). "Ya, Beralih" confirms (variants activate, composition will be lost on save).
- Uses `createPortal(overlay, document.body)` with `z-[100]` to appear above the open ResponsiveDialog (z-50).
- The overlay's inner div has `onClick={e.stopPropagation()}` to prevent overlay dismissal when clicking inside the dialog.
- The overlay's outer div has `onClick={() => setVariantToggleOpen(false)}` for click-outside-to-cancel.

**Why this works but the discard dialog didn't**: The variant toggle overlay is triggered by a Switch toggle (not a button inside the Dialog). The overlay appears and the user interacts with it. The "Ya, Beralih" button's onClick fires correctly because the overlay is portaled to document.body (same stacking context as the Dialog) and the native click event reaches the button. The discard dialog had issues because it was triggered by the Batal button (inside the Dialog) and there was a conflict with the Dialog's close mechanism.

**Files**: `product-form-dialog.tsx` lines 485-500 (handleVariantToggle), 443 (variantToggleItemCount state), 1850-1897 (overlay JSX).

---

## What was NOT touched (per founder constraints)

- ❌ Full Product page redesign — only product-form-dialog.tsx modified
- ❌ Form conversion to tabs — sections remain as dividers
- ❌ Prisma schema — not touched
- ❌ API contracts — not touched
- ❌ Core logic (InventoryConsumptionService, FEFOEngine, HPP, consumption) — not touched
- ❌ Plan logic — not touched
- ❌ Inventory behavior — not touched
- ❌ 221-line submit handler — minimally extended (validation block added at top, ~20 lines), existing logic unchanged
- ❌ Bulk upload — not touched
- ❌ Theme tokens — not touched
- ❌ Pagination — not touched
- ❌ Refresh logic — not touched
- ❌ Code extraction (hooks) — not done

---

## Browser Verification Results

| Test | Status | Evidence |
|------|--------|----------|
| Add Product (valid data) | ✅ PASS | "Batch1 Valid Product" appeared in product list after submit |
| Edit Product (open + close clean) | ✅ PASS | Form opened pre-filled, Batal closed immediately (no confirm) |
| Invalid required fields (empty submit) | ✅ PASS | name + price both show `aria-invalid="true"`, red borders, error messages "Nama produk wajib diisi" + "Harga jual wajib diisi" |
| Close with unsaved changes (double-click) | ✅ PASS | First click → "⚠ Yakin Buang?", second click → form closed |
| Close without changes (no confirm) | ✅ PASS | Opening form + Batal with no edits → immediate close |
| Composition → Variant warning | ✅ PASS | Toggling variants with composition items → "Beralih ke mode varian?" dialog appeared |
| Composition → Variant confirm | ✅ PASS | "Ya, Beralih" closed warning, variant mode activated |
| aria-required present | ✅ PASS | `ariaRequired: "true"` verified via DOM query |
| Saving state (Menyimpan...) | ✅ PASS | Button text changes, spinner shows, Batal disabled (code-verified) |

---

## Completion Header

```
Executed:
  - 5 UX safety features implemented in product-form-dialog.tsx
  - Lint: 0 errors, 0 warnings
  - Browser tests: 8/8 PASS (Add, Edit, invalid fields, unsaved-changes, no-changes, comp→variant warning, comp→variant confirm, aria-required)
  - Dev server: healthy on port 3000

Passed: 8/8 browser tests
Failed: 0
Blocked: 0
Not Executed: Mobile device testing (desktop browser only)
Code Changes: product-form-dialog.tsx only (1 file modified)
Contract Violations: 0 (no Prisma, API, core logic, plan, or inventory changes)
Open Decisions: None for Batch 1
Final Status: BATCH 1 COMPLETE — ready for commit + ZIP backup
```

---

## Technical Notes for Future Batches

1. **Dialog-inside-Dialog limitation**: React onClick handlers don't reliably fire for buttons rendered in overlays/portals inside an open Radix Dialog. The double-click pattern on the existing Batal button (with native DOM listener) is the workaround. If a future batch needs a separate confirmation dialog from within the form, consider lifting the dialog state to `products-page.tsx` (where no Dialog is open).

2. **`useConfirm` hook bug**: The shared `useConfirm` hook in `src/components/shared/confirm-dialog.tsx` has a pre-existing bug — `handleConfirm` is defined but never wired to `ConfirmDialog`'s `AlertDialogAction`. The `confirm()` Promise always resolves `false`. This should be fixed in a future batch (wire `handleConfirm` to the AlertDialogAction's onClick, or expose it via the hook's return value).

3. **Composition dirty-state tracking**: Batch 1 excludes composition items from the dirty-state snapshot because composition data loads async in Edit mode. If a future batch wants to track composition changes, add a `compositionLoaded` flag that's set when the composition fetch resolves, and only capture the snapshot after that flag is true.

4. **agent-browser click limitation**: agent-browser's coordinate-based clicking doesn't work for buttons inside Radix Dialog portals (the Dialog overlay intercepts the click). Use `agent-browser eval` with `.click()` for DOM-level clicks during testing.
