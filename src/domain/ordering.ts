import { AccountNotFoundError, InvalidOrderError } from './errors'

type WithId = { readonly id: string }

/** Returns a new list with `id` moved to `toIndex` (clamped to the list bounds). */
export function moveAccount<T extends WithId>(
  list: readonly T[],
  id: string,
  toIndex: number,
): T[] {
  const from = list.findIndex((a) => a.id === id)
  if (from === -1) throw new AccountNotFoundError(id)
  const rest = list.filter((_, i) => i !== from)
  const to = Math.min(Math.max(toIndex, 0), rest.length)
  return [...rest.slice(0, to), list[from] as T, ...rest.slice(to)]
}

/** Manual swap: move `id` to the top (highest priority). */
export const promoteAccount = <T extends WithId>(list: readonly T[], id: string): T[] =>
  moveAccount(list, id, 0)

/** Returns the list reordered to `ids`, which must be exactly the same set of ids. */
export function applyOrder<T extends WithId>(list: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(list.map((a) => [a.id, a]))
  if (ids.length !== list.length || new Set(ids).size !== ids.length) throw new InvalidOrderError()
  return ids.map((id) => {
    const item = byId.get(id)
    if (!item) throw new InvalidOrderError()
    return item
  })
}
