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

  const available = candidates.find((a) => !isExhausted(usage[a.id], thresholds, now))
  if (!available) {
    const current = candidates.find((a) => a.id === currentId)
    return { id: (current ?? earliestToRecover(candidates, input)).id, reason: 'all-exhausted' }
  }
  return { id: available.id, reason: reasonFor(available, first, input) }
}

/** Candidate whose blocking windows all reset first; ties keep priority order. */
function earliestToRecover(candidates: readonly Account[], input: SelectionInput): Account {
  const until = (a: Account) =>
    Number(exhaustedUntil(input.usage[a.id], input.thresholds, input.now))
  return candidates.reduce((best, a) => (until(a) < until(best) ? a : best))
}

function reasonFor(chosen: Account, first: Account, input: SelectionInput): SelectionReason {
  const chosenIdx = input.accounts.indexOf(chosen)
  const currentIdx = input.accounts.findIndex((a) => a.id === input.currentId)
  if (currentIdx === -1 || currentIdx === chosenIdx) {
    return chosen === first ? 'top-priority' : 'auto-exhausted'
  }
  return chosenIdx < currentIdx ? 'auto-reset' : 'auto-exhausted'
}
