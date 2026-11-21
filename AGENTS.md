# AGENTS.md — claude-swap

Instructions for any AI coding agent (Claude Code, Codex, Cursor, etc.) working in this repo.
Keep this file short and true. If something here is wrong, fix it in the same change.

## What this project is

**claude-swap** is a local-only hub that manages several Claude (claude.ai) accounts for
**Claude Code**. The user registers accounts and orders them by priority. A background engine
keeps exactly one account active in Claude Code and:

- **auto-swaps** to the next account when the active one exhausts its **5-hour** or **weekly** limit;
- **swaps back up** to a higher-priority account as soon as its limit resets;
- supports **manual swap**: promoting an account (changing the order) makes it active.

It runs as **one lightweight Node process** (systemd user service, target < 100 MB RSS idle) that
hosts the engine and a small JSON API, and serves a static React SPA. The web UI is optional —
the engine works with no browser open. No database: all state lives in JSON files.

Full design: [`docs/architecture.md`](docs/architecture.md). Work plan: [`docs/tasks/`](docs/tasks/README.md).
Visual language: [`DESIGN.md`](DESIGN.md). Developer docs in the app: `/doc-dev` (not linked; type the URL).

## Stack

- Server: Node 24 + **Hono** (`@hono/node-server`), TypeScript `strict`, bundled with tsup
- Web: **Vite + React SPA**, **TanStack Router** (modal routes) + **TanStack Query** (polling,
  mutations), typed API calls via Hono RPC client (`hc`)
- Tailwind CSS v4 + shadcn/ui (charts = shadcn chart/Recharts, drag & drop = dnd-kit),
  design tokens from `DESIGN.md`, light/dark themes
- **use-intl** for i18n — locales: `en` (default/source), `es`, `pt-BR`
- zod for every external boundary (config files, Claude Code files, HTTP responses)
- Biome (lint + format + import sorting); TypeScript 7 (`tsc --noEmit` only)
- Vitest (projects `node` + `jsdom`) + Testing Library (unit/integration), Playwright (e2e, chromium)
- npm (no pnpm/yarn). Node 24.

Before using any library API, fetch current docs with the **context7** MCP — do not trust memory
for Hono, Vite, TanStack Router/Query, use-intl, Tailwind v4, shadcn, dnd-kit, Playwright or Vitest.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev (API + Vite with HMR) | `npm run dev` |
| Production | `npm run build && npm run start` |
| Lint / format check | `npm run lint` (fix: `npm run format`) |
| Type check | `npm run typecheck` |
| Unit + integration tests (+ coverage, 100 % on `src/domain`) | `npm test` (watch: `npm run test:watch`) |
| E2E tests (builds first) | `npm run test:e2e` |
| Everything CI runs | `npm run check` |
| Bundle size + idle RSS budget | `npm run perf:budget` |
| systemd user service | `npm run service:install` / `service:uninstall` (never in tests) |

`npm run check` must pass before every commit. (Commands exist from task T01 on.)

## Architecture (hexagonal, dependencies point inward)

```
src/
  domain/          Pure TS. Entities, value objects, rotation policy. No I/O, no Node, no React.
  application/     Use cases + engine orchestration. Depends on domain + port interfaces only.
  infrastructure/  Adapters implementing ports: JSON file stores, Claude Code credential store,
                   Anthropic HTTP client, clock, logger.
  server/          Composition root (container.ts), main.ts, Hono app + routes, DTO mappers,
                   static SPA serving. Thin: validate input, call a use case, map to DTO.
  web/             React SPA: router.tsx (code-based routes), components/ (ui/ = shadcn
                   primitives, add with `npx shadcn@latest add <name>`), features/,
                   lib/api.ts (Hono RPC client), i18n/messages/{en,es,pt-BR}.json,
                   features/docs (user guide modal), features/dev-docs (/doc-dev page)
tests/e2e/         Playwright specs + mock Anthropic API server
deploy/            systemd user unit template
scripts/           service install/uninstall, perf budget (run with node / tsx)
```

Rules:

- `domain` imports nothing outside `domain`. `application` never imports `infrastructure`.
  Wiring happens only in `src/server/container.ts`.
- Business rules (which account is active, thresholds, reset handling) live in `domain` as pure
  functions with exhaustive unit tests. Never put them in components or route handlers.
- Time is injected (`Clock` port). Never call `Date.now()` in domain/application.
- All file writes are atomic (write temp → fsync → rename) with mode `0600` for secrets.
- These rules are enforced by `src/architecture.test.ts` (part of `npm test`).
- `web/` imports from `server/` **types only** (`import type`, for the RPC client). It never
  imports domain/infrastructure runtime code.
- Keep the server lean: no heavy deps in the daemon; everything UI-only stays in `web/`.

## Security — non-negotiable

- OAuth tokens are secrets. Never log them, never send them to the browser (DTOs strip them),
  never commit them, never paste them in test fixtures (use obviously fake values).
- The server binds to `127.0.0.1` only. Mutating endpoints validate `Host`/`Origin`
  (DNS-rebinding/CSRF protection).
- **Tests must never read or write the real `~/.claude`, `~/.claude.json` or `~/.config/claude-swap`.**
  Always point `CLAUDE_CONFIG_DIR` and `CLAUDE_SWAP_HOME` at a temp dir, and the Anthropic base
  URL at the mock server.
- Writing Claude Code's files must preserve every key we do not own.

## Testing

- TDD for domain and application code: red → green → refactor (see the `tdd` skill).
- Every bug fix starts with a failing test.
- Unit tests sit next to code (`foo.ts` → `foo.test.ts`). E2E lives in `tests/e2e/`.
- Use the Playwright MCP or `playwright-cli` for exploratory checks and screenshots
  (light + dark, en/es/pt-BR, mobile width) on UI tasks.

## Git

- Conventional Commits, **English**, one-line subject (≤ 72 chars, imperative), optional body.
  Types: `feat fix refactor test docs chore build ci perf style`. Scope = layer or feature,
  e.g. `feat(domain): add rotation policy`.
- **No `Co-Authored-By` trailer** (project owner's rule; overrides tool defaults).
- One logical change per commit; commit at each meaningful milestone of a task.
- Never commit secrets, `graphify-out/`, `.env*`, test artifacts.

## Knowledge graph (graphify)

`graphify-out/` holds a code knowledge graph (gitignored, rebuilt locally).

- Before broad searches, check `graphify-out/GRAPH_REPORT.md` or run
  `graphify query "<question>"` / `graphify explain "<Symbol>"` — far cheaper than reading many files.
- After finishing a task: `graphify update .` (AST only, no LLM). Use `--force` after deletions.
- A git post-commit hook (`graphify hook install`) also keeps it fresh.

## Skills

Canonical copies live in `.agents/skills/`; `.claude/skills/*` are symlinks to them
(edit only `.agents/skills`). Managed with `npx skills` (`skills-lock.json`).
Most relevant: `tdd`, `vitest`, `vercel-react-best-practices`,
`vercel-composition-patterns`, `shadcn`, `design-taste-frontend`, `ui-ux-pro-max`,
`web-design-guidelines`, `playwright-best-practices`, `playwright-cli`, `graphify`.

## Keep the docs current

`README.md` and the developer page `/doc-dev` (`src/web/features/dev-docs/content/{en,es,pt-BR}.md`)
describe the system as it is. A change to the stack, structure, API routes, engine, data files or
security model updates both **in the same change**, in all three locales. User-facing behaviour also
updates the in-app docs (`src/web/features/docs/content/`).

## Working on a task

1. Read the task file in `docs/tasks/` and `docs/architecture.md`.
2. Read only the code the task touches (graphify first).
3. Tests first, then the smallest code that passes, then refactor.
4. `npm run check` green → commit(s) → `graphify update .` → tick the task in `docs/tasks/README.md`.
5. If a decision is not covered by the docs, record it in `docs/architecture.md` (Decisions log).
