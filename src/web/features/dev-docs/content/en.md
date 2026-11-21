## Overview

This page is for developers: what Claude Swap is built with, why, and how the pieces fit. The user guide lives in the dashboard's **Documentation** modal; the design spec and the full decisions log live in `docs/architecture.md`.

Claude Swap keeps **Claude Code** logged into the best of several Claude accounts. Three ideas shaped every decision:

- **Light and local.** One Node process on `127.0.0.1`, under 100 MB of memory when idle. No database, no Docker, no cloud service: nothing to install besides Node.js.
- **The order is the truth.** The account list order is the priority, and a manual swap is just a reorder. Automatic and manual modes can never disagree.
- **Never lose a token.** Claude Code rotates refresh tokens. Every write is atomic, and the live login is always saved back before it is replaced.

## Tech stack

| Layer | Technology | Why |
| --- | --- | --- |
| Runtime | **Node.js 24** | Ships `fetch`, `CompressionStream`, `AbortSignal.timeout` and file APIs, so the server needs very few dependencies. |
| HTTP | **Hono** + `@hono/node-server` | A few kB, fast, and typed end to end: the web app calls the API through Hono's RPC client with no code generation. Chosen over Next.js because an always-on daemon must stay small and one dashboard needs no SSR. |
| Validation | **zod 4** | Every boundary (config files, Claude Code files, Anthropic responses, request bodies) is parsed, never trusted. Codecs turn ISO strings into `Date` and back. |
| Build | **tsup** (server), **Vite** (web) | tsup bundles the server and its dependencies into one file, so the service does not need `node_modules`. Vite gives HMR in development and hashed, cacheable assets in production. |
| UI | **React 19** | Mature, well-known, and the ecosystem below is built for it. |
| Routing | **TanStack Router** | Type-safe, code-based routes. Modals are routes, so they are linkable and back-button safe. |
| Server state | **TanStack Query** | Polling, caching, optimistic mutations with rollback, and pausing while the tab is hidden. |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (Base UI) | Design tokens from `DESIGN.md` as CSS variables, light and dark themes, accessible primitives we own as source. |
| Charts / drag & drop | **Recharts** (shadcn chart), **dnd-kit** | The two heaviest UI libraries, both loaded lazily outside the initial bundle. dnd-kit brings keyboard drag and screen reader announcements. |
| i18n | **use-intl** | ICU messages (plurals, relative time) in `en`, `es` and `pt-BR`, typed keys. |
| Quality | **TypeScript 7** (strict), **Biome**, **Vitest**, **Testing Library**, **Playwright** | One fast tool for lint and format; unit, integration and end-to-end tests with no real accounts. |

## Architecture

The code follows a **hexagonal architecture** (ports and adapters). Dependencies point inward:

```
web ──(types only)──▶ server ──▶ application ──▶ domain
                         │             ▲
                         └──▶ infrastructure (implements application ports)
```

- **domain** — pure TypeScript: accounts, usage windows, the rotation policy, ordering. No I/O, no Node, no React, 100 % test coverage.
- **application** — the engine and the use cases. Talks to the outside world only through **ports** (interfaces in `ports.ts`): repositories, the Claude Code session, the Anthropic API, clock, logger, mutex.
- **infrastructure** — **adapters** that implement those ports: JSON file repositories, the Claude Code files, the Anthropic HTTP client, the system clock and logger.
- **server** — the **composition root** (`container.ts`, the only place that instantiates adapters), the Hono routes and the DTO mappers.
- **web** — the React SPA. It imports server code as types only, to type the RPC client.

These rules are not just a convention: `src/architecture.test.ts` scans every import and fails the build when a layer reaches where it should not. Time is injected through the `Clock` port, so business code never calls `Date.now()` and every scenario is testable.

## Project structure

```
src/
  domain/          account, usage, rotation-policy, ordering, preferences, errors
  application/     ports.ts, engine.ts, use-cases/, testing/ (in-memory fakes)
  infrastructure/
    fs/            atomic write, versioned JSON file, migrations, paths
    repositories/  config, secrets and state repositories + zod schemas
    claude-code/   reads and writes Claude Code's login files
    anthropic/     usage endpoint and OAuth token refresh
    system/        clock, JSON logger with redaction, promise mutex
  server/          main.ts, cli.ts, container.ts, app.ts (routes), dto.ts
  web/             router, providers, features/, components/ui (shadcn), lib/, i18n/
tests/e2e/         Playwright specs, temp-HOME fixtures, mock Anthropic server
deploy/            systemd user unit template
scripts/           service install/uninstall, performance budget
```

Unit tests sit next to the code they test (`foo.ts` → `foo.test.ts`).

## The engine

The engine runs one **tick** every poll interval (3 minutes by default). A tick works on an in-memory copy of the config and state and saves it once at the end:

1. **Sync back** — read Claude Code's live login. If it is one of ours, store its tokens (Claude Code may have rotated them). An unknown login pauses swapping until it is imported.
2. **Refresh** — inactive accounts' tokens belong to us: refresh any that expire in the next 10 minutes. The active account's tokens belong to Claude Code and are never refreshed by us, to avoid racing its own rotation.
3. **Poll** — fetch the usage of every enabled account, two at a time. A 401 on an inactive account triggers one refresh and retry; a 429 backs that account off.
4. **Decide** — the pure `selectActiveAccount` function picks the account that should be active.
5. **Swap** — if it is not the live one, re-sync the live tokens, write the target's login into Claude Code's files and record the swap.

Ticks and API mutations share one **mutex**, so they never interleave. Calls to `runNow()` are **debounced** (250 ms), so a burst of clicks becomes one tick. Every tick reschedules the next one a full interval later, so **Force check** restarts the countdown. It calls `checkNow()`, which joins a tick already in flight instead of queueing a second one right behind it. Reorder, Use now and enable call `runNow()` instead: they need a tick that starts after their change.

## Claude Code integration

Claude Code on Linux keeps its login in two files:

| File | Key we own | Contents |
| --- | --- | --- |
| `~/.claude/.credentials.json` | `claudeAiOauth` | access token, refresh token, expiry, scopes |
| `~/.claude.json` | `oauthAccount` | account UUID, email, organization |

A swap replaces only those two keys and keeps every other key byte for byte. Both files are read and validated before anything is written, so a malformed file is never overwritten. The original files are backed up once, before the first write. A "torn" swap (credentials of one account under the identity of another) is detected and rewritten in full.

## Persistence

There is no database: three JSON files under `~/.config/claude-swap` hold everything.

- `config.json` — preferences and accounts. Array order is the priority.
- `secrets.json` — OAuth tokens per account, mode `0600`, kept apart so the config is safe to open or share.
- `state.json` — the latest usage per account, usage history and the activity log.

Every file has a `version` field and a migration chain, and is parsed with zod. Writes are **atomic**: temp file → fsync → rename → fsync the directory. A file that does not parse is moved aside as `*.corrupt-<time>` and replaced with defaults instead of crashing the service.

History is bounded **by time, not by count**: one point per account per 3 minutes for the last 24 hours, one per 15 minutes up to 7 days. Its size stays the same whatever the poll interval or the number of accounts.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /api/dashboard` | Preferences, accounts with status, latest usage, activity, engine status |
| `GET /api/history` | Usage history for the chart |
| `GET /api/accounts/current` | Who Claude Code is logged in as right now |
| `POST /api/accounts/import` | Import the current Claude Code login |
| `PUT /api/accounts/order` | Reorder (manual swap) |
| `POST /api/accounts/:id/promote` | Use now: move to the top |
| `PATCH /api/accounts/:id` | Rename, enable or disable |
| `DELETE /api/accounts/:id` | Remove an account and its tokens |
| `GET`/`PATCH /api/preferences` | Read or change settings |
| `POST /api/engine/run` | Force a check (joins one already running); answers when it is done |

Routes stay thin: validate the input with zod, call a use case, map the result to a DTO. The DTO mappers pick every field explicitly, so tokens can never reach the browser (a test asserts it). Every response goes through a **Host/Origin guard** (DNS rebinding and CSRF protection), a strict same-origin Content-Security-Policy and **gzip** compression. `index.html` is templated with the saved theme and language, so the page never flashes the wrong theme.

## Web app

- **One screen plus modal routes.** `/settings`, `/docs`, `/accounts/new` and `/accounts/:id/remove` render over the dashboard. This page (`/docs-dev`) is the only full page outside it, opened from the code icon next to the close button of the Documentation modal.
- **Polling.** The dashboard is fetched every 10 seconds while the tab is visible. The history only changes when the engine finishes a check, so its query is keyed on `engine.lastTickAt` and is fetched once per check.
- **Optimistic updates.** Reorder, Use now, enable and settings update the cache at once, roll back with a toast when the request fails, and refetch when they settle.
- **Bundle budget.** The initial JavaScript must stay under 200 kB gzip. Modals, the chart, drag & drop and the language menu are lazy chunks.
- **i18n and themes.** Every string lives in `i18n/messages/{en,es,pt-BR}.json` (a test checks that all locales have the same keys). Light and dark themes come from the `DESIGN.md` tokens.
- **Accessibility.** Full keyboard support, drag with the keyboard, screen reader announcements, WCAG AA contrast in both themes, `prefers-reduced-motion`.

## Design patterns

| Pattern | Where |
| --- | --- |
| Ports and adapters | `application/ports.ts` interfaces, implemented in `infrastructure/` |
| Composition root / dependency injection | `server/container.ts`; tests pass fakes through `overrides` |
| Repository | `JsonConfigRepository`, `JsonSecretsRepository`, `JsonStateRepository` |
| Use case functions | `application/use-cases`: plain functions over a `deps` object |
| Pure policy | `domain/rotation-policy.ts`: same input, same choice, table-tested |
| Unit of work | an engine tick edits one copy of the state and saves it once |
| DTO mapper | `server/dto.ts`, the only path from server data to the browser |
| Mutex and debounce | one async mutex for ticks and mutations; `runNow()` coalesces bursts |
| Routes as modals | `components/route-modal.tsx` |
| Optimistic UI | `useDashboardMutation` in `web/lib/query.ts` |

## Testing and quality

| Level | Tools | What it covers |
| --- | --- | --- |
| Domain | Vitest | rotation policy tables, exhaustion and reset rules (100 % coverage) |
| Application | Vitest + in-memory fakes | engine scenarios, sync back, refresh rules, use cases |
| Infrastructure | Vitest + temp dirs + stubbed `fetch` | atomic writes, key preservation, migrations, tolerant parsing |
| Server | Vitest + `app.request()` | routes, validation, guards, compression, DTOs without secrets |
| Web | Vitest + Testing Library | screens, modals, optimistic updates, locale parity |
| End to end | Playwright + mock Anthropic API | import, reorder, auto-swap, swap back, errors, accessibility (axe) |

Tests never touch the real `~/.claude` or `~/.config/claude-swap`: they point `HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_SWAP_HOME` at temp dirs and the Anthropic URLs at a mock server. `npm run check` (lint, types, tests) must pass before every commit, and `npm run perf:budget` checks the bundle size and the idle memory.

## How it was built

1. **Spec first.** `docs/architecture.md` describes the goal, the runtime, the Claude Code integration, the structure and the security model before any code.
2. **Small tasks.** The work was split into thirteen tasks (`docs/tasks/T01`–`T13`): scaffold, domain, persistence, Claude Code adapter, Anthropic client, engine, server, web foundation, dashboard, modals, end-to-end tests, deployment and a final review.
3. **Test-driven.** Each task went red → green → refactor, and every bug fix starts with a failing test.
4. **Decisions are written down.** Anything the spec did not cover is recorded with its reason in the decisions log (`docs/architecture.md` §9).
5. **Agent-friendly.** `AGENTS.md` holds the rules for any coding agent; a knowledge graph (`graphify`) helps navigate the code.

## Keeping this page current

This page and the `README.md` describe the system as it is. A change to the stack, the structure, the API, the engine or the data files must update both in the same change (the rule is in `AGENTS.md`). Open it from the code icon in the Documentation modal or at `/docs-dev`. It follows the language chosen in the app.
