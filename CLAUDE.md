# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Skills: `.claude/skills/*` are symlinks to `.agents/skills/*`. Add skills with
  `npx skills add <owner/repo@skill> -a claude-code -y`, then move the new folder to
  `.agents/skills/` and replace it with a relative symlink (`ln -s ../../.agents/skills/<name>`).
- MCPs to use: **context7** (library docs, always before using a library API),
  **playwright** (e2e exploration, screenshots of light/dark and each locale).
- For broad exploration prefer `graphify query` / `graphify explain` over many Grep/Read calls.
- When running tasks from `docs/tasks/`, one subagent per task (fresh context). The subagent
  commits its own work; the orchestrator only verifies and moves on.
- Never run the app or tests against the real `~/.claude`; see the Security section above.
- Commits: no `Co-Authored-By` trailer, no "Generated with Claude Code" line.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
