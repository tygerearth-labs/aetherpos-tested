# AETHER AI RUNTIME RULES v1.0

## Status

**ACTIVE**

## Purpose

This document defines how every AI crew member must operate inside the Aether project.

These rules apply to all models, agents, coding assistants, auditors, testers, and reviewers working on Aether.

They do not replace domain contracts. They govern how those contracts must be read, interpreted, and enforced.

---

## R1 — Read Required Contracts First

Before performing any task, the AI must read every contract referenced by the task prompt.

If a required contract is unavailable, unreadable, incomplete, or contradictory, the AI must stop and report the issue.

The AI must not reconstruct missing rules from memory or assumption.

---

## R2 — Locked Means Locked

The AI must not modify, reinterpret, bypass, or reopen any area marked:

- LOCKED
- FROZEN
- APPROVED
- REVIEWED

unless the founder explicitly authorizes that boundary to be reopened.

Finding a problem does not grant permission to change the locked area.

---

## R3 — Evidence Before Conclusion

Every conclusion must be supported by observable evidence.

Examples of acceptable evidence:

- executed UI interaction
- screenshot
- browser console output
- network request and response
- server log
- database state before and after an approved test
- reproducible test steps
- source location with exact behavior trace

The AI must distinguish clearly between:

- observed fact
- inference
- hypothesis
- recommendation

---

## R4 — Never Infer PASS

A feature may be marked `PASS` only when the required action was actually executed and the result matched the expected behavior.

The following are not sufficient evidence of a working feature:

- route exists
- page renders
- source code looks correct
- API endpoint exists
- API returns HTTP 200
- unit test exists
- previous report says PASS

If the action was not executed, the status must be `NOT EXECUTED`.

---

## R5 — Discovery and Modification Are Separate

Discovery work is read-only.

During discovery, audit, mapping, or verification, the AI must not:

- fix code
- refactor
- rename
- reorganize files
- optimize
- clean up
- add abstractions
- change business logic
- alter schemas

The required flow is:

```text
DISCOVER
→ RECORD
→ CLASSIFY
→ PRIORITIZE
→ FOUNDER DECISION
→ APPROVED FIX
→ RE-VERIFY
```

---

## R6 — Scope Must Not Expand Silently

The AI must work only within the explicitly approved scope.

If a task reveals an issue outside the current scope, the AI must:

1. record the finding,
2. classify its severity,
3. explain the dependency,
4. stop before modifying the external scope.

No hidden scope expansion is allowed.

---

## R7 — Minimal Change Principle

When a fix is approved, the AI must propose and implement the smallest change capable of resolving the verified issue.

The AI must not use a bug as justification for:

- broad refactor
- architecture redesign
- unnecessary abstraction
- unrelated cleanup
- dependency replacement

---

## R8 — Preserve Existing Contracts

All approved work must preserve:

- Architecture Lock
- Product Domain Freeze
- Platform Architecture Review
- Mutation Contract
- UX Design Contract
- QA Contract
- domain-specific invariants
- G1–G5 guardrails

Any potential conflict must be escalated before changes are made.

---

## R9 — Environment Must Be Declared

Every audit, test, or verification report must state the environment used.

Examples:

- local development
- preview deployment
- release candidate
- staging
- production

A result from one environment must not be generalized to another without verification.

---

## R10 — Unknown Is an Acceptable Result

When evidence is insufficient, the AI must use one of the following:

- `NOT EXECUTED`
- `BLOCKED`
- `NOT VERIFIED`
- `ROOT CAUSE UNCONFIRMED`

The AI must never manufacture certainty.

---

## R11 — Reports Must Separate Facts and Recommendations

Every report must contain separate sections for:

1. Observed facts
2. Reproduction steps
3. Evidence
4. Severity
5. Root cause status
6. Recommended action
7. Risk and contract impact

Recommendations must not be presented as proven facts.

---

## R12 — Founder Is the Decision Gate

AI crew may:

- discover
- test
- analyze
- compare
- propose
- verify

AI crew may not independently authorize:

- architecture changes
- domain changes
- schema changes
- core engine changes
- major refactors
- release approval

Final authorization belongs to the founder.

---

## Mandatory Stop Conditions

The AI must stop and escalate when:

- a requested action conflicts with a locked contract
- the required environment is unavailable
- credentials or permissions are insufficient
- destructive testing would affect real customer data
- root cause is not supported by evidence
- a fix requires schema or core changes not explicitly approved
- the task scope is ambiguous enough to risk modifying the wrong domain

---

## Required Task Header

Every AI task report must begin with:

```text
Task:
Role:
Environment:
Scope:
Contracts Read:
Mode: READ-ONLY | WRITE-AUTHORIZED
Started From:
```

---

## Required Completion Header

Every AI task report must end with:

```text
Executed:
Passed:
Failed:
Blocked:
Not Executed:
Code Changes:
Contract Violations:
Open Decisions:
Final Status:
```

---

## Final Rule

When uncertain:

> Stop, preserve the current system, record the uncertainty, and request a founder decision.
