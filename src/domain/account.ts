import type { Thresholds } from './preferences'
import { isExhausted, type UsageSnapshot } from './usage'

/** Claude account UUID (`oauthAccount.accountUuid`). */
export type AccountId = string

export interface Account {
  readonly id: AccountId
  readonly label: string
  readonly email: string
  readonly organizationName: string | null
  readonly subscriptionType: string | null
  readonly enabled: boolean
  readonly needsReauth: boolean
  readonly addedAt: Date
}

/** An account the engine may make active: enabled and with usable tokens. */
export const isCandidate = (a: Account): boolean => a.enabled && !a.needsReauth

/** What the dashboard shows for an account, most important state first. */
export type AccountStatus = 'ok' | 'exhausted' | 'needs-reauth' | 'disabled' | 'unknown'

export function accountStatus(
  a: Account,
  snapshot: UsageSnapshot | undefined,
  thresholds: Thresholds,
  now: Date,
): AccountStatus {
  if (!a.enabled) return 'disabled'
  if (a.needsReauth) return 'needs-reauth'
  if (isExhausted(snapshot, thresholds, now)) return 'exhausted'
  return snapshot?.fiveHour || snapshot?.sevenDay ? 'ok' : 'unknown'
}
