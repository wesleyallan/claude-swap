import { describe, expect, it } from 'vitest'
import { FakeClock } from '@/application/testing/fakes'
import { JsonLogger, redact } from './logger'

describe('redact', () => {
  it('replaces values of token-like keys at any depth', () => {
    expect(
      redact({ accessToken: 'a', nested: { refresh_token: 'b', list: [{ Authorization: 'x' }] } }),
    ).toEqual({
      accessToken: '[redacted]',
      nested: { refresh_token: '[redacted]', list: [{ Authorization: '[redacted]' }] },
    })
  })

  it('masks token-looking strings inside ordinary values', () => {
    expect(redact({ msg: 'got sk-ant-oat01-abc_DEF-123 and Bearer xyz.789' })).toEqual({
      msg: 'got [redacted] and Bearer [redacted]',
    })
  })

  it('reduces errors to name + redacted message', () => {
    expect(redact(new TypeError('bad sk-ant-ort01-zzz'))).toEqual({
      name: 'TypeError',
      message: 'bad [redacted]',
    })
  })

  it('keeps primitives and dates', () => {
    expect(redact({ n: 1, b: true, z: null, d: new Date('2026-11-19T00:00:00.000Z') })).toEqual({
      n: 1,
      b: true,
      z: null,
      d: '2026-11-19T00:00:00.000Z',
    })
  })
})

describe('JsonLogger', () => {
  it('writes one redacted JSON line per call, errors to the error sink', () => {
    const out: string[] = []
    const err: string[] = []
    const log = new JsonLogger(new FakeClock(), {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    })
    log.info('started sk-ant-oat01-secret', { port: 4747, token: 'nope' })
    log.warn('w')
    log.error('e', { cause: new Error('boom') })
    expect(out.map((l) => JSON.parse(l))).toEqual([
      {
        t: '2026-11-19T12:00:00.000Z',
        level: 'info',
        msg: 'started [redacted]',
        port: 4747,
        token: '[redacted]',
      },
      { t: '2026-11-19T12:00:00.000Z', level: 'warn', msg: 'w' },
    ])
    expect(JSON.parse(err[0] ?? '')).toMatchObject({
      level: 'error',
      cause: { name: 'Error', message: 'boom' },
    })
    expect(out.every((l) => l.endsWith('\n'))).toBe(true)
  })
})
