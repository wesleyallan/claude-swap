import { describe, expect, it } from 'vitest'
import { AccountNotFoundError, InvalidOrderError } from './errors'
import { applyOrder, moveAccount, promoteAccount } from './ordering'

const list = Object.freeze(['a', 'b', 'c', 'd'].map((id) => Object.freeze({ id })))
const ids = (l: readonly { id: string }[]) => l.map((x) => x.id)

describe('moveAccount', () => {
  it.each<[string, number, string[]]>([
    ['a', 2, ['b', 'c', 'a', 'd']],
    ['d', 0, ['d', 'a', 'b', 'c']],
    ['b', 1, ['a', 'b', 'c', 'd']],
    ['b', 3, ['a', 'c', 'd', 'b']],
    ['c', 99, ['a', 'b', 'd', 'c']],
    ['c', -5, ['c', 'a', 'b', 'd']],
  ])('move %s to %i', (id, to, expected) => {
    const out = moveAccount(list, id, to)
    expect(ids(out)).toEqual(expected)
    expect(out).not.toBe(list)
    expect(new Set(out)).toEqual(new Set(list)) // same objects, nothing lost or duplicated
  })

  it('throws AccountNotFoundError for an unknown id', () => {
    expect(() => moveAccount(list, 'x', 0)).toThrow(AccountNotFoundError)
  })
})

describe('promoteAccount', () => {
  it('moves the account to the top and keeps the rest in order', () => {
    expect(ids(promoteAccount(list, 'c'))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('throws for an unknown id', () => {
    expect(() => promoteAccount(list, 'x')).toThrow(new AccountNotFoundError('x'))
  })
})

describe('applyOrder', () => {
  it('reorders to the given ids and returns the same objects', () => {
    const out = applyOrder(list, ['d', 'b', 'a', 'c'])
    expect(ids(out)).toEqual(['d', 'b', 'a', 'c'])
    expect(out[0]).toBe(list[3])
  })

  it.each<[string, string[]]>([
    ['missing id', ['a', 'b', 'c']],
    ['extra id', ['a', 'b', 'c', 'd', 'e']],
    ['unknown id', ['a', 'b', 'c', 'x']],
    ['duplicate id', ['a', 'b', 'c', 'c']],
  ])('rejects %s', (_, order) => {
    expect(() => applyOrder(list, order)).toThrow(InvalidOrderError)
  })
})
