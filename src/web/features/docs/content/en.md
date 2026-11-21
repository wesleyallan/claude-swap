## Overview

**Claude Swap** keeps **Claude Code** logged into the best of several Claude (claude.ai) accounts.

You add your accounts and put them in priority order. A small background service keeps exactly one of them active in Claude Code and:

- **swaps down** to the next account when the active one reaches its **5-hour** or **weekly** limit;
- **swaps back up** to a higher-priority account as soon as its limit resets;
- lets you **swap by hand** with **Use now** or by reordering the list.

Everything runs on your machine: one process bound to `127.0.0.1`, JSON files for state, no database, no telemetry. This dashboard is optional — the engine keeps working with no browser open.


## Lightweight by design

Claude Swap is meant to make a developer's day simpler, not to add one more thing to maintain.

- **Nothing extra to install**: Node.js and the app itself. No database, no Docker, no queue, no cloud account.
- **One small process**: the engine, the API and this dashboard share one Node process that stays under 100 MB of memory when idle.
- **Plain files**: settings and state are JSON files you can read (and back up) by hand.
- **Local only**: it listens on `127.0.0.1`, talks only to Anthropic's own endpoints and sends no telemetry.

Install it once, add your accounts, and forget about it.

## Getting started

1. In a terminal, run `claude`, then `/login` and sign in with the first account.
2. Here, click **Add account**, optionally give it a name, and click **Import current login**.
3. Repeat for each account you want Claude Swap to manage.
4. Drag the accounts into the order you prefer. The top one is used first.

> Switch accounts in Claude Code with `/login`, **never `/logout`**: logging out can revoke the login Claude Swap keeps for that account.

## The dashboard

- **Active account** — the account Claude Code is using right now. The browser tab shows its name too.
- **Next reset** — when the next 5-hour or weekly window of any account resets.
- **Swaps in 24 h** — how many automatic or manual swaps happened in the last day.
- **Engine** — *Automatic* swaps on limits, *Manual* stays on the top account, *Paused* means Claude Code is logged into an account that is not in your list.
- **Usage over time** — 5-hour usage for the last 24 hours and weekly usage for the last 7 days, one line per account.
- **Accounts by priority** — every account with its 5-hour and weekly usage bars, reset times and status.

The engine status next to the logo shows when the next check runs.

## Priority and swapping

The list order **is** the priority. The active account is the first one that:

- is **enabled**;
- does not **need a re-login**;
- has not **reached a limit**.

When the active account reaches a limit, the next eligible account takes over. When a higher account's window resets, Claude Swap moves back up to it. If every account is at a limit, it picks the one that frees up first.

**Use now** moves an account to the top, which makes it active. Dragging (mouse or keyboard) and the up/down buttons change the order the same way. The switch toggle on each card turns an account off without removing it.

## Limits and checks

Each account has two usage windows, measured by Anthropic:

| Window | Meaning |
| --- | --- |
| **5 h** | Rolling five-hour session limit |
| **7 d** | Weekly limit |

An account counts as *limit reached* when either window is at or above its threshold (95 % and 98 % by default) and has not reset yet. Swapping a little before 100 % keeps a running prompt from hitting the hard limit.

Every **check interval** (3 minutes by default) the engine reads usage for each account, refreshes the tokens of inactive accounts before they expire, and picks the active account again. Changing the order, enabling an account or clicking **Use now** runs a check right away. The **Force check** button (the circular arrow in the top bar) does the same on demand and restarts the interval countdown, so two checks never run back to back.

## Settings

| Setting | What it does |
| --- | --- |
| **Theme** | Light, dark or follow the system |
| **Language** | English, Español or Português (Brasil) |
| **Swap automatically** | Off keeps Claude Code on the top account until you change the order |
| **5-hour limit (%)** | Usage share of the 5-hour window that triggers a swap (50–100) |
| **Weekly limit (%)** | Same, for the weekly window (50–100) |
| **Check every (seconds)** | How often usage is fetched (60–3600) |

## Running sessions

A swap writes the chosen account's login into Claude Code's files (`~/.claude/.credentials.json` and `~/.claude.json`), keeping every other key.

- **New sessions** always start with the active account.
- **Open sessions** switch when Claude Code reads its credentials again — for example when its token is refreshed or a request is rejected. Your conversation stays where it is.
- If a prompt hits the limit before the swap happens, Claude Code stops that turn with a limit message. Once the swap is done, send `continue` (or repeat the request) in the same session.

Keeping the thresholds below 100 % makes the swap happen before the hard limit, so this is rare.

## Troubleshooting

- **Needs re-login** — the saved token stopped working. Run `/login` with that account and import it again.
- **Swapping is paused** — Claude Code is logged into an account that is not in your list. Import it, or `/login` with one of yours.
- **The last engine check failed** — usage could not be read (network, rate limit). The engine retries on the next check.
- **Server unreachable** — the service is stopped. Check it with `systemctl --user status claude-swap` and read logs with `journalctl --user -u claude-swap -f`.

## Privacy and security

- The server listens on `127.0.0.1` only and rejects cross-site requests.
- OAuth tokens stay on disk (mode `0600`). They are never sent to the browser and never logged.
- The only outbound calls go to Anthropic's usage and token endpoints. No telemetry.
- Files live in `~/.config/claude-swap` (or `$CLAUDE_SWAP_HOME`). Never share `secrets.json`.

## About me

Hi, I'm **Wesley Silva** (wesleyallan), the developer behind Claude Swap.

Thank you for using my software! I built it to stop losing my train of thought every time a limit ran out, and I hope it saves you that trouble too.

If Claude Swap helps you, please **give the project a ⭐ on [GitHub](https://github.com/wesleyallan/claude-swap)**. It helps other people find it and keeps me motivated to improve it. Bug reports and ideas are welcome there as well.

Find me on:

- [GitHub](https://github.com/wesleyallan)
- [LinkedIn](https://www.linkedin.com/in/wesley-silva-229724208/)
- [Instagram](https://www.instagram.com/wesleyallansilva)
- [Facebook](https://facebook.com/wesley.allansilva)
- [Discord](https://discord.gg/hQN2k8N6jf)
- [E-mail](mailto:wesley.allansilva@gmail.com)
