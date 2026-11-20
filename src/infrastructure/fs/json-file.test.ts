import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'
import { JsonFile, type JsonFileOptions } from './json-file'

const date = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})
const schema = z.object({ count: z.number(), at: date.nullable() })

let dir: string
let path: string
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const clock = { now: () => new Date('2026-11-19T10:00:00.000Z') }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-json-'))
  path = join(dir, 'f.json')
  vi.clearAllMocks()
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const file = (extra: Partial<JsonFileOptions<typeof schema>> = {}) =>
  new JsonFile({
    path,
    schema,
    version: 1,
    defaults: () => ({ count: 0, at: null }),
    logger,
    clock,
    ...extra,
  })

describe('JsonFile', () => {
  it('returns the default when the file is missing, without creating it', async () => {
    expect(await file().read()).toEqual({ count: 0, at: null })
    expect(await readdir(dir)).toEqual([])
  })

  it('round-trips typed values with a version field, 0600', async () => {
    const f = file()
    await f.write({ count: 2, at: new Date('2026-01-01T00:00:00.000Z') })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      count: 2,
      at: '2026-01-01T00:00:00.000Z',
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await f.read()).toEqual({ count: 2, at: new Date('2026-01-01T00:00:00.000Z') })
  })

  it('two concurrent reads of a corrupt file both return the default', async () => {
    await writeFile(path, '{nope')
    const f = file()
    expect(await Promise.all([f.read(), f.read()])).toEqual([
      { count: 0, at: null },
      { count: 0, at: null },
    ])
  })

  it.each([
    ['invalid JSON', '{nope'],
    ['a schema mismatch', '{"version":1,"count":"x","at":null}'],
    ['a newer version', '{"version":9,"count":1,"at":null}'],
  ])('backs up a file with %s, warns and returns the default', async (_, content) => {
    await writeFile(path, content)
    expect(await file().read()).toEqual({ count: 0, at: null })
    const backup = join(dir, 'f.json.corrupt-2026-11-19T10-00-00-000Z')
    expect(await readdir(dir)).toEqual(['f.json.corrupt-2026-11-19T10-00-00-000Z'])
    expect(await readFile(backup, 'utf8')).toBe(content)
    expect(logger.warn).toHaveBeenCalledWith(
      'corrupt JSON file moved aside',
      expect.objectContaining({ path, backup }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(content)
  })

  it('migrates an old file on read', async () => {
    await writeFile(path, '{"n":5}')
    const f = file({ migrations: { 0: (d) => ({ count: d.n, at: null }) } })
    expect(await f.read()).toEqual({ count: 5, at: null })
  })

  it('serializes concurrent updates (no lost writes)', async () => {
    const f = file()
    await Promise.all(
      Array.from({ length: 20 }, () => f.update((v) => ({ ...v, count: v.count + 1 }))),
    )
    expect((await f.read()).count).toBe(20)
    expect(await readdir(dir)).toEqual(['f.json'])
  })

  it('refuses to write an invalid value', async () => {
    await expect(file().write({ count: 'x' as unknown as number, at: null })).rejects.toThrow()
  })

  it('surfaces read errors other than a missing file', async () => {
    await expect(file({ path: dir }).read()).rejects.toThrow()
  })
})
