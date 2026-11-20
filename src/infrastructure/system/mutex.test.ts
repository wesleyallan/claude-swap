import { describe, expect, it } from 'vitest'
import { PromiseMutex } from './mutex'

const tick = () => new Promise((r) => setTimeout(r, 1))

describe('PromiseMutex', () => {
  it('runs critical sections one at a time, in call order', async () => {
    const mutex = new PromiseMutex()
    const log: string[] = []
    const job = (name: string) =>
      mutex.run(async () => {
        log.push(`${name}:start`)
        await tick()
        log.push(`${name}:end`)
        return name
      })
    await expect(Promise.all([job('a'), job('b'), job('c')])).resolves.toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
  })

  it('a rejected section does not block the next one', async () => {
    const mutex = new PromiseMutex()
    const failed = mutex.run(async () => {
      throw new Error('boom')
    })
    const next = mutex.run(async () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })
})
