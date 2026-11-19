# T04 — Claude Code session adapter

Skills: `tdd`, `vitest`. Spec: architecture §3.

## Do
- Port `ClaudeCodeSession` in `application/ports.ts`: `readCurrentLogin(): Promise<{ oauth, account } | null>`, `writeLogin(oauth, account): Promise<void>`.
- Adapter `infrastructure/claude-code/`:
  - paths: `$CLAUDE_CONFIG_DIR/.credentials.json` and `$CLAUDE_CONFIG_DIR/.claude.json` when the env var is set, else `~/.claude/.credentials.json` and `~/.claude.json`.
  - zod schemas: `claudeAiOauth` (required: accessToken, refreshToken, expiresAt; passthrough others), `oauthAccount` (required: accountUuid, emailAddress; passthrough).
  - write = read whole file → replace only our key → atomic write, preserving permissions (credentials 0600) and **every other key** (`mcpOAuth`, the ~70 keys of `.claude.json`).
  - first write ever → copy both originals to `<CLAUDE_SWAP_HOME>/backups/<ts>/`.
  - missing files → `null` (not logged in).
- Fixtures under `src/infrastructure/claude-code/__fixtures__/` with **fake** tokens, mirroring the real shape (copy key names, never values).

## Tests
Key preservation (deep-equal of untouched keys), mode preservation, CLAUDE_CONFIG_DIR handling, backup created once, malformed file → typed error.

## Done when
Green + commit `feat(claude-code): add credentials session adapter`.
