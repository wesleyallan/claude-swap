// Every test gets its own claude-swap process (the built `dist/server/main.js`) with a temp HOME,
// CLAUDE_SWAP_HOME and CLAUDE_CONFIG_DIR, talking to a per-worker mock Anthropic API.
// Nothing here may touch the real ~/.claude, ~/.claude.json or ~/.config/claude-swap.
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test as base, expect } from '@playwright/test'
import { type MockAnthropic, startMockAnthropic } from './mock-anthropic'

const MAIN = resolve(import.meta.dirname, '../../dist/server/main.js')

/** A fake Claude account. Tokens are obviously fake and unique per test (the mock is shared). */
export interface FakeAccount {
  name: string
  uuid: string
  email: string
  accessToken: string
  refreshToken: string
  /** Epoch ms; defaults to 8 h ahead so claude-swap never refreshes it unless a test wants it. */
  expiresAt: number
}

export function fakeAccount(name: string, overrides: Partial<FakeAccount> = {}): FakeAccount {
  const id = randomUUID()
  return {
    name,
    uuid: id,
    email: `${name.toLowerCase()}@example.test`,
    accessToken: `fake-access-${name}-${id}`,
    refreshToken: `fake-refresh-${name}-${id}`,
    expiresAt: Date.now() + 8 * 3_600_000,
    ...overrides,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: parsed test fixtures, read with optional chaining
type JsonDoc = Record<string, any>

export interface App {
  url: string
  port: number
  /** Temp `CLAUDE_CONFIG_DIR` (Claude Code's files). */
  claudeDir: string
  swapHome: string
  /** Simulates `/login` in Claude Code: writes the account into both Claude Code files. */
  login(account: FakeAccount): Promise<void>
  /** Live `.credentials.json` + `.claude.json` contents. */
  claudeFiles(): Promise<{ credentials: JsonDoc; claudeJson: JsonDoc }>
  /** Stdout + stderr of the server so far (attached to failed tests). */
  output(): string
  /** SIGTERM and wait; resolves with the exit code. */
  stop(): Promise<number | null>
}

async function freePort(): Promise<number> {
  const srv = createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address() as { port: number }
  await new Promise((r) => srv.close(r))
  return port
}

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

async function launch(dir: string, mock: MockAnthropic): Promise<App> {
  if (!existsSync(MAIN)) throw new Error('dist/server/main.js missing: run `npm run build` first')
  const home = join(dir, 'home')
  const swapHome = join(dir, 'swap')
  const claudeDir = join(dir, 'claude')
  await mkdir(home, { recursive: true })
  await mkdir(claudeDir, { recursive: true })
  const credentialsPath = join(claudeDir, '.credentials.json')
  const claudeJsonPath = join(claudeDir, '.claude.json')
  // Keys claude-swap does not own; every write must keep them.
  await writeFile(credentialsPath, JSON.stringify({ mcpOAuth: { fake: 'keep-me' } }), {
    mode: 0o600,
  })
  await writeFile(claudeJsonPath, JSON.stringify({ numStartups: 7, projects: { '/x': {} } }))

  const port = await freePort()
  const { XDG_CONFIG_HOME: _, CLAUDE_SWAP_WEB_DIR: __, ...inherited } = process.env
  const child: ChildProcess = spawn(process.execPath, [MAIN], {
    env: {
      ...inherited,
      HOME: home,
      CLAUDE_SWAP_HOME: swapHome,
      CLAUDE_CONFIG_DIR: claudeDir,
      PORT: String(port),
      CLAUDE_SWAP_API_BASE_URL: mock.url,
      CLAUDE_SWAP_OAUTH_TOKEN_URL: `${mock.url}/v1/oauth/token`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)))
  await new Promise<void>((ok, fail) => {
    const onData = (chunk: Buffer) => {
      output += chunk
      if (output.includes('"msg":"listening"')) ok()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    void exited.then((code) =>
      fail(new Error(`server exited (${code}) before listening:\n${output}`)),
    )
    setTimeout(() => fail(new Error(`server did not start:\n${output}`)), 10_000)
  })

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    claudeDir,
    swapHome,
    async login(a) {
      const credentials = await readJson(credentialsPath)
      const claudeJson = await readJson(claudeJsonPath)
      credentials.claudeAiOauth = {
        accessToken: a.accessToken,
        refreshToken: a.refreshToken,
        expiresAt: a.expiresAt,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max',
      }
      claudeJson.oauthAccount = {
        accountUuid: a.uuid,
        emailAddress: a.email,
        organizationUuid: `org-${a.uuid}`,
        displayName: a.name,
        organizationName: `${a.name}'s Organization`,
      }
      await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 })
      await writeFile(claudeJsonPath, JSON.stringify(claudeJson))
    },
    async claudeFiles() {
      return {
        credentials: await readJson(credentialsPath),
        claudeJson: await readJson(claudeJsonPath),
      }
    },
    output: () => output,
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM')
      return exited
    },
  }
}

export const test = base.extend<{ app: App }, { mock: MockAnthropic }>({
  mock: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture deps from this pattern
    async ({}, use) => {
      const mock = await startMockAnthropic()
      await use(mock)
      await mock.close()
    },
    { scope: 'worker' },
  ],
  app: async ({ mock }, use, testInfo) => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-swap-e2e-'))
    const app = await launch(dir, mock)
    await use(app)
    const code = await app.stop()
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('server-output', { body: app.output(), contentType: 'text/plain' })
    }
    await rm(dir, { recursive: true, force: true })
    // main.ts shuts down cleanly on SIGTERM.
    expect(code, 'server exit code after SIGTERM').toBe(0)
  },
  baseURL: async ({ app }, use) => use(app.url),
})

export { expect }

/** Imports the live Claude Code login through the API (fast path for specs not about importing). */
export async function importLogin(
  app: App,
  request: import('@playwright/test').APIRequestContext,
  account: FakeAccount,
) {
  await app.login(account)
  const res = await request.post('/api/accounts/import', { data: { label: account.name } })
  expect(res.status()).toBe(201)
}

export async function dashboard(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get('/api/dashboard')
  expect(res.ok()).toBe(true)
  return res.json()
}

/** Runs an engine tick now (the engine itself polls on its own interval). */
export async function runEngine(request: import('@playwright/test').APIRequestContext) {
  expect((await request.post('/api/engine/run')).status()).toBe(202)
}

/** Waits until Claude Code's credentials hold `account`'s access token. */
export async function expectLive(app: App, account: FakeAccount) {
  await expect
    .poll(async () => (await app.claudeFiles()).credentials.claudeAiOauth?.accessToken)
    .toBe(account.accessToken)
}
