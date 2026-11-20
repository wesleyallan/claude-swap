// `node scripts/service.ts install|uninstall [--dry-run]`: manages the systemd *user* unit.
// Plain Node (type stripping), no dependencies, so it runs without dev tooling.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const UNIT = 'claude-swap.service'
const REPO = resolve(import.meta.dirname, '..')

type Env = Readonly<Record<string, string | undefined>>

export interface ServiceOptions {
  /** `$XDG_CONFIG_HOME` or `~/.config`. */
  configHome: string
  /** Absolute node binary: the user manager's PATH may not contain nvm/fnm installs. */
  node: string
  repo: string
  checkBuild: boolean
  dryRun?: boolean
  run: (systemctlArgs: string[]) => void
}

export const configHome = (env: Env = process.env, home = homedir()) =>
  env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : join(home, '.config')

const unitFile = (o: Pick<ServiceOptions, 'configHome'>) =>
  join(o.configHome, 'systemd', 'user', UNIT)

export function renderUnit(template: string, o: Pick<ServiceOptions, 'node' | 'repo'>): string {
  return template.replaceAll('@NODE@', o.node).replaceAll('@REPO@', o.repo)
}

export async function install(o: ServiceOptions): Promise<string> {
  const path = unitFile(o)
  if (o.checkBuild && !existsSync(join(o.repo, 'dist/server/main.js')))
    throw new Error('dist/server/main.js is missing: run `npm run build` first')
  const unit = renderUnit(await readFile(join(REPO, 'deploy', UNIT), 'utf8'), o)
  const steps = [
    ['--user', 'daemon-reload'],
    ['--user', 'enable', '--now', UNIT],
  ]
  if (o.dryRun) {
    console.log(`# would write ${path}\n${unit}`)
    for (const s of steps) console.log(`# would run: systemctl ${s.join(' ')}`)
    return path
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, unit, { mode: 0o644 })
  for (const s of steps) o.run(s)
  return path
}

export async function uninstall(o: ServiceOptions): Promise<void> {
  const path = unitFile(o)
  const disable = ['--user', 'disable', '--now', UNIT]
  const reload = ['--user', 'daemon-reload']
  if (o.dryRun) {
    console.log(`# would run: systemctl ${disable.join(' ')}\n# would remove ${path}`)
    console.log(`# would run: systemctl ${reload.join(' ')}`)
    return
  }
  try {
    o.run(disable)
  } catch {
    // Not installed or already stopped: removing the file is still what the user wants.
  }
  await rm(path, { force: true })
  o.run(reload)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } },
    allowPositionals: true,
  })
  const [command] = positionals
  const options: ServiceOptions = {
    configHome: configHome(),
    node: process.execPath,
    repo: REPO,
    checkBuild: true,
    dryRun: values['dry-run'],
    run: (args) => execFileSync('systemctl', args, { stdio: 'inherit' }),
  }
  if (command === 'install') {
    const path = await install(options)
    if (!options.dryRun) console.log(`installed ${path}\nclaude-swap runs at http://127.0.0.1:4747`)
  } else if (command === 'uninstall') {
    await uninstall(options)
    if (!options.dryRun)
      console.log('claude-swap service removed (your data in ~/.config/claude-swap is kept)')
  } else {
    console.error('usage: node scripts/service.ts install|uninstall [--dry-run]')
    process.exit(2)
  }
}
