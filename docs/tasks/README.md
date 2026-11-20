# Tasks

Run in order. Each task runs in a **fresh subagent** and must leave the repo green and committed.
Read `AGENTS.md` and `docs/architecture.md` first; the architecture doc is the spec.

| # | Task | Status |
| --- | --- | --- |
| T01 | [Scaffold & tooling](T01-scaffold.md) | [x] |
| T02 | [Domain model & rotation policy](T02-domain.md) | [x] |
| T03 | [File persistence & repositories](T03-persistence.md) | [x] |
| T04 | [Claude Code session adapter](T04-claude-code-adapter.md) | [x] |
| T05 | [Anthropic usage & OAuth client](T05-anthropic-client.md) | [x] |
| T06 | [Use cases & rotation engine](T06-engine.md) | [x] |
| T07 | [HTTP server (Hono) & runtime](T07-server.md) | [x] |
| T08 | [Web foundation: design system, theme, i18n, router](T08-web-foundation.md) | [x] |
| T09 | [Dashboard: charts & sortable account list](T09-dashboard.md) | [x] |
| T10 | [Modal routes: add account, settings, remove](T10-modals.md) | [x] |
| T11 | [End-to-end test suite](T11-e2e.md) | [x] |
| T12 | [Service install, README & performance budget](T12-deploy.md) | [ ] |
| T13 | [Final review & hardening](T13-review.md) | [ ] |

## Protocol for every task

1. Read: `AGENTS.md`, `docs/architecture.md`, this task file, `graphify-out/GRAPH_REPORT.md` (if it exists).
2. Use **context7** for every library API you touch. Load the skills the task lists.
3. TDD: write the failing test, make it pass, refactor. No untested logic.
4. Never touch the real `~/.claude`, `~/.claude.json`, `~/.config/claude-swap` (temp dirs + env vars).
5. `npm run check` green (from T01 on).
6. Commit with Conventional Commits, English, one-line subject, optional body, **no Co-Authored-By**.
   Several commits per task are fine (one per logical step).
7. `graphify update .` (add `--force` if files were deleted) and confirm it succeeded.
8. Tick the task here (`[x]`), add any new decision to `docs/architecture.md` §9, and update
   `AGENTS.md` if commands/structure changed. Commit as `docs(tasks): complete TNN`.
9. Final message: what was done, commits created, anything deferred or risky.

If something is genuinely ambiguous and changes the outcome, stop and report the question instead
of guessing.
