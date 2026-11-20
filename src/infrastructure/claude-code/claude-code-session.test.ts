import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OAuthAccount, OAuthTokens } from '@/application/ports'
import { ClaudeCodeFileError, claudeCodePaths, FileClaudeCodeSession } from './claude-code-session'

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const fixture = async (name: string) =>
  JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as Record<string, unknown>

const clock = { now: () => new Date('2026-11-19T10:00:00.000Z') }
const TS = '2026-11-19T10-00-00-000Z'

const oauth: OAuthTokens = {
  accessToken: 'fake-access-token-new',
  refreshToken: 'fake-refresh-token-new',
  expiresAt: 1_950_000_000_000,
  subscriptionType: 'pro',
}
const account: OAuthAccount = {
  accountUuid: '00000000-0000-4000-8000-000000000002',
  emailAddress: 'new@example.test',
  displayName: 'New Fake',
}

let dir: string
let cfg: string
let paths: { credentials: string; claudeJson: string }
let backups: string

const session = () => new FileClaudeCodeSession({ ...paths, backups, clock })
const readJson = async (p: string) =>
  JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>
const modeOf = async (p: string) => (await stat(p)).mode & 0o777

async function installFixtures() {
  await mkdir(cfg, { recursive: true })
  await copyFile(join(FIXTURES, 'credentials.json'), paths.credentials)
  await copyFile(join(FIXTURES, 'claude.json'), paths.claudeJson)
  await chmod(paths.credentials, 0o600)
  await chmod(paths.claudeJson, 0o644)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-cc-'))
  cfg = join(dir, 'claude')
  paths = claudeCodePaths({ CLAUDE_CONFIG_DIR: cfg }, join(dir, 'home'))
  backups = join(dir, 'swap', 'backups')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('claudeCodePaths', () => {
  it('uses $CLAUDE_CONFIG_DIR for both files when set', () => {
    expect(claudeCodePaths({ CLAUDE_CONFIG_DIR: '/c' }, '/home/u')).toEqual({
      credentials: '/c/.credentials.json',
      claudeJson: '/c/.claude.json',
    })
  })

  it('falls back to ~/.claude/.credentials.json and ~/.claude.json (empty var = unset)', () => {
    const expected = {
      credentials: '/home/u/.claude/.credentials.json',
      claudeJson: '/home/u/.claude.json',
    }
    expect(claudeCodePaths({}, '/home/u')).toEqual(expected)
    expect(claudeCodePaths({ CLAUDE_CONFIG_DIR: '' }, '/home/u')).toEqual(expected)
  })
})

describe('FileClaudeCodeSession.readCurrentLogin', () => {
  it('returns null when the files are missing', async () => {
    expect(await session().readCurrentLogin()).toBeNull()
  })

  it('returns null when a file exists but our key is absent (logged out)', async () => {
    await installFixtures()
    const { claudeAiOauth: _, ...rest } = await fixture('credentials.json')
    await writeFile(paths.credentials, JSON.stringify(rest))
    expect(await session().readCurrentLogin()).toBeNull()
  })

  it.each(['claudeAiOauth', 'oauthAccount'])('returns null when %s is null', async (key) => {
    await installFixtures()
    const [file, path] =
      key === 'claudeAiOauth'
        ? ['credentials.json', paths.credentials]
        : ['claude.json', paths.claudeJson]
    await writeFile(path, JSON.stringify({ ...(await fixture(file)), [key]: null }))
    expect(await session().readCurrentLogin()).toBeNull()
  })

  it('reads the live login, keeping unmodelled keys', async () => {
    await installFixtures()
    const login = await session().readCurrentLogin()
    expect(login?.oauth).toEqual((await fixture('credentials.json')).claudeAiOauth)
    expect(login?.account).toEqual((await fixture('claude.json')).oauthAccount)
  })

  it.each([
    ['invalid JSON', 'credentials', '{"claudeAiOauth": {"accessToken": "fake-secret"'],
    ['a non-object', 'claudeJson', '[1]'],
    ['a bad claudeAiOauth', 'credentials', '{"claudeAiOauth":{"accessToken":"fake-secret"}}'],
    ['a bad oauthAccount', 'claudeJson', '{"oauthAccount":{"accountUuid":1}}'],
  ] as const)('throws a typed error for %s, without file content', async (_, which, content) => {
    await installFixtures()
    await writeFile(paths[which], content)
    const err = await session()
      .readCurrentLogin()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClaudeCodeFileError)
    expect((err as ClaudeCodeFileError).path).toBe(paths[which])
    expect((err as Error).message).not.toContain('fake-secret')
  })
})

describe('FileClaudeCodeSession.writeLogin', () => {
  it('replaces only our keys and preserves every other key', async () => {
    await installFixtures()
    await session().writeLogin(oauth, account)

    const creds = await readJson(paths.credentials)
    const { claudeAiOauth: _c, ...credsRest } = await fixture('credentials.json')
    expect(creds).toEqual({ ...credsRest, claudeAiOauth: oauth })

    const cj = await readJson(paths.claudeJson)
    const { oauthAccount: _a, ...cjRest } = await fixture('claude.json')
    expect(cj).toEqual({ ...cjRest, oauthAccount: account })

    expect(await session().readCurrentLogin()).toEqual({ oauth, account })
  })

  it('preserves the existing file modes', async () => {
    await installFixtures()
    await session().writeLogin(oauth, account)
    expect(await modeOf(paths.credentials)).toBe(0o600)
    expect(await modeOf(paths.claudeJson)).toBe(0o644)
  })

  it('creates missing files as 0600', async () => {
    await session().writeLogin(oauth, account)
    expect(await readJson(paths.credentials)).toEqual({ claudeAiOauth: oauth })
    expect(await readJson(paths.claudeJson)).toEqual({ oauthAccount: account })
    expect(await modeOf(paths.credentials)).toBe(0o600)
    expect(await modeOf(paths.claudeJson)).toBe(0o600)
  })

  it('writes through a symlinked file instead of replacing the link', async () => {
    await installFixtures()
    const real = join(dir, 'dotfiles-claude.json')
    await copyFile(paths.claudeJson, real)
    await rm(paths.claudeJson)
    await symlink(real, paths.claudeJson)
    await session().writeLogin(oauth, account)
    expect((await readJson(real)).oauthAccount).toEqual(account)
    expect((await lstat(paths.claudeJson)).isSymbolicLink()).toBe(true)
  })

  it('backs up both originals on the first write only', async () => {
    await installFixtures()
    const s = session()
    await s.writeLogin(oauth, account)
    await s.writeLogin({ ...oauth, accessToken: 'fake-access-token-2' }, account)
    // a fresh process must not back up again either
    await session().writeLogin(oauth, account)

    expect(await readdir(backups)).toEqual([TS])
    const dest = join(backups, TS)
    expect((await readdir(dest)).sort()).toEqual(['.claude.json', '.credentials.json'])
    expect(await readJson(join(dest, '.credentials.json'))).toEqual(
      await fixture('credentials.json'),
    )
    expect(await readJson(join(dest, '.claude.json'))).toEqual(await fixture('claude.json'))
    expect(await modeOf(join(dest, '.credentials.json'))).toBe(0o600)
    expect(await modeOf(join(dest, '.claude.json'))).toBe(0o600)
  })

  it('refuses to overwrite a malformed file and writes nothing', async () => {
    await installFixtures()
    await writeFile(paths.claudeJson, '{broken')
    await expect(session().writeLogin(oauth, account)).rejects.toBeInstanceOf(ClaudeCodeFileError)
    expect(await readJson(paths.credentials)).toEqual(await fixture('credentials.json'))
    expect(await readFile(paths.claudeJson, 'utf8')).toBe('{broken')
    await expect(readdir(backups)).rejects.toThrow()
  })

  it('serializes concurrent writes (last call wins, files stay valid)', async () => {
    await installFixtures()
    const s = session()
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        s.writeLogin({ ...oauth, accessToken: `fake-access-${i}` }, account),
      ),
    )
    expect(((await readJson(paths.credentials)).claudeAiOauth as OAuthTokens).accessToken).toBe(
      'fake-access-9',
    )
  })
})
