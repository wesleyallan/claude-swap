# T13 — Final review & hardening

## Do
- Run the `code-review` and `security-review` skills over the whole codebase; fix confirmed findings (each fix test-first).
- `web-design-guidelines` review of the UI; fix issues. Final Playwright MCP screenshot pass (light/dark × 3 locales × desktop/mobile).
- Verify layer-boundary rule, no TODOs without a `shortcut:` note, no dead code, no unused deps (`npx knip` or equivalent, don't add it as a dep if not needed).
- `graphify update . --force` then regenerate the report; make sure AGENTS.md/CLAUDE.md/architecture.md match reality.
- Final `npm run check && npm run test:e2e && npm run build`.

## Done when
All green; commits `fix: ...`/`refactor: ...`/`docs: ...`; final report lists residual risks.
