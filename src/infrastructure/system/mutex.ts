import type { Mutex } from '@/application/ports'

/** Promise-queue mutex: each section starts after the previous one settles. */
export class PromiseMutex implements Mutex {
  #tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(fn)
    this.#tail = result.catch(() => undefined)
    return result
  }
}
