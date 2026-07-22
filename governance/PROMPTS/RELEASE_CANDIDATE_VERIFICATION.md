# Prompt — Release Candidate Verification

Execute release-candidate verification for Aether using the current approved contracts and test catalog.

## Required Documents

Read and obey:

- `AI_RUNTIME_RULES.md`
- `QA_CONTRACT.md`
- `TEST_CATALOG.md`
- all architecture, domain, mutation, UX, and release contracts
- latest approved fix reports
- latest unresolved issue register

## Mode

**READ-ONLY VERIFICATION**

## Required Coverage

1. Re-run every previously failed P0 and P1 test.
2. Re-run regression tests for all changed domains.
3. Execute all cross-domain critical workflows.
4. Verify production-equivalent build behavior.
5. Verify no new fatal console or server errors.
6. Verify persistence and cross-domain effects.
7. Record all remaining P2 and P3 issues.

## Release Decision Input

Return exactly one:

- `RC READY FOR FOUNDER APPROVAL`
- `RC CONDITIONAL — NON-CRITICAL ISSUES REMAIN`
- `RC NOT READY — P0/P1 PRESENT`
- `RC INSUFFICIENTLY VERIFIED`

The AI must not independently authorize production release.
