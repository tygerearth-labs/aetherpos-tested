# AETHER UX STABILIZATION RULES v1.0

## Purpose

Improve existing user flows and visual clarity without changing
platform architecture, domain behavior, or core business logic.

## Allowed Scope

- Page layout within the approved page
- Dialog size and structure
- Field grouping and ordering
- Button hierarchy
- Labels and helper text
- Validation presentation
- Loading, success, error, and empty states
- Responsive behavior
- Reuse of existing UI components and design tokens

## Forbidden Scope

- Prisma schema
- Database migrations or db:push
- API contracts or endpoint behavior
- Core inventory engine
- FEFO, HPP, consumption, sync, or offline logic
- Domain models and business rules
- Permission or role model
- Plan entitlements and limits
- Global navigation
- New platform capabilities
- New dependencies
- Broad refactoring
- Unrelated cleanup

## Stop Rule

If the requested UX improvement appears to require any forbidden change:

1. Stop implementation.
2. Record the dependency and supporting evidence.
3. Propose a UX-only fallback if available.
4. Wait for founder approval.

Never expand scope automatically.

## Work Unit

One page or one explicitly approved workflow per task.

## Execution Sequence

DISCOVER
→ REPORT
→ FOUNDER APPROVAL
→ IMPLEMENT APPROVED CHANGES
→ VERIFY
→ CHECKPOINT
→ COMMIT
→ LOCK

## Reuse Rule

Reuse existing components, tokens, typography, colors, icons,
radius, shadows, and interaction patterns before creating anything new.

## Write Boundary

Only files explicitly approved by the founder may be modified.

## Completion Rule

A page is complete only when:
- approved UX changes are implemented;
- affected workflows pass;
- no forbidden scope was touched;
- checkpoint is updated;
- commit hash is recorded.