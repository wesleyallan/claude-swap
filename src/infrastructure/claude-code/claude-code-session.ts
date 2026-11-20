import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type * as z from 'zod'
import type {
  ClaudeCodeLogin,
  ClaudeCodeSession,
  Clock,
  OAuthAccount,
  OAuthTokens,
} from '@/application/ports'
import { atomicWrite } from '../fs/atomic-write'
import { oauthAccountSchema, oauthTokensSchema } from '../repositories/schemas'
import { PromiseMutex } from '../system/mutex'

type Env = Readonly<Record<string, string | undefined>>

/** `$CLAUDE_CONFIG_DIR/{.credentials.json,.claude.json}`, else `~/.claude/.credentials.json` + `~/.claude.json`. */
export function claudeCodePaths(env: Env = process.env, home: string = homedir()) {
  const dir = env.CLAUDE_CONFIG_DIR
  return dir
    ? { credentials: join(dir, '.credentials.json'), claudeJson: join(dir, '.claude.json') }
    : {
        credentials: join(home, '.claude', '.credentials.json'),
        claudeJson: join(home, '.claude.json'),
      }
}

/** A Claude Code file exists but cannot be used. Never carries file content (it may hold tokens). */
export class ClaudeCodeFileError extends Error {
  override readonly name = 'ClaudeCodeFileError'
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Unusable Claude Code file ${path}: ${reason}`)
  }
}

export interface ClaudeCodeSessionDeps {
  readonly credentials: string
  readonly claudeJson: string
  /** `<CLAUDE_SWAP_HOME>/backups`; originals are copied here before our first write ever. */
  readonly backups: string
  readonly clock: Clock
}

type Doc = Record<string, unknown>

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'

/** Whole parsed file, or `null` when missing. Throws `ClaudeCodeFileError` when malformed. */
async function readDoc(path: string): Promise<Doc | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    // JSON.parse messages quote content, which may be a token: never surface them.
    throw new ClaudeCodeFileError(path, 'invalid JSON')
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new ClaudeCodeFileError(path, 'expected a JSON object')
  }
  return doc as Doc
}

function parseKey<S extends z.ZodType>(path: string, doc: Doc | null, key: string, schema: S) {
  if (doc?.[key] === undefined) return null
  const result = schema.safeParse(doc[key])
  if (!result.success) {
    const fields = result.error.issues.map((i) => [key, ...i.path].join('.'))
    throw new ClaudeCodeFileError(path, `invalid ${[...new Set(fields)].join(', ')}`)
  }
  return result.data as z.output<S>
}

/** Linux file-based Claude Code login: `.credentials.json` → `claudeAiOauth`, `.claude.json` → `oauthAccount`. */
export class FileClaudeCodeSession implements ClaudeCodeSession {
  readonly #d: ClaudeCodeSessionDeps
  readonly #mutex = new PromiseMutex()

  constructor(deps: ClaudeCodeSessionDeps) {
    this.#d = deps
  }

  async readCurrentLogin(): Promise<ClaudeCodeLogin | null> {
    const { credentials, claudeJson } = this.#d
    const [creds, cj] = await Promise.all([readDoc(credentials), readDoc(claudeJson)])
    const oauth = parseKey(credentials, creds, 'claudeAiOauth', oauthTokensSchema)
    const account = parseKey(claudeJson, cj, 'oauthAccount', oauthAccountSchema)
    return oauth && account ? { oauth, account } : null
  }

  writeLogin(oauth: OAuthTokens, account: OAuthAccount): Promise<void> {
    return this.#mutex.run(async () => {
      const { credentials, claudeJson } = this.#d
      // Read (and validate) both before touching anything: a malformed file is never overwritten.
      const [creds, cj] = await Promise.all([readDoc(credentials), readDoc(claudeJson)])
      await this.#backupOnce()
      await writeDoc(credentials, { ...creds, claudeAiOauth: oauth })
      await writeDoc(claudeJson, { ...cj, oauthAccount: account })
    })
  }

  /** First write ever (no backups yet) → copy both originals to `backups/<ts>/`, 0600. */
  async #backupOnce(): Promise<void> {
    const { backups, clock, credentials, claudeJson } = this.#d
    const existing = await readdir(backups).catch((err: unknown) => {
      if (isMissing(err)) return []
      throw err
    })
    if (existing.length > 0) return
    const dest = join(backups, clock.now().toISOString().replace(/[:.]/g, '-'))
    await mkdir(dest, { recursive: true, mode: 0o700 })
    for (const src of [credentials, claudeJson]) {
      try {
        const data = await readFile(src, 'utf8')
        await atomicWrite(join(dest, basename(src)), data)
      } catch (err) {
        if (!isMissing(err)) throw err
      }
    }
  }
}

/** Atomic write that keeps the file's mode (0600 when new) and writes through symlinks. */
async function writeDoc(path: string, doc: Doc): Promise<void> {
  let target = path
  let mode = 0o600
  try {
    target = await realpath(path)
    mode = (await stat(target)).mode & 0o777
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  await atomicWrite(target, `${JSON.stringify(doc, null, 2)}\n`, { mode })
}
