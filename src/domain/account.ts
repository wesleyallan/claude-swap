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
