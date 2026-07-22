# Prompt — Targeted Root Cause Analysis

Perform targeted root-cause analysis only for the approved failed Test IDs listed by the founder.

## Required Documents

Read and obey:

- `AI_RUNTIME_RULES.md`
- `QA_CONTRACT.md`
- the latest Phase 0.5B verification report
- all relevant architecture and domain contracts

## Mode

**READ-ONLY ANALYSIS**

Do not implement fixes.

## Required Method

For each approved failure:

1. Reconfirm the reproduction.
2. Trace the execution path from UI action to observable failure.
3. Collect evidence from browser, network, server logs, and source only as needed.
4. Separate confirmed facts from hypotheses.
5. Identify the smallest likely fault boundary.
6. Determine whether the issue touches a locked contract.
7. Propose the smallest safe fix option.
8. State risks, affected domains, and required re-verification tests.

## Required Output Per Issue

```text
Test ID:
Severity:
Environment:
Reproduction Confirmed:
Observed Facts:
Evidence:
Root Cause Status: CONFIRMED | PROBABLE | UNCONFIRMED
Root Cause:
Fault Boundary:
Contract Impact:
Minimal Fix Option:
Alternative Option:
Risk:
Required Re-Verification:
Code Changes Made: 0
```
