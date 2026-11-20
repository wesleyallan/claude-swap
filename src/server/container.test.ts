import { describe, expect, it } from 'vitest'
import { Engine } from '@/application/engine'
import { FakeEngine, MemoryConfigRepository } from '@/application/testing/fakes'
import { JsonConfigRepository } from '@/infrastructure/repositories/repositories'
import { createContainer } from './container'

// Only constructs adapters (no I/O happens until a method is called), so the real home is safe.
const env = { CLAUDE_SWAP_HOME: '/nonexistent/swap', CLAUDE_CONFIG_DIR: '/nonexistent/cc' }

describe('createContainer', () => {
  it('builds real adapters from env', () => {
    const c = createContainer({}, { ...env, PORT: '4799' })
    expect(c.config).toBeInstanceOf(JsonConfigRepository)
    expect(c.engine).toBeInstanceOf(Engine)
    expect(c.port).toBe(4799)
    expect(c.webRoot).toMatch(/web$/)
  })

  it('defaults the port and honours overrides', () => {
    const config = new MemoryConfigRepository()
    const engine = new FakeEngine()
    const c = createContainer({ config, engine, webRoot: '/w' }, env)
    expect(c.port).toBe(4747)
    expect(c.config).toBe(config)
    expect(c.engine).toBe(engine)
    expect(c.webRoot).toBe('/w')
  })
})
