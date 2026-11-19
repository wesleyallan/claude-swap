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
    use-cases/       importCurrentLogin, removeAccount, reorderAccounts, promoteAccount,
                     setAccountEnabled, updatePreferences, getDashboard
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
