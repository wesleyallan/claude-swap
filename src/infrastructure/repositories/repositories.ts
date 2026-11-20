import type {
  AppConfig,
  AppState,
  Clock,
  ConfigRepository,
  HistoryPoint,
  Logger,
  OAuthTokens,
  SecretsRepository,
  StateRepository,
} from '@/application/ports'
import type { AccountId } from '@/domain/account'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'
import { JsonFile } from '../fs/json-file'
import { configSchema, SCHEMA_VERSION, secretsSchema, stateSchema } from './schemas'

export interface RepoDeps {
  readonly path: string
  readonly logger: Logger
  readonly clock: Clock
}

export class JsonConfigRepository implements ConfigRepository {
  readonly #file: JsonFile<typeof configSchema>

  constructor(deps: RepoDeps) {
    this.#file = new JsonFile({
      ...deps,
      schema: configSchema,
      version: SCHEMA_VERSION,
      defaults: () => ({ preferences: DEFAULT_PREFERENCES, accounts: [] }),
    })
  }

  load(): Promise<AppConfig> {
    return this.#file.read()
  }

  save(config: AppConfig): Promise<void> {
    return this.#file.write({ ...config, accounts: [...config.accounts] })
  }
}

export class JsonSecretsRepository implements SecretsRepository {
  readonly #file: JsonFile<typeof secretsSchema>

  constructor(deps: RepoDeps) {
    this.#file = new JsonFile({
      ...deps,
      schema: secretsSchema,
      version: SCHEMA_VERSION,
      mode: 0o600,
      defaults: () => ({ tokens: {} }),
    })
  }

  async get(id: AccountId): Promise<OAuthTokens | null> {
    return (await this.#file.read()).tokens[id] ?? null
  }

  async set(id: AccountId, tokens: OAuthTokens): Promise<void> {
    await this.#file.update((s) => ({ tokens: { ...s.tokens, [id]: tokens } }))
  }

  async delete(id: AccountId): Promise<void> {
    await this.#file.update(({ tokens: { [id]: _, ...rest } }) => ({ tokens: rest }))
  }
}

const HOUR = 3_600_000
export const HISTORY_MAX_AGE_MS = 7 * 24 * HOUR
export const HISTORY_FULL_RES_MS = 24 * HOUR
export const HISTORY_BUCKET_MS = 15 * 60_000
export const HISTORY_CAP = 10_000
export const ACTIVITY_CAP = 200

/**
 * Ring buffer for usage history (oldest first): drops points older than 7 days, keeps the last
 * point per account per 15-min bucket once older than 24 h, then keeps the newest HISTORY_CAP.
 */
export function compactHistory(points: readonly HistoryPoint[], now: Date): HistoryPoint[] {
  const kept: HistoryPoint[] = []
  const buckets = new Set<string>()
  for (let i = points.length - 1; i >= 0 && kept.length < HISTORY_CAP; i--) {
    const p = points[i] as HistoryPoint
    const age = now.getTime() - p.t.getTime()
    if (age > HISTORY_MAX_AGE_MS) continue
    if (age > HISTORY_FULL_RES_MS) {
      const key = `${p.accountId}@${Math.floor(p.t.getTime() / HISTORY_BUCKET_MS)}`
      if (buckets.has(key)) continue
      buckets.add(key)
    }
    kept.push(p)
  }
  return kept.reverse()
}

export class JsonStateRepository implements StateRepository {
  readonly #file: JsonFile<typeof stateSchema>
  readonly #clock: Clock

  constructor(deps: RepoDeps) {
    this.#clock = deps.clock
    this.#file = new JsonFile({
      ...deps,
      schema: stateSchema,
      version: SCHEMA_VERSION,
      defaults: () => ({ usage: {}, history: [], activity: [], lastActiveId: null }),
    })
  }

  load(): Promise<AppState> {
    return this.#file.read()
  }

  save(state: AppState): Promise<void> {
    return this.#file.write({
      ...state,
      usage: { ...state.usage },
      history: compactHistory(state.history, this.#clock.now()),
      activity: state.activity.slice(-ACTIVITY_CAP),
    })
  }
}
