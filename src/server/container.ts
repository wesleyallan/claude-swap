// Composition root: the only place that instantiates adapters. Tests pass `overrides` (fakes).
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type EngineControl } from '@/application/engine'
import type { Logger, TokenRefresher, UsageApi } from '@/application/ports'
import type { UseCaseDeps } from '@/application/use-cases'
import { AnthropicClient, anthropicEndpoints } from '@/infrastructure/anthropic/anthropic-client'
import {
  claudeCodePaths,
  FileClaudeCodeSession,
} from '@/infrastructure/claude-code/claude-code-session'
import { resolveSwapHome, swapPaths } from '@/infrastructure/fs/paths'
import {
  JsonConfigRepository,
  JsonSecretsRepository,
  JsonStateRepository,
} from '@/infrastructure/repositories/repositories'
import { SystemClock } from '@/infrastructure/system/clock'
import { JsonLogger } from '@/infrastructure/system/logger'
import { PromiseMutex } from '@/infrastructure/system/mutex'

export interface RunnableEngine extends EngineControl {
  start(): void
  stop(): Promise<void>
}

export interface Container extends UseCaseDeps {
  readonly logger: Logger
  readonly usageApi: UsageApi
  readonly refresher: TokenRefresher
  readonly engine: RunnableEngine
  readonly port: number
  /** Directory holding the built SPA (`index.html` + `assets/`). */
  readonly webRoot: string
}

type Env = Readonly<Record<string, string | undefined>>

/** Bundled to `dist/server/main.js`, so the SPA built by Vite sits at `../web`. */
const defaultWebRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '../web')

export function createContainer(
  overrides: Partial<Container> = {},
  env: Env = process.env,
): Container {
  const clock = overrides.clock ?? new SystemClock()
  const logger = overrides.logger ?? new JsonLogger(clock)
  const paths = swapPaths(resolveSwapHome(env))
  const repo = (path: string) => ({ path, logger, clock })
  const client = new AnthropicClient({ ...anthropicEndpoints(env), clock })
  const base = {
    clock,
    logger,
    config: overrides.config ?? new JsonConfigRepository(repo(paths.config)),
    secrets: overrides.secrets ?? new JsonSecretsRepository(repo(paths.secrets)),
    state: overrides.state ?? new JsonStateRepository(repo(paths.state)),
    session:
      overrides.session ??
      new FileClaudeCodeSession({ ...claudeCodePaths(env), backups: paths.backups, clock }),
    usageApi: overrides.usageApi ?? client,
    refresher: overrides.refresher ?? client,
    mutex: overrides.mutex ?? new PromiseMutex(),
  }
  return {
    ...base,
    engine: overrides.engine ?? new Engine(base),
    port: overrides.port ?? Number(env.PORT || 4747),
    webRoot: overrides.webRoot ?? env.CLAUDE_SWAP_WEB_DIR ?? defaultWebRoot(),
  }
}
