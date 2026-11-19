# T03 — File persistence & repositories

Skills: `tdd`, `vitest`.

## Do
- `infrastructure/fs/paths.ts`: resolve `CLAUDE_SWAP_HOME` (default `$XDG_CONFIG_HOME/claude-swap` → `~/.config/claude-swap`).
- `infrastructure/fs/atomic-write.ts`: temp file in same dir → write → fsync → rename; `mode` option (0600 for secrets/state); create dir 0700.
- `infrastructure/fs/json-file.ts`: typed read/write with a zod schema; missing file → default; corrupt file → move to `*.corrupt-<ts>` and return default + log a warning (never crash, never silently overwrite without a backup).
- Schemas + `version` + migration runner (start at v1, test the runner with a fake v0 → v1).
- `application/ports.ts`: define `ConfigRepository`, `SecretsRepository`, `StateRepository` (+ `Clock`, `Logger`, `Mutex` if not yet there).
- Implementations in `infrastructure/repositories/` per architecture §5. State repo keeps history as a ring buffer (cap + downsample older than 24 h to 15 min buckets) and activity log capped at 200.
- `infrastructure/system/mutex.ts` (tiny promise-queue mutex) + tests.

## Tests
Temp dirs only. File modes asserted (0600/0700). Concurrent writes serialized. Corrupt file recovery. Migration.

## Done when
`npm run check` green; commits `feat(infra): ...`.
