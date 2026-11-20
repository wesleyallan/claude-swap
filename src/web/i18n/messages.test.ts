import { expect, it } from 'vitest'
import { messages } from '.'

/** Dotted paths of every leaf, failing on empty strings. */
function leaves(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix + k
    if (typeof v === 'object' && v !== null) return leaves(v, `${path}.`)
    expect(v, path).toEqual(expect.stringMatching(/\S/))
    return [path]
  })
}

it('every catalog has the same keys as en and no empty values', () => {
  const source = leaves(messages.en).sort()
  for (const [locale, catalog] of Object.entries(messages)) {
    expect(leaves(catalog).sort(), locale).toEqual(source)
  }
})
