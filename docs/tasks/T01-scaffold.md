# T01 — Scaffold & tooling

Skills: `vitest`, `playwright-best-practices`, `shadcn` (read only for later setup notes).

## Do
- `package.json` (npm, `"type": "module"`, `engines.node >= 24`), TypeScript strict
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), path alias `@/* → src/*`.
- Folder skeleton from `docs/architecture.md` §4 (empty `index.ts` only where needed — no placeholder code).
- Server toolchain: `hono`, `@hono/node-server`, `zod`; dev: `tsx` (watch), `tsup` (bundle `src/server/main.ts` → `dist/server`).
- Web toolchain: Vite + `@vitejs/plugin-react`, React 19, Tailwind v4 (`@tailwindcss/vite`), root `src/web`, output `dist/web`.
  Vite dev proxy `/api` → server port.
- Lint/format: **Biome** (single fast tool) with import sorting; or ESLint flat + Prettier if Biome lacks a needed rule — record the choice.
  Add a lint rule or a tiny test that enforces layer boundaries (domain imports nothing outside domain, application never imports infrastructure, web imports server only via `import type`).
- Vitest with two projects: `node` (domain/application/infrastructure/server) and `jsdom` (web) + Testing Library.
- Playwright installed (chromium only), `playwright.config.ts` skeleton, `tests/e2e/` dir.
- Scripts: `dev` (server watch + vite concurrently), `build`, `start` (`node dist/server/main.js`), `lint`, `format`,
  `typecheck`, `test`, `test:watch`, `test:e2e`, `check` (= lint + typecheck + test).
- `.editorconfig`, `.nvmrc` (24), confirm `.gitignore` covers dist, coverage, playwright artifacts, graphify-out.
- One smoke unit test per Vitest project so `npm run check` is meaningful.
- First graph build: `graphify update .`.

## Done when
`npm ci && npm run check && npm run build` pass. Commits e.g. `build: scaffold vite + hono project`, `test: configure vitest and playwright`.
