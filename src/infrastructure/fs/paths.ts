import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

/** `$CLAUDE_SWAP_HOME`, else `$XDG_CONFIG_HOME/claude-swap`, else `~/.config/claude-swap`. */
export function resolveSwapHome(env: Env = process.env, home: string = homedir()): string {
  if (env.CLAUDE_SWAP_HOME) return env.CLAUDE_SWAP_HOME
  // XDG spec: a relative XDG_CONFIG_HOME is invalid and must be ignored.
  const xdg = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : null
  return join(xdg ?? join(home, '.config'), 'claude-swap')
}

export function swapPaths(home: string) {
  return {
    home,
    config: join(home, 'config.json'),
    secrets: join(home, 'secrets.json'),
    state: join(home, 'state.json'),
    backups: join(home, 'backups'),
  }
}
