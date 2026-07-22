# Prompt — Phase 0.5B Platform Operational Verification

Execute **PHASE 0.5B — FEATURE & ACTION VERIFICATION** across the entire Aether platform.

## Required Documents

Read and obey:

1. `AI_RUNTIME_RULES.md`
2. `QA_CONTRACT.md`
3. `TEST_CATALOG.md`
4. `ARCHITECTURE_LOCK.md`
5. `PLATFORM_ARCHITECTURE_REVIEW.md`
6. `PRODUCT_DOMAIN.md`
7. `MUTATION_CONTRACT.md`
8. `UX_DESIGN_CONTRACT.md`
9. all active G1–G5 guardrails

## Role

Act as a **QA execution crew**, not as a code auditor and not as a developer.

## Mode

**READ-ONLY**

Do not change source code, configuration, schema, data model, architecture, or contracts.

## Objective

Verify whether every user-facing capability actually works through real UI interaction in the target deployed environment.

Do not limit verification to routes, rendering, source inspection, or API availability.

## Mandatory Execution Rules

1. Discover every user-accessible domain and route.
2. Inventory every visible and conditional capability on every page.
3. Compare discovered capabilities against `TEST_CATALOG.md`.
4. Add missing test cases to the report as `CATALOG GAP`; do not silently skip them.
5. Execute actions through the UI.
6. Do not infer PASS from source code, API existence, HTTP 200, or previous reports.
7. Verify data visibility, mutations, validation, feedback, persistence after refresh, and cross-domain effects.
8. Use only these statuses: `PASS`, `FAIL`, `BLOCKED`, `NOT EXECUTED`, `NOT APPLICABLE`.
9. Every PASS and FAIL requires evidence.
10. State the exact environment and role used for every test group.
11. Do not fix any issue discovered.
12. Do not declare the platform operational while unresolved P0 or P1 failures exist.
13. Do not declare the platform fully verified while critical tests remain `NOT EXECUTED` or `BLOCKED`.

## Mandatory Regression Cases

Explicitly reproduce and document:

- `REG-CUST-001` Existing customers fail to display after deployment.
- `REG-CUST-002` Add Customer action returns an error after deployment.
- `REG-POS-001` Production POS runtime initialization regression, if still reproducible.

Do not assume these issues are resolved because a previous report marked the page healthy.

## Required Output

Produce one consolidated report containing:

1. Task header
2. Environment and role matrix
3. Domains and routes discovered
4. Capability inventory per page
5. Catalog gaps
6. Surface Health results
7. Feature and Action Verification results
8. Cross-Domain Critical Workflow results
9. Observable Core Integrity results
10. Failure register with evidence
11. Blocked and Not Executed register
12. Coverage metrics
13. P0–P3 counts
14. Contract violations, if any
15. Final status using only one of:
   - `READY FOR FOUNDER REVIEW`
   - `CONDITIONAL — P2/P3 REMAIN`
   - `NOT READY — P0/P1 PRESENT`
   - `INSUFFICIENT VERIFICATION`

Do not include fixes, refactors, or implementation changes.
