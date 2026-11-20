export type Migration = (data: Record<string, unknown>) => Record<string, unknown>

/** `migrations[v]` upgrades a v`v` document to v`v+1`. */
export type Migrations = Readonly<Record<number, Migration>>

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Brings a parsed JSON document up to `current`. A missing `version` means v0.
 * Throws on non-objects, unknown/newer versions and gaps in the chain.
 */
export function migrate(raw: unknown, current: number, migrations: Migrations): unknown {
  if (!isObject(raw)) throw new Error('expected a JSON object')
  const from = raw.version ?? 0
  if (!Number.isInteger(from) || (from as number) > current) {
    throw new Error(`unsupported version ${String(raw.version)} (current is ${current})`)
  }
  let data = raw
  for (let v = from as number; v < current; v++) {
    const step = migrations[v]
    if (!step) throw new Error(`no migration from version ${v}`)
    data = { ...step(data), version: v + 1 }
  }
  return data
}
