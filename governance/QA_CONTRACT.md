# AETHER QA CONTRACT v1.0

## Status

**APPROVED FOR PLATFORM OPERATIONAL VERIFICATION**

## Purpose

This contract defines the mandatory standard for verifying whether Aether features work from the user’s perspective.

It prevents route availability, successful rendering, source inspection, or API responsiveness from being misreported as proof that a feature is operational.

QA is responsible for discovering, executing, observing, recording, and classifying behavior.

QA is not authorized to modify the product during discovery.

---

## 1. Scope

This contract applies to all user-facing Aether domains, pages, actions, dialogs, workflows, mutations, permissions, and cross-domain effects.

It includes:

- route access
- page rendering
- data visibility
- buttons and actions
- forms and validation
- dialogs and drawers
- search, filter, sort, and pagination
- create, update, delete, archive, restore
- import and export
- uploads and downloads
- navigation and detail views
- permissions
- persistence after refresh
- cross-domain effects
- offline and online behavior where applicable
- observable core integrity results

---

## 2. Governing Documents

QA must comply with:

- `AI_RUNTIME_RULES.md`
- `ARCHITECTURE_LOCK.md`
- `PLATFORM_ARCHITECTURE_REVIEW.md`
- `PRODUCT_DOMAIN.md`
- `MUTATION_CONTRACT.md`
- `UX_DESIGN_CONTRACT.md`
- all active G1–G5 guardrails
- domain-specific contracts referenced by the task

If these files use different names in the repository, the actual canonical filenames must be recorded in the report.

---

## 3. QA Principles

### Q1 — User-Centric Verification

A feature is tested through the behavior visible to the user.

Internal implementation may be inspected only after a failure is reproduced and only when root-cause analysis is explicitly requested.

### Q2 — Action-Based Testing

A visible or available action must be executed.

Examples:

- click
- submit
- save
- edit
- delete
- search
- filter
- select
- upload
- import
- export
- print
- navigate
- refresh

### Q3 — End-to-End Result

A workflow is not complete until its intended business effect is verified.

Example:

```text
Create Purchase
→ Receive Purchase
→ Inventory increases
→ Cost state updates where applicable
→ POS reflects latest sellable state
```

### Q4 — Evidence Required

Every `PASS` and `FAIL` requires evidence.

### Q5 — Persistence Required

For mutations, QA must verify that the result remains correct after refresh or re-navigation unless the feature is explicitly temporary.

### Q6 — Cross-Domain Verification

If an action affects another domain, that effect must be checked.

### Q7 — Read-Only Discovery

No product code may be changed during mapping or verification.

### Q8 — Environment Specificity

Results are valid only for the environment in which they were executed.

### Q9 — No Implicit Coverage

Untested functionality must never inherit the status of a related test.

### Q10 — Critical Path First

Critical workflows are executed before secondary utilities and cosmetic checks.

---

## 4. Verification Levels

### Level 1 — Surface Health

Purpose: determine whether the surface is accessible.

Checks:

- route exists
- authorization behavior is correct
- page renders
- loading completes or fails visibly
- no fatal runtime crash
- no blank screen

A Level 1 PASS proves only that the page is accessible.

It does not prove that the page is operational.

### Level 2 — Feature and Action Verification

Purpose: execute every meaningful user-facing capability on a page.

Checks may include:

- list data appears
- empty state is accurate
- create
- edit
- delete or archive
- restore
- search
- filter
- sort
- pagination
- tabs
- row actions
- dialog open and close
- validation
- upload
- import
- export
- print
- detail navigation

### Level 3 — Workflow Verification

Purpose: verify complete business workflows across one or more domains.

Examples:

- Product → POS → Transaction
- Purchase → Inventory → POS
- Stock Opname → Inventory Adjustment → History
- Transfer → Source Stock → Destination Stock
- Customer → POS Selection → Transaction Record
- Void → Inventory Restoration → Loyalty Restoration

### Level 4 — Observable Core Integrity

Purpose: verify externally observable results governed by the locked core.

QA must not reopen or re-audit the internal implementation unless separately authorized.

Examples:

- inventory quantity changes correctly
- FEFO observable result is correct
- COGS snapshot remains stable
- void restores the correct amount
- duplicate sync does not duplicate transactions
- offline transaction persists and synchronizes once

---

## 5. Required Capability Discovery

Before execution, QA must inventory the capabilities present on every page.

The inventory must include:

- visible buttons
- conditional buttons
- forms
- dialogs
- drawers
- dropdown actions
- tabs
- table controls
- filters
- search
- sort
- pagination
- bulk actions
- row actions
- empty-state actions
- import/export
- upload/download
- destructive actions
- cross-page navigation
- role-restricted actions

Any capability not tested must be marked `NOT EXECUTED` or `NOT APPLICABLE`.

---

## 6. Test Case Format

Every test case must contain:

```text
Test ID:
Domain:
Page:
Feature:
Environment:
Role:
Preconditions:
Test Data:
Steps:
Expected Result:
Actual Result:
Evidence:
Persistence Check:
Cross-Domain Check:
Severity:
Status:
Notes:
```

---

## 7. Allowed Statuses

Only the following statuses are allowed:

### PASS

The action was executed, expected behavior occurred, persistence was verified where applicable, and evidence exists.

### FAIL

The action was executed and the actual behavior did not match the expected result.

### BLOCKED

The test could not be executed due to an external dependency, permission, environment, missing test data, or upstream failure.

### NOT EXECUTED

The test has not been performed.

### NOT APPLICABLE

The capability does not exist or does not apply to the tested configuration.

---

## 8. Severity

### P0 — Platform Blocker

The platform or a fundamental path is unusable.

Examples:

- login unavailable
- production application cannot load
- POS crashes for all users
- database unavailable
- data corruption is occurring

### P1 — Critical Workflow Failure

A primary business workflow cannot be completed or produces materially incorrect business state.

Examples:

- checkout fails
- customer creation fails when required by workflow
- purchase receipt does not update inventory
- stock opname cannot be submitted
- transfer produces incorrect stock
- void restores the wrong quantity

### P2 — Functional Failure

A secondary feature fails without blocking the main operation.

Examples:

- search fails
- filter fails
- pagination fails
- export fails
- optional detail action fails

### P3 — UX or Cosmetic Issue

Visual, wording, spacing, responsive, or feedback issue that does not invalidate the business result.

---

## 9. PASS Rules

A test may be marked `PASS` only when all applicable conditions are met:

- action was actually executed
- expected result occurred
- UI state is correct
- mutation result is correct
- success or error feedback is appropriate
- persistence after refresh is correct
- cross-domain effect is correct
- no critical console or network error invalidates the result
- evidence is recorded

If any required condition is missing, the test is not PASS.

---

## 10. Mutation Verification

For every create, update, delete, archive, restore, import, checkout, receive, transfer, adjustment, or void action, verify:

```text
PREPARE
→ COMMIT
→ INVALIDATE
→ REFRESH
→ FEEDBACK
```

For offline POS flows, verify:

```text
PREPARE
→ LOCAL COMMIT
→ LOCAL UI UPDATE
→ QUEUE
→ SYNC
→ DEDUPLICATION
→ FEEDBACK
```

QA verifies observable behavior only.

---

## 11. Evidence Standard

Acceptable evidence includes:

- screenshot before and after
- screen recording
- exact console error
- exact network request and response
- server log reference
- record ID created by the test
- data comparison before and after
- refresh persistence result
- cross-domain resulting state

A statement such as “API responding” is not sufficient evidence that a feature works.

---

## 12. Destructive Test Safety

Destructive tests must use controlled test data.

QA must not:

- delete real merchant data
- alter production financial records
- trigger irreversible actions against live customers
- create uncontrolled inventory mutations

If production-safe execution is not possible, mark the test `BLOCKED` and execute it in the approved RC or staging environment.

---

## 13. Final Report Structure

The consolidated report must include:

### A. Executive Summary

- environment
- domains discovered
- capabilities discovered
- tests planned
- tests executed
- passed
- failed
- blocked
- not executed
- P0 count
- P1 count
- P2 count
- P3 count

### B. Surface Health

Per-domain Level 1 results.

### C. Feature Coverage

Per-domain capability inventory and execution coverage.

### D. Critical Workflow Results

All Level 3 workflows with evidence.

### E. Observable Core Integrity

Only externally observed results.

### F. Failure Register

Each failure with:

- Test ID
- reproduction
- evidence
- severity
- environment
- root cause status

### G. Unknown and Untested Register

Every blocked or not executed test.

### H. Release Decision Input

One of:

- `READY FOR FOUNDER REVIEW`
- `CONDITIONAL — P2/P3 REMAIN`
- `NOT READY — P0/P1 PRESENT`
- `INSUFFICIENT VERIFICATION`

QA does not independently approve a release.

---

## 14. Exit Criteria

QA verification is complete only when:

- all target domains are discovered
- all meaningful user-facing capabilities are cataloged
- all critical workflows are executed
- all mutations include persistence checks
- all applicable cross-domain effects are verified
- all failures include evidence and severity
- all unexecuted items are explicitly listed
- no hidden assumptions remain in the report

The statement “all pages render” is never sufficient exit evidence.
