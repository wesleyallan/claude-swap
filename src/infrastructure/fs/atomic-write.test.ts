import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite } from './atomic-write'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-atomic-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const modeOf = async (p: string) => (await stat(p)).mode & 0o777

describe('atomicWrite', () => {
  it('creates missing dirs as 0700 and the file as 0600 by default', async () => {
    const file = join(dir, 'a', 'b', 'f.json')
    await atomicWrite(file, '{"x":1}')
    expect(await readFile(file, 'utf8')).toBe('{"x":1}')
    expect(await modeOf(file)).toBe(0o600)
    expect(await modeOf(join(dir, 'a'))).toBe(0o700)
    expect(await modeOf(join(dir, 'a', 'b'))).toBe(0o700)
  })

  it('honours the mode option and tightens an existing file', async () => {
    const file = join(dir, 'f.json')
    await writeFile(file, 'old', { mode: 0o644 })
    await atomicWrite(file, 'new', { mode: 0o640 })
    expect(await readFile(file, 'utf8')).toBe('new')
    expect(await modeOf(file)).toBe(0o640)
    await atomicWrite(file, 'newer')
    expect(await modeOf(file)).toBe(0o600)
  })

  it('leaves no temp files behind, even on failure', async () => {
    await atomicWrite(join(dir, 'f.json'), 'x')
    // renaming a file over a directory fails after the temp file was written
    await mkdir(join(dir, 'sub'))
    await expect(atomicWrite(join(dir, 'sub'), 'y')).rejects.toThrow()
    expect((await readdir(dir)).sort()).toEqual(['f.json', 'sub'])
  })
})
