# AETHER TEST CATALOG v1.0

## Status

**LIVING DOCUMENT**

## Usage

This catalog is the baseline test inventory for Aether.

Before execution, QA must compare this catalog with the actual deployed UI and add any missing capability discovered during page mapping.

A missing feature in this catalog does not exempt that feature from testing.

---

# 1. Authentication and Session

- `AUTH-001` Login with valid credentials
- `AUTH-002` Invalid login feedback
- `AUTH-003` Session persistence after refresh
- `AUTH-004` Logout
- `AUTH-005` Unauthorized route protection
- `AUTH-006` Role-based route restriction
- `AUTH-007` Expired session handling

---

# 2. Dashboard

- `DASH-001` Dashboard route and render
- `DASH-002` Summary cards load actual data
- `DASH-003` Revenue or sales metric accuracy
- `DASH-004` Transaction metric accuracy
- `DASH-005` Product or stock metric accuracy
- `DASH-006` Date range filter
- `DASH-007` Outlet filter where applicable
- `DASH-008` Widget navigation
- `DASH-009` Empty-state accuracy
- `DASH-010` Refresh persistence and latest data

---

# 3. POS

- `POS-001` POS route and render
- `POS-002` Product list loads
- `POS-003` Product search
- `POS-004` Category filter
- `POS-005` Add product to cart
- `POS-006` Increase and decrease quantity
- `POS-007` Remove cart item
- `POS-008` Variant selection
- `POS-009` Out-of-stock prevention
- `POS-010` Customer selection
- `POS-011` Create customer from POS where available
- `POS-012` Item discount
- `POS-013` Cart discount
- `POS-014` Tax or service charge behavior where applicable
- `POS-015` Payment method selection
- `POS-016` Cash payment and change calculation
- `POS-017` Non-cash payment flow
- `POS-018` Checkout success
- `POS-019` Transaction record created
- `POS-020` Inventory consumption reflected
- `POS-021` Receipt preview or print
- `POS-022` Pending transaction save
- `POS-023` Pending transaction restore
- `POS-024` Offline transaction local save
- `POS-025` Offline queue visibility
- `POS-026` Sync after connection recovery
- `POS-027` Sync deduplication
- `POS-028` Checkout validation feedback
- `POS-029` Page refresh without cart corruption
- `POS-030` Mobile layout critical workflow

---

# 4. Products

- `PRD-001` Product route and render
- `PRD-002` Existing product list loads
- `PRD-003` Accurate empty state
- `PRD-004` Create simple product
- `PRD-005` Required-field validation
- `PRD-006` Edit product
- `PRD-007` Archive or delete product
- `PRD-008` Restore product where available
- `PRD-009` Product search
- `PRD-010` Product filter
- `PRD-011` Product sort
- `PRD-012` Pagination or infinite loading
- `PRD-013` Create product variant
- `PRD-014` Edit product variant
- `PRD-015` Variant stock display
- `PRD-016` Product pricing
- `PRD-017` Product image upload
- `PRD-018` Product detail navigation
- `PRD-019` Create product composition
- `PRD-020` Edit product composition
- `PRD-021` Composition unit validation
- `PRD-022` Product appears in POS
- `PRD-023` Archived product disappears from active POS
- `PRD-024` Import product template download
- `PRD-025` Import valid product file
- `PRD-026` Import invalid file feedback
- `PRD-027` Import persistence after refresh
- `PRD-028` Export products where available

---

# 5. Inventory

- `INV-001` Inventory route and render
- `INV-002` Inventory item list loads
- `INV-003` Inventory item detail opens
- `INV-004` Search inventory item
- `INV-005` Filter inventory item
- `INV-006` Sort inventory item
- `INV-007` Pagination or infinite loading
- `INV-008` Create inventory item where available
- `INV-009` Edit inventory item
- `INV-010` Unit configuration
- `INV-011` Non-batch stock display
- `INV-012` Batch without expiry display
- `INV-013` Batch with expiry display
- `INV-014` Batch detail accuracy
- `INV-015` Expiry warning behavior
- `INV-016` Manual adjustment where authorized
- `INV-017` Adjustment reason validation
- `INV-018` Adjustment persistence
- `INV-019` Inventory movement history
- `INV-020` Product composition consumption effect
- `INV-021` Direct product stock consumption effect
- `INV-022` Stock cannot become invalid through UI
- `INV-023` Outlet-specific inventory state
- `INV-024` Low-stock indicator

---

# 6. Purchases

- `PUR-001` Purchase route and render
- `PUR-002` Purchase list loads
- `PUR-003` Create draft purchase
- `PUR-004` Add purchase item
- `PUR-005` Quantity and unit validation
- `PUR-006` Cost validation
- `PUR-007` Supplier selection where applicable
- `PUR-008` Save purchase draft
- `PUR-009` Edit purchase draft
- `PUR-010` Receive purchase
- `PUR-011` Partial receive where available
- `PUR-012` Received stock updates inventory
- `PUR-013` Batch created correctly where applicable
- `PUR-014` Expiry recorded correctly where applicable
- `PUR-015` Cost or HPP state updates correctly
- `PUR-016` Purchase status transition
- `PUR-017` Duplicate receive prevention
- `PUR-018` Purchase detail view
- `PUR-019` Search and filter purchase
- `PUR-020` Delete or cancel draft behavior
- `PUR-021` Persistence after refresh

---

# 7. Transactions

- `TRX-001` Transaction route and render
- `TRX-002` Transaction list loads
- `TRX-003` Transaction detail opens
- `TRX-004` Search transaction
- `TRX-005` Date filter
- `TRX-006` Outlet filter where applicable
- `TRX-007` Payment-method filter
- `TRX-008` Pagination or infinite loading
- `TRX-009` Transaction totals accuracy
- `TRX-010` Item snapshot accuracy
- `TRX-011` Customer snapshot or relation accuracy
- `TRX-012` COGS snapshot stability
- `TRX-013` Receipt reprint
- `TRX-014` Void transaction
- `TRX-015` Void confirmation and permission
- `TRX-016` Void restores exact inventory
- `TRX-017` Void restores loyalty where applicable
- `TRX-018` Duplicate void prevention
- `TRX-019` Transaction persists after refresh

---

# 8. Customers

- `CUST-001` Customer route and render
- `CUST-002` Existing customer list loads
- `CUST-003` Accurate empty state
- `CUST-004` Search customer
- `CUST-005` Filter or sort customer where available
- `CUST-006` Add Customer action opens
- `CUST-007` Required-field validation
- `CUST-008` Create customer with valid data
- `CUST-009` Newly created customer appears in list
- `CUST-010` Customer persists after refresh
- `CUST-011` Edit customer
- `CUST-012` Edited data persists after refresh
- `CUST-013` Archive or delete customer
- `CUST-014` Restore customer where available
- `CUST-015` Customer detail view
- `CUST-016` Customer selectable in POS
- `CUST-017` Customer transaction history
- `CUST-018` Customer total spend accuracy
- `CUST-019` Loyalty balance accuracy where applicable
- `CUST-020` Duplicate customer validation where applicable
- `CUST-021` Server error feedback

---

# 9. Suppliers

- `SUP-001` Supplier route and render where enabled
- `SUP-002` Supplier list loads
- `SUP-003` Create supplier
- `SUP-004` Edit supplier
- `SUP-005` Archive or delete supplier
- `SUP-006` Supplier search
- `SUP-007` Supplier selectable in purchase
- `SUP-008` Persistence after refresh

---

# 10. Transfers

- `TRF-001` Transfer route and render
- `TRF-002` Transfer list loads
- `TRF-003` Create transfer
- `TRF-004` Source and destination validation
- `TRF-005` Add transfer items
- `TRF-006` Quantity validation
- `TRF-007` Save transfer draft
- `TRF-008` Submit or dispatch transfer
- `TRF-009` Source stock decreases at correct stage
- `TRF-010` Receive transfer
- `TRF-011` Destination stock increases
- `TRF-012` Batch data preserved where applicable
- `TRF-013` Partial receive where available
- `TRF-014` Duplicate receive prevention
- `TRF-015` Cancel transfer behavior
- `TRF-016` Transfer detail and history
- `TRF-017` Search and filter transfer
- `TRF-018` Persistence after refresh

---

# 11. Stock Opname

- `SO-001` Stock opname route and render
- `SO-002` Create stock opname session
- `SO-003` Snapshot includes expected inventory
- `SO-004` Outlet scope accuracy
- `SO-005` Enter physical count
- `SO-006` Variance calculation
- `SO-007` Save draft locally where applicable
- `SO-008` Resume draft
- `SO-009` Validation before submit
- `SO-010` Submit stock opname
- `SO-011` Inventory adjustment applied
- `SO-012` Adjustment history created
- `SO-013` Duplicate submit prevention
- `SO-014` Refresh persistence
- `SO-015` Non-inventory outlet behavior
- `SO-016` Cancel or discard session

---

# 12. Crew and Permissions

- `CREW-001` Crew route and render
- `CREW-002` Crew list loads
- `CREW-003` Add crew member
- `CREW-004` Invite or credential flow
- `CREW-005` Edit crew member
- `CREW-006` Assign role
- `CREW-007` Assign outlet access
- `CREW-008` Disable crew member
- `CREW-009` Re-enable crew member
- `CREW-010` Permission-restricted navigation
- `CREW-011` Permission-restricted actions
- `CREW-012` Unauthorized action feedback
- `CREW-013` Permission persistence after login

---

# 13. Migration and Import

- `MIG-001` Migration route and render
- `MIG-002` Download migration template
- `MIG-003` Select Product-only mode
- `MIG-004` Select Product + Inventory mode
- `MIG-005` Upload valid file
- `MIG-006` File parsing progress
- `MIG-007` Invalid format feedback
- `MIG-008` Required column validation
- `MIG-009` Duplicate handling
- `MIG-010` Product-only import result
- `MIG-011` Product + Inventory import result
- `MIG-012` Opening balance result
- `MIG-013` Imported products appear in Product
- `MIG-014` Imported inventory appears in Inventory
- `MIG-015` Imported sellable products appear in POS
- `MIG-016` Success summary accuracy
- `MIG-017` Refresh persistence
- `MIG-018` Re-import protection or behavior

---

# 14. Settings

- `SET-001` Settings route and render
- `SET-002` Business profile loads
- `SET-003` Update business profile
- `SET-004` Outlet settings
- `SET-005` POS settings
- `SET-006` Inventory capability settings
- `SET-007` Batch setting behavior
- `SET-008` Expiry setting behavior
- `SET-009` Receipt settings
- `SET-010` Tax and service settings where available
- `SET-011` Payment method settings
- `SET-012` Settings persistence after refresh
- `SET-013` Settings effect in relevant domain
- `SET-014` Validation and error feedback

---

# 15. Plan and Billing

- `PLAN-001` Plan route and render
- `PLAN-002` Current plan accuracy
- `PLAN-003` Feature limit visibility
- `PLAN-004` Upgrade action
- `PLAN-005` Downgrade behavior where available
- `PLAN-006` Billing history where available
- `PLAN-007` Expired plan behavior
- `PLAN-008` Restricted feature feedback

---

# 16. Audit Log

- `AUD-001` Audit log route and render
- `AUD-002` Audit entries load
- `AUD-003` Date filter
- `AUD-004` Actor filter
- `AUD-005` Action filter
- `AUD-006` Entity detail
- `AUD-007` Pagination
- `AUD-008` New mutation creates audit entry where required
- `AUD-009` Audit entry accuracy
- `AUD-010` Permission restriction

---

# 17. Reports

- `RPT-001` Reports route and render
- `RPT-002` Sales report loads
- `RPT-003` Date range filter
- `RPT-004` Outlet filter
- `RPT-005` Revenue totals accuracy
- `RPT-006` COGS totals accuracy
- `RPT-007` Gross profit accuracy
- `RPT-008` Product performance report
- `RPT-009` Inventory report
- `RPT-010` Customer report where available
- `RPT-011` Export report
- `RPT-012` Empty-state accuracy

---

# 18. Global Navigation and Shared UI

- `GLOBAL-001` Sidebar navigation
- `GLOBAL-002` Mobile navigation
- `GLOBAL-003` Active route indicator
- `GLOBAL-004` Breadcrumb behavior where available
- `GLOBAL-005` Global loading state
- `GLOBAL-006` Global error boundary
- `GLOBAL-007` Toast success feedback
- `GLOBAL-008` Toast error feedback
- `GLOBAL-009` Confirmation dialog
- `GLOBAL-010` Keyboard accessibility for critical actions
- `GLOBAL-011` Responsive behavior on critical pages
- `GLOBAL-012` Outlet switcher effect
- `GLOBAL-013` Role-based navigation visibility

---

# 19. Cross-Domain Critical Workflows

- `FLOW-001` Create Product → Product appears in POS
- `FLOW-002` Create Customer → Customer selectable in POS
- `FLOW-003` POS Checkout → Transaction created
- `FLOW-004` POS Checkout → Inventory consumed
- `FLOW-005` Purchase Receive → Inventory increased
- `FLOW-006` Purchase Receive → Latest inventory available to POS
- `FLOW-007` Product Composition Sale → Ingredients consumed
- `FLOW-008` Transaction Void → Exact inventory restored
- `FLOW-009` Transaction Void → Loyalty restored where applicable
- `FLOW-010` Transfer Dispatch and Receive → Source and destination correct
- `FLOW-011` Stock Opname Submit → Inventory and movement history correct
- `FLOW-012` Migration Product-only → Products usable
- `FLOW-013` Migration Product + Inventory → Products and stock usable
- `FLOW-014` Offline POS → Local transaction retained
- `FLOW-015` Offline POS → Single successful sync after reconnect
- `FLOW-016` Duplicate sync attempt → No duplicate transaction
- `FLOW-017` Settings change → Relevant page behavior changes
- `FLOW-018` Crew permission change → Access behavior changes

---

# 20. Known Regression Seed Cases

These cases must remain in the catalog until explicitly verified and closed.

- `REG-CUST-001` Existing customers fail to display after deployment
- `REG-CUST-002` Add Customer action returns an error after deployment
- `REG-POS-001` Production POS runtime regression: `Cannot access '<minified symbol>' before initialization`

Each regression must include:

- target environment
- reproduction steps
- current status
- evidence
- closure verification
