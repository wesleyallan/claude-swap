import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configHome, install, renderUnit, uninstall } from './service'

let dir: string
let calls: string[][]
const run = (args: string[]) => {
  calls.push(args)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-swap-service-'))
  calls = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const opts = () => ({
  configHome: join(dir, 'config'),
  node: '/opt/node/bin/node',
  repo: '/srv/claude swap',
  checkBuild: false,
  run,
})

describe('renderUnit', () => {
  it('fills every placeholder', async () => {
    const unit = renderUnit(await readFile('deploy/claude-swap.service', 'utf8'), opts())
    expect(unit).not.toMatch(/@[A-Z]+@/)
    expect(unit).toContain('ExecStart="/opt/node/bin/node" "/srv/claude swap/dist/server/main.js"')
    expect(unit).toContain('WorkingDirectory=/srv/claude swap')
    expect(unit).toContain('Environment=PORT=4747')
    expect(unit).toContain('Restart=on-failure')
  })
})

describe('configHome', () => {
  it('uses XDG_CONFIG_HOME when absolute, else ~/.config', () => {
    expect(configHome({ XDG_CONFIG_HOME: '/x' }, '/home/u')).toBe('/x')
    expect(configHome({ XDG_CONFIG_HOME: 'rel' }, '/home/u')).toBe('/home/u/.config')
  })
})

describe('install / uninstall', () => {
  it('writes the unit (temp + rename), reloads, enables and (re)starts it', async () => {
    const path = await install(opts())
    expect(path).toBe(join(dir, 'config/systemd/user/claude-swap.service'))
    expect(await readFile(path, 'utf8')).toContain('/opt/node/bin/node')
    expect((await stat(path)).mode & 0o777).toBe(0o644)
    expect(await readdir(dirname(path))).toEqual(['claude-swap.service'])
    // restart, not `enable --now`: a reinstall after an update must load the new build
    expect(calls).toEqual([
      ['--user', 'daemon-reload'],
      ['--user', 'enable', 'claude-swap.service'],
      ['--user', 'restart', 'claude-swap.service'],
    ])
  })

  it('dry run writes nothing and runs nothing', async () => {
    const path = await install({ ...opts(), dryRun: true })
    await expect(stat(path)).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('refuses to install without a build', async () => {
    await expect(install({ ...opts(), repo: dir, checkBuild: true })).rejects.toThrow(
      /npm run build/,
    )
    expect(calls).toEqual([])
  })

  it('disables, removes the unit and reloads', async () => {
    const path = await install(opts())
    calls = []
    await uninstall(opts())
    await expect(stat(path)).rejects.toThrow()
    expect(calls).toEqual([
      ['--user', 'disable', '--now', 'claude-swap.service'],
      ['--user', 'daemon-reload'],
    ])
  })

  it('uninstall tolerates a unit that is not installed', async () => {
    const failing = (args: string[]) => {
      calls.push(args)
      if (args.includes('disable')) throw new Error('not loaded')
    }
    await expect(uninstall({ ...opts(), run: failing })).resolves.toBeUndefined()
    expect(calls.at(-1)).toEqual(['--user', 'daemon-reload'])
  })
})
