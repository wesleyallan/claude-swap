// Enforces the hexagonal layer rules from AGENTS.md on every source file under src/.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))
const LAYERS = ['domain', 'application', 'infrastructure', 'server', 'web'] as const
type Layer = (typeof LAYERS)[number]

type Import = { specifier: string; typeOnly: boolean }

// shortcut: regex scan, not a TS parser; fine while imports stay conventional.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /(?<!typeof\s+)\bimport\(\s*['"]([^'"]+)['"]/g

function parseImports(source: string): Import[] {
  const found: Import[] = []
  for (const m of source.matchAll(STATIC_IMPORT)) {
    found.push({ specifier: m[2] ?? '', typeOnly: m[1] !== undefined })
  }
  for (const m of source.matchAll(DYNAMIC_IMPORT)) {
    found.push({ specifier: m[1] ?? '', typeOnly: false })
  }
  return found
}

/** Layer an import points to, `null` for packages/builtins, `'other'` for src files outside layers. */
function targetLayer(file: string, specifier: string): Layer | 'other' | null {
  let abs: string
  if (specifier.startsWith('@/')) abs = join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) abs = resolve(dirname(file), specifier)
  else return null
  return layerOf(abs) ?? 'other'
}

function layerOf(abs: string): Layer | undefined {
  const top = relative(SRC, abs).split(/[\\/]/)[0]
  return LAYERS.find((l) => l === top)
}

function violations(file: string, source: string): string[] {
  const from = layerOf(file)
  if (!from) return []
  const isTest = /\.test\.tsx?$/.test(file)
  const out: string[] = []
  for (const { specifier, typeOnly } of parseImports(source)) {
    const to = targetLayer(file, specifier)
    const bad =
      // domain tests may import packages (vitest), never other layers
      (from === 'domain' && to !== 'domain' && !(isTest && to === null)) ||
      (from === 'application' && to !== null && to !== 'domain' && to !== 'application') ||
      (from === 'web' && to !== null && to !== 'web' && !(to === 'server' && typeOnly))
    if (bad) out.push(`${relative(SRC, file)} -> ${specifier}`)
  }
  return out
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

describe('layer boundaries', () => {
  const at = (p: string) => join(SRC, p)

  it('domain imports only domain (no packages, no builtins)', () => {
    expect(violations(at('domain/a.ts'), "import { b } from './b'")).toEqual([])
    expect(violations(at('domain/a.ts'), "import { z } from 'zod'")).toHaveLength(1)
    expect(violations(at('domain/a.ts'), "import fs from 'node:fs'")).toHaveLength(1)
    expect(
      violations(at('domain/a.ts'), "import type { X } from '@/application/ports'"),
    ).toHaveLength(1)
  })

  it('domain tests may import packages but still no other layer', () => {
    expect(violations(at('domain/a.test.ts'), "import { it } from 'vitest'")).toEqual([])
    expect(violations(at('domain/a.test.ts'), "import { x } from '@/server/app'")).toHaveLength(1)
  })

  it('application never imports infrastructure, server or web', () => {
    expect(violations(at('application/e.ts'), "import { a } from '@/domain/account'")).toEqual([])
    expect(violations(at('application/e.ts'), "import { z } from 'zod'")).toEqual([])
    expect(
      violations(at('application/e.ts'), "import { x } from '../infrastructure/fs/atomic'"),
    ).toHaveLength(1)
    expect(violations(at('application/e.ts'), "export * from '@/server/app'")).toHaveLength(1)
  })

  it('web imports server only via import type, and no other layer', () => {
    const file = at('web/lib/api.ts')
    expect(violations(file, "import type { AppType } from '@/server/app'")).toEqual([])
    expect(violations(file, "import { app } from '@/server/app'")).toHaveLength(1)
    expect(violations(file, "import { type AppType } from '@/server/app'")).toHaveLength(1)
    expect(violations(file, "import type { Account } from '@/domain/account'")).toHaveLength(1)
    expect(violations(file, "const m = await import('../../server/app')")).toHaveLength(1)
    expect(violations(file, "import { hc } from 'hono/client'")).toEqual([])
  })

  it('parses multi-line and side-effect imports', () => {
    expect(parseImports("import {\n  a,\n  b,\n} from './x'\nimport './y.css'")).toEqual([
      { specifier: './x', typeOnly: false },
      { specifier: './y.css', typeOnly: false },
    ])
  })

  it('holds for every file in src/', () => {
    const found = sourceFiles(SRC).flatMap((f) => violations(f, readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })
})
