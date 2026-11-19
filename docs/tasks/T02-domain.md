# T02 — Domain model & rotation policy

Skills: `tdd`, `vitest`.

## Do (all in `src/domain`, pure, no I/O)
- Types: `AccountId`, `Account` (id, label, email, organizationName, subscriptionType, enabled, needsReauth, addedAt),
  `UsageWindow { utilization: number (0–100), resetsAt: Date | null }`, `UsageSnapshot { fiveHour, sevenDay, fetchedAt, error? }`,
  `Thresholds { fiveHour, sevenDay }`, `Preferences`.
- `isExhausted(snapshot, thresholds, now)`: a window counts only while `resetsAt > now`; missing snapshot = not exhausted (unknown ≠ blocked) — document it.
- `selectActiveAccount({ accounts, usage, thresholds, now, autoRotate, currentId })` → `{ id, reason }`:
  - autoRotate off → first enabled, non-needsReauth account (manual mode);
  - otherwise first enabled, non-needsReauth, non-exhausted account in order;
  - all exhausted → keep current if it is still a candidate, else the one whose earliest reset comes first; return reason `all-exhausted`;
  - no candidates → `null`.
  - reasons: `top-priority | auto-exhausted | auto-reset | manual | all-exhausted` (derive auto-reset vs auto-exhausted by comparing with `currentId` position).
- Ordering ops (immutable): `moveAccount(list, id, toIndex)`, `promoteAccount(list, id)`, `applyOrder(list, ids)` (validates same set).
- `nextResetAt(snapshot)` helper for the UI/engine.
- Domain errors as discriminated unions or small Error subclasses.

## Tests
Table-driven tests covering every branch above, boundary values (utilization == threshold, resetsAt == now), and ordering ops invariants.

## Done when
100 % branch coverage on `src/domain` (enforce threshold in vitest config for this folder). Commit `feat(domain): ...`.
