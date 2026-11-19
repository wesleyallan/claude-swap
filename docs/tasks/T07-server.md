# T07 — HTTP server (Hono) & runtime

Skills: `tdd`, `vitest`. Use context7 for Hono (RPC types, `app.request` testing, serve-static, node-server).

## Do
- `server/container.ts`: build real adapters from env; export `createContainer(overrides?)` so tests inject fakes.
- `server/app.ts` (`createApp(container)`):
  - middleware: Host allow-list (`localhost`, `127.0.0.1` + port), Origin check on non-GET, JSON error handler (no stack traces/tokens), `secureHeaders`.
  - routes under `/api` with zod validation (`@hono/zod-validator`): `GET /dashboard`, `POST /accounts/import`, `PATCH /accounts/:id` (label, enabled),
    `DELETE /accounts/:id`, `PUT /accounts/order`, `POST /accounts/:id/promote`, `GET|PATCH /preferences`, `POST /engine/run`, `GET /health`.
  - export `type AppType` for the Hono RPC client.
  - static: serve `dist/web` with long cache for hashed assets; SPA fallback returns `index.html` with `lang` and theme class injected from preferences.
- `server/dto.ts` + test proving DTOs contain no token fields (recursive key scan).
- `server/main.ts`: listen on `127.0.0.1:${PORT:-4747}`, start engine, graceful shutdown on SIGINT/SIGTERM (stop engine, close server), structured log line on start.

## Tests
`app.request()` tests for every route (happy + validation error), Host/Origin rejection, SPA fallback templating, health.

## Done when
`npm run build && PORT=4799 CLAUDE_SWAP_HOME=<tmp> CLAUDE_CONFIG_DIR=<tmp> npm start` serves `/api/health`. Commits `feat(server): ...`.
