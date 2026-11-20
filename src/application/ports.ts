import type { Account, AccountId } from '@/domain/account'
import type { Preferences } from '@/domain/preferences'
import type { SelectionReason } from '@/domain/rotation-policy'
import type { UsageSnapshot } from '@/domain/usage'

export interface Clock {
  now(): Date
}

export type LogFields = Readonly<Record<string, unknown>>

export interface Logger {
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

/** Serializes async critical sections (engine ticks vs. API mutations, file writes). */
export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** A registered account plus the Claude Code identity snapshot written back on swap. */
export interface StoredAccount extends Account {
  readonly oauthAccount: OAuthAccount
}

/** `config.json`: array order of `accounts` is the priority. */
export interface AppConfig {
  readonly preferences: Preferences
  readonly accounts: readonly StoredAccount[]
}

export interface ConfigRepository {
  load(): Promise<AppConfig>
  save(config: AppConfig): Promise<void>
}

/** Claude Code's `claudeAiOauth` object; keys we do not model are kept as-is. */
export interface OAuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  /** Epoch milliseconds. */
  readonly expiresAt: number
  readonly [key: string]: unknown
}

export interface SecretsRepository {
  get(id: AccountId): Promise<OAuthTokens | null>
  set(id: AccountId, tokens: OAuthTokens): Promise<void>
  delete(id: AccountId): Promise<void>
}

export interface HistoryPoint {
  readonly t: Date
  readonly accountId: AccountId
  /** Utilization 0–100, null when the window is unknown. */
  readonly fiveHour: number | null
  readonly sevenDay: number | null
}

export type ActivityEntry =
  | {
      readonly t: Date
      readonly type: 'swap'
      readonly from: AccountId | null
      readonly to: AccountId
      readonly reason: SelectionReason
    }
  | {
      readonly t: Date
      readonly type: 'account-added' | 'account-removed' | 'needs-reauth' | 'error'
      readonly accountId?: AccountId
      readonly message?: string
    }

export interface AppState {
  readonly usage: Readonly<Record<AccountId, UsageSnapshot>>
  /** Oldest first. */
  readonly history: readonly HistoryPoint[]
  /** Oldest first. */
  readonly activity: readonly ActivityEntry[]
  readonly lastActiveId: AccountId | null
}

/** `save` compacts history and activity (caps + downsampling) before writing. */
export interface StateRepository {
  load(): Promise<AppState>
  save(state: AppState): Promise<void>
}

/** Claude Code's `oauthAccount` (identity in `.claude.json`); keys we do not model are kept. */
export interface OAuthAccount {
  readonly accountUuid: string
  readonly emailAddress: string
  readonly [key: string]: unknown
}

export interface ClaudeCodeLogin {
  readonly oauth: OAuthTokens
  readonly account: OAuthAccount
}

/** The live Claude Code login. Writes replace only our keys and keep every other one. */
export interface ClaudeCodeSession {
  /** `null` when Claude Code is not logged in (files or keys missing). */
  readCurrentLogin(): Promise<ClaudeCodeLogin | null>
  writeLogin(oauth: OAuthTokens, account: OAuthAccount): Promise<void>
}

/** Anthropic OAuth usage endpoint. Rejects with an `AnthropicApiError`. */
export interface UsageApi {
  fetchUsage(accessToken: string): Promise<UsageSnapshot>
}

/**
 * Anthropic OAuth token endpoint. Takes the whole previous `claudeAiOauth` value (its refresh
 * token is used; keys the response lacks, such as `subscriptionType`, are kept). The refresh token
 * rotates: persist the result before using it. Rejects with an `AnthropicApiError`.
 */
export interface TokenRefresher {
  refresh(previous: OAuthTokens): Promise<OAuthTokens>
}
