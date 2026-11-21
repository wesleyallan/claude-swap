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

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const HISTORY_MAX_AGE_MS = 7 * 24 * HOUR_MS
const RECENT_HISTORY_MS = 24 * HOUR_MS
const RECENT_BUCKET_MS = 3 * MINUTE_MS
const OLD_BUCKET_MS = 15 * MINUTE_MS
export const ACTIVITY_CAP = 200

/**
 * Usage history (oldest first) bounded by time, not by count: the newest point per account per
 * 3-minute bucket for the last 24 h, per 15-minute bucket up to 7 days, nothing older. So each
 * account keeps at most ~1 060 points whatever the poll interval.
 */
export function compactHistory(points: readonly HistoryPoint[], now: Date): HistoryPoint[] {
  const kept: HistoryPoint[] = []
  const seenBuckets = new Set<string>()
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i] as HistoryPoint
    const age = now.getTime() - point.t.getTime()
    if (age > HISTORY_MAX_AGE_MS) continue
    const bucketMs = age > RECENT_HISTORY_MS ? OLD_BUCKET_MS : RECENT_BUCKET_MS
    const bucket = `${point.accountId}@${bucketMs}@${Math.floor(point.t.getTime() / bucketMs)}`
    if (seenBuckets.has(bucket)) continue
    seenBuckets.add(bucket)
    kept.push(point)
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
