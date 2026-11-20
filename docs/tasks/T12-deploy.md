# T12 — Service install, README & performance budget

## Do
- `deploy/claude-swap.service` (systemd **user** unit: `ExecStart=node <repo>/dist/server/main.js`, `Restart=on-failure`, `Environment=PORT=4747`, hardening options that work for user units).
- `npm run service:install` / `service:uninstall` scripts (copy unit to `~/.config/systemd/user`, `daemon-reload`, `enable --now`). Never run them in tests.
- Optional CLI flags on `main.ts`: `--port`, `--open` (no extra deps; `util.parseArgs`).
- Performance budget script `npm run perf:budget`: start built server with temp env, wait 30 s, assert RSS < 100 MB (was 80 MB; raised in T12, see architecture §9) and record web bundle sizes (initial JS < 200 kB gzip, charts lazy). Fix if over.
- `README.md` (English): what/why, screenshots (light + dark), install, add accounts flow, how swap works, limitations (running sessions, unofficial endpoints, Linux only), config file locations & format, security notes, development commands.
- `LICENSE` only if the user wants one (ask in final report, do not invent).

## Done when
Green + commits `build(deploy): ...`, `docs: ...`.
