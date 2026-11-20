# Architecture — claude-swap

## 1. Goal

Keep Claude Code always logged into the best available Claude account:

- accounts are an **ordered list** (index 0 = highest priority);
- the **active** account is the first enabled account in the list that is not exhausted;
- an account is **exhausted** when its 5-hour or 7-day utilization ≥ the configured threshold
  (or the API reports it locked) and that window's `resets_at` is still in the future;
- when a higher account's window resets, it becomes eligible again → automatic swap back up;
- **manual swap = reorder**: "Use now" moves an account to the top; drag & drop changes the order.
  There is one source of truth (the order), so manual and automatic modes never fight.
- `autoRotate: false` freezes the engine on the top account (manual mode).

## 2. Runtime model

One Node process, bound to `127.0.0.1:${PORT:-4747}`, run as a systemd **user** service.

```
┌──────────────────────── claude-swap (node) ────────────────────────┐
│ Engine (setInterval tick)   Hono API /api/*        Static SPA (dist)│
│   sync → refresh → poll →     JSON DTOs, no secrets   index.html is   │
│   decide → swap → record      Host/Origin guard       templated with  │
│                                                       theme + lang    │
└──────────┬───────────────────────────┬──────────────────────────────┘
           │ atomic JSON writes        │ HTTPS
   ~/.config/claude-swap/         api.anthropic.com/api/oauth/usage
     config.json  (prefs, accounts, order)   platform.claude.com/v1/oauth/token
     secrets.json (tokens, 0600)
     state.json   (usage snapshots, history, activity log)
   $CLAUDE_CONFIG_DIR or ~/.claude/.credentials.json  (Claude Code login, 0600)
   ~/.claude.json → oauthAccount  (Claude Code identity; other keys preserved)
```

The process is the **single writer** of all our files, so no file locks are needed; an in-process
async mutex serializes writes and engine ticks vs. API mutations.

Lightness budget: idle RSS < 80 MB, idle CPU ≈ 0 (one tick per poll interval). The SPA is static
files; heavy UI deps (Recharts, dnd-kit) never load in the server.

## 3. Claude Code integration (Linux)

Verified against Claude Code 2.1.329:

| What | Where / how |
| --- | --- |
| Login tokens | `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json` → `claudeAiOauth { accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier, … }` (other top-level keys like `mcpOAuth` must be preserved) |
| Identity | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) → `oauthAccount { accountUuid, emailAddress, organizationUuid, displayName, organizationName, … }` — file has ~70 other keys, preserve them all |
| Usage | `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20` → `five_hour {utilization, resets_at}`, `seven_day {…}`, `seven_day_opus`, `seven_day_sonnet`, `extra_usage`, … (`utilization` is 0–100). Parse tolerantly: unknown keys allowed, nullable windows. |
| Token refresh | `POST https://platform.claude.com/v1/oauth/token` JSON `{ grant_type: "refresh_token", refresh_token, client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }` → new access **and refresh** token (rotation!) |

All URLs are configurable via env (`CLAUDE_SWAP_API_BASE_URL`, `CLAUDE_SWAP_OAUTH_TOKEN_URL`) so
tests hit a mock server. Treat these endpoints as unofficial: isolate them in one adapter and
validate responses with zod.

### Swap procedure (atomic, idempotent)

1. **Sync back** the current live login: read `.credentials.json` + `oauthAccount`; if its
   `accountUuid` is one of ours, store its (possibly refreshed-by-Claude-Code) tokens in
   `secrets.json` first. Never lose a rotated refresh token.
2. Write target account's `claudeAiOauth` into `.credentials.json` (merge, keep other keys).
3. Write target's `oauthAccount` into `.claude.json` (merge, keep other keys).
4. Record a `swap` activity entry (from, to, reason: `auto-exhausted | auto-reset | manual`).

On first ever write, back up both Claude Code files to `~/.config/claude-swap/backups/`.

Running Claude Code sessions pick up new credentials when they re-read the file (new sessions
always do). Document this in the README.

### Token ownership rule

- The **active** account's tokens are owned by Claude Code: we only read them (sync back), never
  refresh them ourselves (avoid racing Claude Code's own rotation).
- **Inactive** accounts' tokens are owned by us: refresh when `expiresAt` is within 10 min,
  persist the new pair atomically before using it.
- A refresh failing with `invalid_grant` marks the account `needsReauth` (UI shows it; engine
  skips it).

### Adding an account

"Add account" modal explains the flow: run `claude` → `/login` with the account, then click
**Import current login**. We snapshot `claudeAiOauth` + `oauthAccount`, dedupe by
`accountUuid` (re-import = update tokens). Warn: use `/login` to switch, **not `/logout`**
(logout may revoke the stored token). Detect "unknown account is logged in" and offer import.

## 4. Code structure (hexagonal)

```
src/
  domain/            account.ts, usage.ts, rotation-policy.ts (selectActive), ordering.ts,
                     preferences.ts, errors.ts — pure, 100% unit-tested
  application/
    ports.ts         ConfigRepository, SecretsRepository, StateRepository,
                     ClaudeCodeSession (read/write live login), UsageApi, TokenRefresher,
                     Clock, Logger
    use-cases/       index.ts: importCurrentLogin, removeAccount, reorderAccounts, promoteAccount,
                     setAccountEnabled, renameAccount, updatePreferences, getDashboard
    testing/         in-memory fakes for every port (reused by server tests)
    engine.ts        tick(): sync → refresh → poll → decide → swap → record
  infrastructure/
    fs/              atomicWrite, jsonFile<T>(schema), paths (XDG + env overrides)
    repositories/    config/secrets/state JSON repos (+ schema version + migrations)
    claude-code/     credentials file + .claude.json adapter
    anthropic/       usage client, oauth refresher (fetch + timeout + zod)
    system/          clock, logger (console JSON lines), mutex
  server/
    container.ts     composition root (the only place that `new`s adapters)
    app.ts           Hono app: security middleware, routes, static + index.html templating
    routes/          accounts, dashboard, preferences, activity — zod-validated inputs
    dto.ts           domain → DTO (never includes tokens)
    main.ts          start engine + HTTP server, graceful shutdown (SIGTERM)
  web/
    main.tsx, router.tsx, routes/ (index, accounts.new modal, settings modal,
    accounts.$id.remove confirm modal), features/{dashboard,accounts,settings,activity},
    components/ui (shadcn), lib/{api.ts, query.ts}, i18n/
tests/e2e/           Playwright specs, fixtures (temp HOME), mock-anthropic server
deploy/              claude-swap.service (systemd user unit), install script
```

## 5. Data files (zod schemas, `version` field + migrations)

- `config.json`: `{ version, preferences: { theme: "light"|"dark"|"system", locale: "en"|"es"|"pt-BR", autoRotate, thresholds: { fiveHour: 95, sevenDay: 98 }, pollIntervalSec: 180 }, accounts: [{ id (=accountUuid), label, email, organizationName, subscriptionType, enabled, addedAt }] }` — array order **is** the priority.
- `secrets.json` (0600): `{ version, tokens: { [accountId]: claudeAiOauth } }`.
- `state.json`: `{ version, usage: { [accountId]: { fiveHour, sevenDay, fetchedAt, error? } }, history: [{ t, accountId, fiveHour, sevenDay }] (ring buffer ~7 days, downsampled), activity: [{ t, type, ... }] (last 200), lastActiveId }`.

Separating secrets from preferences keeps the user-editable config safe to open, share or diff.

## 6. UI (one screen + modal routes)

- **Header**: logo, engine status pill (auto/manual, next check), `Add account` button,
  `Settings` button, language select, theme toggle (top-right).
- **Top**: charts — utilization over time (5h & 7d) per account (area/line, shadcn chart),
  plus stat tiles (active account, time to next reset, swaps today).
- **Below**: ordered account list (drag handle + keyboard up/down), each row: priority #, name/email,
  plan badge, active badge, 5h % bar + reset countdown, 7d % bar + reset countdown,
  status (ok / exhausted / needs re-auth / disabled), `Use now`, enable switch, remove.
- Modals are **routes** (`/accounts/new`, `/settings`, `/accounts/:id/remove`) rendered over the
  dashboard (TanStack Router masking / layout outlet), so they are linkable and back-button safe.
- Theme + locale persist in `config.json`; the server injects `class="dark"` and `lang` into
  `index.html` → no flash. Data refresh: TanStack Query polling (10 s) while the tab is visible.
- Quality bar: DESIGN.md tokens, WCAG AA contrast in both themes, full keyboard support,
  `prefers-reduced-motion`, responsive down to 360 px.

## 7. Security

- Bind `127.0.0.1` only; reject requests whose `Host` is not `localhost|127.0.0.1:<port>`
  (DNS rebinding) and mutating requests whose `Origin` is present and not same-origin (CSRF).
- Secrets never leave the server; DTO mapper is the only path to the client and has a test
  asserting no token fields.
- No telemetry. Logs never include tokens (logger redacts keys matching /token/i).

## 8. Testing strategy

| Layer | Tool | What |
| --- | --- | --- |
| domain | Vitest | rotation policy table tests (exhaustion, reset, disabled, needsReauth, all exhausted → keep current / least-used) |
| application | Vitest + in-memory fakes | engine tick scenarios, swap ordering, sync-back, refresh rules |
| infrastructure | Vitest + temp dirs + stubbed fetch | atomic write, key preservation, schema migration, tolerant parsing |
| server | Vitest + `app.request()` | routes, validation, Host/Origin guard, DTO has no secrets |
| web | Vitest + Testing Library | components, i18n catalog parity (same keys in all locales) |
| e2e | Playwright + mock Anthropic server + temp HOME | import, reorder, auto-swap on 100 %, swap back on reset, theme/locale persistence |

## 9. Decisions log

- 2026-11-19 — **Hono + Vite SPA instead of Next.js**: always-on daemon must be light (~50 MB vs
  ~200 MB idle); a single dashboard needs no SSR. Modal routes via TanStack Router replace
  Next intercepting routes.
- 2026-11-19 — **Single process, single writer** for all JSON files (no locks, no IPC).
  Upgrade path: extract `engine` into its own process if ever needed (hexagonal core makes it trivial).
- 2026-11-19 — **Manual swap = reorder** (one source of truth).
- 2026-11-19 — **Secrets in a separate 0600 file**, preferences/accounts in `config.json`.
- 2026-11-19 — Linux file-based credentials only; macOS Keychain is a future `ClaudeCodeSession` adapter.
- 2026-11-19 — `graphify-out/` gitignored; refreshed by `graphify update .` and a post-commit hook.
- 2026-11-19 — **Biome 2** for lint + format + import sorting (one fast tool, no ESLint/Prettier).
  Markdown is excluded from Biome so docs keep their hand formatting.
- 2026-11-19 — **Layer boundaries are a Vitest test** (`src/architecture.test.ts`, regex import scan),
  not a lint rule: `domain` imports only `domain` (no packages, no `node:*` builtins);
  `application` imports only `domain`/`application` and packages; `web` imports `server` only via
  `import type` and no other layer.
- 2026-11-19 — **One `tsconfig.json`** for server, web and configs (TypeScript 7, `moduleResolution:
  bundler`, `paths` without `baseUrl`, `noEmit`). tsc only type-checks; Vite builds the SPA, tsup
  (esbuild) bundles the server with npm deps left external (`npm ci --omit=dev` needed at runtime).
- 2026-11-19 — **Exhaustion semantics** (`domain/usage.ts`): a window blocks only while
  `utilization >= threshold` **and** `resetsAt > now`; `resetsAt` null or ≤ now never blocks; a
  missing snapshot is "unknown", not exhausted. API "locked" state is not modelled separately
  (assumed to surface as utilization ≥ threshold).
- 2026-11-19 — **All exhausted, current not a candidate** → pick the account that *recovers* first,
  i.e. the smallest `exhaustedUntil` (latest reset among its blocking windows), ties keep priority
  order. `nextResetAt` (earliest reset of either window) stays a UI countdown helper only.
- 2026-11-19 — **Selection reasons** are derived by position vs. `currentId`: chosen above current →
  `auto-reset`, below → `auto-exhausted`; same account or unknown current → `top-priority` if it is
  the first candidate, else `auto-exhausted`. `autoRotate: false` → `manual`. The engine labels
  swaps caused by promote/reorder as `manual` itself (position alone reads them as `auto-reset`).
- 2026-11-19 — `AccountId` is a plain `string` alias (no brand); ordering ops clamp `toIndex` to
  the list bounds and throw `AccountNotFoundError` / `InvalidOrderError` (Error subclasses).
- 2026-11-19 — **Coverage**: `npm test` runs `vitest run --coverage` (v8); `src/domain/**` must stay
  at 100 % statements/branches/functions/lines. Domain test files may import packages (`vitest`).
- 2026-11-19 — **Persistence** (`infrastructure/fs`, `infrastructure/repositories`): every file is
  `{ version, ...body }`; a missing `version` means v0 and `migrate()` applies `migrations[v]`
  step by step. A file that fails JSON parse, migration (incl. a *newer* version than the code)
  or zod validation is renamed to `*.corrupt-<ISO ts>` and the default is returned (warn logged
  without file content). Dates are ISO strings on disk via a zod codec. All three files are
  written `0600`, new dirs `0700`; writes are serialized per file by a promise-queue mutex.
- 2026-11-19 — `needsReauth` is persisted on the account in `config.json` (default `false`), so a
  hand-edited or older config without it still loads. Preferences fill missing keys per field.
- 2026-11-19 — **Ports**: `ConfigRepository`/`StateRepository` are `load()`/`save()` of the whole
  document; `SecretsRepository` is keyed (`get/set/delete(accountId)`, read-modify-write under the
  file mutex). `OAuthTokens` requires `accessToken`, `refreshToken`, `expiresAt` (epoch ms) and
  keeps every other `claudeAiOauth` key.
- 2026-11-19 — **History ring buffer** (applied in `StateRepository.save`): drop points > 7 days,
  keep the *last* point per account per 15-min bucket once older than 24 h, hard cap 10 000 points;
  activity keeps the last 200 entries. Activity types: `swap {from, to, reason}` and
  `account-added | account-removed | needs-reauth | error {accountId?, message?}`.
- 2026-11-19 — **Claude Code adapter** (`infrastructure/claude-code`, `FileClaudeCodeSession`):
  a missing file **or** a missing `claudeAiOauth`/`oauthAccount` key reads as "not logged in"
  (`null`); invalid JSON, a non-object or a key failing its schema throws `ClaudeCodeFileError`
  (path + field names only, never content). `writeLogin` reads and validates both files first, so
  a malformed file is never overwritten; then backs up, writes `.credentials.json`, then
  `.claude.json`. Each file keeps its current mode (0600 when created) and a symlinked file is
  written through (`realpath`), not replaced. "First write ever" = `backups/` is missing or empty;
  the backup is `backups/<ISO ts with - for :.>/{.credentials.json,.claude.json}` (0600, only the
  files that exist). Writes are serialized by the adapter's own mutex. `claudeAiOauth` reuses the
  secrets `oauthTokensSchema`; `CLAUDE_CONFIG_DIR=""` counts as unset.
- 2026-11-19 — **Anthropic client** (`infrastructure/anthropic`, `AnthropicClient` implements both
  `UsageApi` and `TokenRefresher`): `TokenRefresher.refresh` takes the whole previous
  `OAuthTokens` (not just the refresh token) so the result is `{ ...previous, accessToken,
  refreshToken, expiresAt, scopes? }`: `subscriptionType`, `rateLimitTier` and other keys are kept,
  a missing `refresh_token` keeps the old one, `scope` (space-separated) replaces `scopes` only when
  present. Typed errors live in `application/anthropic-errors.ts` so the engine can branch on them
  (`UnauthorizedError` 401, `InvalidGrantError` 400 `invalid_grant`, `RateLimitedError` 429 with
  `retryAfter` in **seconds** from delta-seconds or HTTP-date, `null` if absent/unparseable,
  `NetworkError` fetch rejection incl. the 10 s timeout, `BadResponseError` any other status, non-JSON
  or zod failure). Error messages carry status, error name or zod field paths only — never bodies,
  headers or the original error/cause. 401/429 apply to both endpoints. `User-Agent` is
  `claude-swap/<package.json version>` (JSON import, bundled). Empty env URL overrides count as unset.
- 2026-11-19 — **Identity snapshot**: each account in `config.json` stores the full `oauthAccount`
  (`StoredAccount = Account & { oauthAccount }`, loose schema, every key kept) captured at import, so
  a swap writes Claude Code's identity back unchanged (`organizationUuid`, `displayName`, …). Not a
  secret; tokens stay in `secrets.json`. Required field at schema v1 (no released data yet).
- 2026-11-19 — **Use cases** (`application/use-cases/index.ts`) run under the shared mutex, then call
  `engine.runNow()` without awaiting it (API responses never wait for a tick). Promote, reorder,
  enable/disable and remove pass `{ manual: true }` so a resulting swap is labelled `manual`;
  import and preference updates run a plain tick; rename does not run the engine. Re-import keeps
  label/order/enabled and clears `needsReauth`; only a new account logs `account-added`.
- 2026-11-19 — **Engine** (`application/engine.ts`): a tick loads config + state once, saves once at
  the end (config only if `needsReauth` changed); any throw becomes an `error` activity + log and the
  tick still resolves. The next tick is a `setTimeout` of the *current* `pollIntervalSec` after each
  tick, so a preference change applies after the tick `updatePreferences` triggers. `runNow` is
  debounced 250 ms (bursts coalesce; `manual` sticks if any caller asked).
- 2026-11-19 — **Unknown login**: a live login whose `accountUuid` is not ours sets
  `status().unknownLogin` (its email) and the engine **does not swap** while it is live, so the
  "/login then Import" flow is never overwritten. Exception: the id equals `lastActiveId` (we wrote
  it and the account was removed since) → replaced normally, its tokens are not re-stored.
- 2026-11-19 — **Torn swap** (credentials written, identity not): detected when the live refresh token
  equals another of our accounts' stored one; that login is not synced back and is treated as
  "no current account", so the next tick rewrites both files in full. Sync-back runs again right
  before every swap write.
- 2026-11-19 — **Polling**: enabled, non-`needsReauth` accounts with tokens, 2 at a time. On error the
  last snapshot is kept with `error` set (or an all-null snapshot if none); history gets a point only
  for successful polls. 429 → no polls for that account until `now + retryAfter` (default 600 s),
  in-memory only. Refresh covers every non-live, non-`needsReauth` account (disabled too, to keep its
  refresh token alive); other refresh errors are logged and retried next tick. A fresh `/login` of a
  `needsReauth` account (new refresh token seen at sync-back) clears the flag. A 401 on poll does not
  force a refresh (the 10-min window handles normal expiry).
- 2026-11-19 — **Logger** (`infrastructure/system/logger.ts`, `JsonLogger`): one JSON line per call
  (`{t, level, msg, ...fields}`; `error` to stderr). Fields are deep-redacted: keys matching
  `/token|secret|authorization|password|cookie/i` → `[redacted]`, and `sk-ant-…` / `Bearer …`
  substrings are masked in any string (message included). `Error` values log as `{name, message}`.
- 2026-11-19 — **HTTP API** (`server/app.ts`): Host must be `localhost:<port>` or `127.0.0.1:<port>`
  (checked on the request URL, which node-server builds from `Host`) → else 403 `forbidden-host`.
  Non-GET/HEAD/OPTIONS with an `Origin` other than `http://<request host>` → 403 `forbidden-origin`
  (`Origin: null` included; no Origin = non-browser client, allowed). Errors are JSON
  `{ error: <code> }`: `validation` (400, + `issues[{path,message}]`, never the input),
  `bad-request` (400, malformed JSON), `invalid-order` (400), `account-not-found` (404),
  `not-logged-in` (409), `claude-code-file` (409), `not-found` (404 under `/api`), `internal` (500,
  logged redacted). Mutations answer `{ ok: true }` (200; `POST /engine/run` 202, `POST
  /accounts/import` 201 with the account DTO). `PATCH /accounts/:id` takes `label` (trimmed, 1–100)
  and/or `enabled`; `PATCH /preferences` is a strict partial (`thresholds` whole, poll 10–86400 s).
  All routes live in `app.ts` (one small router); split into `server/routes/` only if it grows.
- 2026-11-19 — **DTO** (`server/dto.ts`): explicit field picks, dates as ISO strings; accounts drop
  `oauthAccount` entirely. `engine.unknownLogin` (email or null) is exposed as-is: the UI shows
  "unknown login, import it?" and knows the engine is not swapping while it is set.
- 2026-11-19 — **Static**: `dist/web` (default `../web` next to the bundled `main.js`, override with
  `CLAUDE_SWAP_WEB_DIR`). `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`, a miss
  is 404 (never the SPA); other files `no-cache`; every other GET returns `index.html` (`no-cache`)
  with `<html lang="<locale>">` plus `class="dark"` only for `theme: dark` (`system` is resolved
  client-side). No build → 503. `secureHeaders()` defaults only; no CSP yet (T08/T13 may add one).
- 2026-11-19 — **Dev proxy**: Vite proxies `/api` with `changeOrigin` and rewrites a same-origin
  (`http://<vite host>`) `Origin` to the API origin, so the guard needs no dev exception.
- 2026-11-19 — **Runtime** (`server/main.ts`): binds `127.0.0.1:${PORT:-4747}`, logs `listening`
  then starts the engine; SIGINT/SIGTERM stop the engine, close the server and force-exit after 5 s.
