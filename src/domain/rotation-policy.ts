import { type Account, type AccountId, isCandidate } from './account'
import type { Thresholds } from './preferences'
import { exhaustedUntil, isExhausted, type UsageSnapshot } from './usage'

export type SelectionReason =
  | 'top-priority'
  | 'auto-exhausted'
  | 'auto-reset'
  | 'manual'
  | 'all-exhausted'

export interface Selection {
  readonly id: AccountId
  readonly reason: SelectionReason
}

export interface SelectionInput {
  /** Priority order: index 0 is the highest priority. */
  readonly accounts: readonly Account[]
  readonly usage: Readonly<Record<AccountId, UsageSnapshot>>
  readonly thresholds: Thresholds
  readonly now: Date
  readonly autoRotate: boolean
  /** Account currently logged into Claude Code, if known. */
  readonly currentId: AccountId | null
}

/** Picks the account that should be active, or null when no account can be used. */
export function selectActiveAccount(input: SelectionInput): Selection | null {
  const { accounts, usage, thresholds, now, autoRotate, currentId } = input
  const candidates = accounts.filter(isCandidate)
  const [first] = candidates
  if (!first) return null
  if (!autoRotate) return { id: first.id, reason: 'manual' }

  const available = candidates.find((account) => !isExhausted(usage[account.id], thresholds, now))
  if (!available) {
    const current = candidates.find((account) => account.id === currentId)
    return { id: (current ?? earliestToRecover(candidates, input)).id, reason: 'all-exhausted' }
  }
  return { id: available.id, reason: reasonFor(available, first, input) }
}

/** Candidate whose blocking windows all reset first; ties keep priority order. */
function earliestToRecover(candidates: readonly Account[], input: SelectionInput): Account {
  const blockedUntil = (account: Account) =>
    Number(exhaustedUntil(input.usage[account.id], input.thresholds, input.now))
  return candidates.reduce((best, account) =>
    blockedUntil(account) < blockedUntil(best) ? account : best,
  )
}

function reasonFor(chosen: Account, first: Account, input: SelectionInput): SelectionReason {
  const chosenIndex = input.accounts.indexOf(chosen)
  const currentIndex = input.accounts.findIndex((account) => account.id === input.currentId)
  if (currentIndex === -1 || currentIndex === chosenIndex) {
    return chosen === first ? 'top-priority' : 'auto-exhausted'
  }
  return chosenIndex < currentIndex ? 'auto-reset' : 'auto-exhausted'
}
