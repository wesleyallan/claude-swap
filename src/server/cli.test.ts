import { describe, expect, it } from 'vitest'
import { parseCli } from './cli'

describe('parseCli', () => {
  it('defaults to no port override and no browser', () => {
    expect(parseCli([])).toEqual({ port: undefined, open: false })
  })

  it('reads --port and --open', () => {
    expect(parseCli(['--port', '5000', '--open'])).toEqual({ port: 5000, open: true })
    expect(parseCli(['--port=1'])).toEqual({ port: 1, open: false })
  })

  it.each(['0', '65536', '12.5', 'abc', ''])('rejects port %j', (port) => {
    expect(() => parseCli(['--port', port])).toThrow(/--port/)
  })

  it('rejects unknown flags and positionals', () => {
    expect(() => parseCli(['--nope'])).toThrow()
    expect(() => parseCli(['extra'])).toThrow()
  })
})
