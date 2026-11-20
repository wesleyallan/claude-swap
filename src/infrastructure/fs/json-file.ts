import { readFile, rename } from 'node:fs/promises'
import type { z } from 'zod'
import type { Clock, Logger } from '@/application/ports'
import { PromiseMutex } from '../system/mutex'
import { atomicWrite } from './atomic-write'
import { type Migrations, migrate } from './migrate'

export interface JsonFileOptions<S extends z.ZodType> {
  readonly path: string
  /** Shape of the document without `version`; may contain codecs (e.g. ISO string ↔ Date). */
  readonly schema: S
  readonly version: number
  readonly migrations?: Migrations
  readonly defaults: () => z.output<S>
  readonly mode?: number
  readonly logger: Logger
  readonly clock: Clock
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'

/**
 * A versioned, zod-validated JSON document. A missing file reads as the default; a corrupt,
 * unmigratable or newer file is renamed to `*.corrupt-<ts>` and also reads as the default.
 * Writes are atomic and serialized per instance.
 */
export class JsonFile<S extends z.ZodType> {
  readonly #o: JsonFileOptions<S>
  readonly #mutex = new PromiseMutex()

  constructor(options: JsonFileOptions<S>) {
    this.#o = options
  }

  async read(): Promise<z.output<S>> {
    const { path, schema, version, migrations = {}, defaults } = this.#o
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      if (isMissing(err)) return defaults()
      throw err
    }
    try {
      return schema.decode(migrate(JSON.parse(text), version, migrations) as z.input<S>)
    } catch (err) {
      await this.#moveAside(err)
      return defaults()
    }
  }

  write(value: z.output<S>): Promise<void> {
    return this.#mutex.run(() => this.#write(value))
  }

  /** Read-modify-write under the file's mutex. */
  update(fn: (current: z.output<S>) => z.output<S>): Promise<z.output<S>> {
    return this.#mutex.run(async () => {
      const next = fn(await this.read())
      await this.#write(next)
      return next
    })
  }

  async #write(value: z.output<S>): Promise<void> {
    const { path, schema, version, mode } = this.#o
    const body = { version, ...(schema.encode(value) as object) }
    await atomicWrite(path, `${JSON.stringify(body, null, 2)}\n`, mode ? { mode } : {})
  }

  async #moveAside(cause: unknown): Promise<void> {
    const { path, clock, logger } = this.#o
    const backup = `${path}.corrupt-${clock.now().toISOString().replace(/[:.]/g, '-')}`
    await rename(path, backup)
    logger.warn('corrupt JSON file moved aside', {
      path,
      backup,
      // JSON.parse messages quote file content, which may be a token: never log them.
      reason: cause instanceof SyntaxError ? 'invalid JSON' : (cause as Error).message,
    })
  }
}
