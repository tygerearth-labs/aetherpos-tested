# Prompt — Approved Targeted Fix

Implement only the founder-approved fix for the specified Test IDs.

## Required Documents

Read and obey:

- `AI_RUNTIME_RULES.md`
- `QA_CONTRACT.md`
- the approved root-cause report
- all relevant architecture, product, mutation, and UX contracts

## Mode

**WRITE-AUTHORIZED — TARGETED ONLY**

## Rules

1. Modify only the approved fault boundary.
2. Use the smallest change that resolves the verified issue.
3. Do not refactor unrelated code.
4. Do not rename, reorganize, optimize, or clean up unrelated files.
5. Do not change locked architecture, domain semantics, schemas, or contracts.
6. Record every changed file and why it changed.
7. Execute the exact failed test first after the fix.
8. Execute all required regression tests identified in the root-cause report.
9. If the approved fix does not work, stop. Do not broaden scope without founder approval.

## Required Output

```text
Approved Test IDs:
Root Cause Used:
Files Changed:
Change Summary:
Contract Impact:
Tests Executed:
Passed:
Failed:
Blocked:
Residual Risk:
Final Status:
```
