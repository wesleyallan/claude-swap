// `npm run perf:budget`: checks the built app against the T12 budget.
// - initial JS (entry + modulepreloads in dist/web/index.html) < 200 kB gzip, chart chunk lazy;
// - server RSS < 80 MB after 30 s idle with two accounts, using temp HOME / CLAUDE_SWAP_HOME /
//   CLAUDE_CONFIG_DIR and the mock Anthropic API (never the real ~/.claude or Anthropic).
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { startMockAnthropic } from '../tests/e2e/mock-anthropic'

const ROOT = resolve(import.meta.dirname, '..')
const WEB = join(ROOT, 'dist/web')
const INITIAL_JS_GZIP_MAX = 200_000
const RSS_MAX = 80 * 1024 * 1024
const IDLE_MS = 30_000

/** JS the browser loads before any lazy import: the entry script and its modulepreloads. */
export function initialChunks(html: string): string[] {
  return [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\/([^"]+\.js)"/g)].map(
    (m) => m[1] as string,
  )
}

async function checkBundle(): Promise<boolean> {
  const initial = initialChunks(await readFile(join(WEB, 'index.html'), 'utf8'))
  const files = (await readdir(join(WEB, 'assets'))).filter((f) => f.endsWith('.js'))
  const rows = await Promise.all(
    files.map(async (f) => {
      const buf = await readFile(join(WEB, 'assets', f))
      return {
        f,
        raw: buf.length,
        gzip: gzipSync(buf).length,
        initial: initial.includes(`assets/${f}`),
      }
    }),
  )
  rows.sort((a, b) => b.gzip - a.gzip)
  const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`
  console.log('web bundle (JS):')
  for (const r of rows)
    console.log(
      `  ${r.initial ? '*' : ' '} ${r.f.padEnd(40)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)} gzip`,
    )
  const total = rows.filter((r) => r.initial).reduce((s, r) => s + r.gzip, 0)
  const chartLazy = !rows.some((r) => r.initial && r.f.startsWith('usage-chart'))
  const ok = total < INITIAL_JS_GZIP_MAX && chartLazy && initial.length > 0
  console.log(
    `  initial JS (*): ${kb(total)} gzip (budget ${kb(INITIAL_JS_GZIP_MAX)}), chart lazy: ${chartLazy}`,
  )
  return ok
}

async function checkRss(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-swap-perf-'))
  const mock = await startMockAnthropic()
  const claudeDir = join(dir, 'claude')
  await mkdir(join(dir, 'home'), { recursive: true })
  await mkdir(claudeDir, { recursive: true })
  const port = 47_000 + Math.floor(Math.random() * 1000)
  const child = spawn(
    process.execPath,
    [join(ROOT, 'dist/server/main.js'), '--port', String(port)],
    {
      env: {
        PATH: process.env.PATH,
        HOME: join(dir, 'home'),
        CLAUDE_SWAP_HOME: join(dir, 'swap'),
        CLAUDE_CONFIG_DIR: claudeDir,
        CLAUDE_SWAP_API_BASE_URL: mock.url,
        CLAUDE_SWAP_OAUTH_TOKEN_URL: `${mock.url}/v1/oauth/token`,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  try {
    await new Promise<void>((ok, fail) => {
      child.stdout.on('data', (c: Buffer) => c.toString().includes('"msg":"listening"') && ok())
      child.once('exit', (code) => fail(new Error(`server exited (${code}) before listening`)))
    })
    const base = `http://127.0.0.1:${port}`
    for (const name of ['perf-a', 'perf-b']) {
      // Fake tokens only; written like Claude Code's `/login` would, then imported.
      await writeFile(
        join(claudeDir, '.credentials.json'),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: `fake-access-${name}`,
            refreshToken: `fake-refresh-${name}`,
            expiresAt: Date.now() + 8 * 3_600_000,
            scopes: ['user:inference', 'user:profile'],
          },
        }),
        { mode: 0o600 },
      )
      await writeFile(
        join(claudeDir, '.claude.json'),
        JSON.stringify({
          oauthAccount: { accountUuid: `uuid-${name}`, emailAddress: `${name}@example.test` },
        }),
      )
      const res = await fetch(`${base}/api/accounts/import`, { method: 'POST' })
      if (res.status !== 201) throw new Error(`import ${name}: HTTP ${res.status}`)
    }
    await fetch(`${base}/`) // serve the SPA once, as a browser would
    await sleep(IDLE_MS)
    const status = await readFile(`/proc/${child.pid}/status`, 'utf8')
    const kib = (field: string) => Number(new RegExp(`${field}:\\s+(\\d+) kB`).exec(status)?.[1])
    const rss = kib('VmRSS') * 1024
    const mb = (k: number) => `${(k / 1024).toFixed(1)} MB`
    // RssFile is mostly the node binary's shared code pages; RssAnon is this process's own memory.
    console.log(
      `server RSS after ${IDLE_MS / 1000} s idle: ${mb(kib('VmRSS'))} (budget 80 MB;` +
        ` anon ${mb(kib('RssAnon'))}, file ${mb(kib('RssFile'))})`,
    )
    return rss > 0 && rss < RSS_MAX
  } finally {
    child.kill('SIGTERM')
    await mock.close()
    await rm(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundleOk = await checkBundle()
  const rssOk = await checkRss()
  if (!bundleOk || !rssOk) {
    console.error('perf budget: FAILED')
    process.exit(1)
  }
  console.log('perf budget: ok')
}
