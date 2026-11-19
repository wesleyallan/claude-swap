# T06 — Use cases & rotation engine

Skills: `tdd`, `vitest`.

## Do (`src/application`, depends only on domain + ports)
- Use cases (plain functions taking a `deps` object): `importCurrentLogin`, `removeAccount`, `reorderAccounts(ids)`,
  `promoteAccount(id)`, `setAccountEnabled`, `renameAccount`, `updatePreferences`, `getDashboard` (accounts + usage + history + activity + engine status).
  Every mutation that can change the active account triggers `engine.runNow()`.
- `Engine` class: `start()`, `stop()`, `runNow()`; tick under the mutex:
  1. sync back live login (architecture §3 step 1); detect unknown logged-in account → status flag `unknownLogin`.
  2. refresh inactive tokens close to expiry (ownership rule); `InvalidGrant` → `needsReauth`.
  3. poll usage for all enabled accounts (concurrency 2, respect `RateLimited` backoff per account, keep last good snapshot on error); append history.
  4. `selectActiveAccount` → if different from live login, swap (steps 2–4 of the swap procedure) and record activity.
  - Interval = `pollIntervalSec`; re-schedule when preferences change; `runNow` is debounced (coalesce bursts).
  - Never throws out of a tick; errors become activity entries + logs.
- In-memory fakes for every port in `src/application/testing/` (reused by server tests).

## Tests
Scenario tests with a fake clock: A exhausted → swap to B; A resets → back to A; manual promote; autoRotate off; Claude Code refreshed A's token while active → synced before swapping; inactive token refresh; needsReauth skip; rate-limit backoff; all exhausted.

## Done when
Green + commits `feat(app): ...`.
