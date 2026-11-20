import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  BadResponseError,
  InvalidGrantError,
  NetworkError,
  RateLimitedError,
  UnauthorizedError,
} from '@/application/anthropic-errors'
import type { OAuthTokens } from '@/application/ports'
import { version } from '../../../package.json'
import { AnthropicClient, anthropicEndpoints, CLAUDE_CODE_CLIENT_ID } from './anthropic-client'

const fixture = async (name: string) =>
  JSON.parse(await readFile(join(import.meta.dirname, '__fixtures__', name), 'utf8')) as unknown

const NOW = new Date('2026-11-19T10:00:00.000Z')
const clock = { now: () => NOW }
const client = () =>
  new AnthropicClient({
    apiBaseUrl: 'http://127.0.0.1:9/mock/',
    tokenUrl: 'http://127.0.0.1:9/oauth/token',
    clock,
  })

const ACCESS = 'fake-access-token-SECRET'
const previous: OAuthTokens = {
  accessToken: 'fake-access-token-old',
  refreshToken: 'fake-refresh-token-old-SECRET',
  expiresAt: 1,
  scopes: ['user:inference'],
  subscriptionType: 'max',
  rateLimitTier: 'default_claude_max_20x',
}

let fetchMock: Mock<typeof fetch>
const respond = (body: unknown, init: ResponseInit = {}) =>
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), init),
  )
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? []
  return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) }
}
/** Rejection of `p`, asserting it leaks no token anywhere (message, fields, JSON). */
async function failure(p: Promise<unknown>) {
  const err = await p.then(
    () => expect.unreachable('expected a rejection'),
    (e: unknown) => e,
  )
  const dump = `${String(err)} ${JSON.stringify(err)} ${(err as Error).stack}`
  expect(dump).not.toMatch(/SECRET|fake-access-token|fake-refresh-token/)
  return err
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anthropicEndpoints', () => {
  it('defaults to the real endpoints', () => {
    expect(anthropicEndpoints({})).toEqual({
      apiBaseUrl: 'https://api.anthropic.com',
      tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    })
  })

  it('reads overrides from env, empty counts as unset', () => {
    expect(
      anthropicEndpoints({
        CLAUDE_SWAP_API_BASE_URL: 'http://127.0.0.1:5000',
        CLAUDE_SWAP_OAUTH_TOKEN_URL: '',
      }),
    ).toEqual({
      apiBaseUrl: 'http://127.0.0.1:5000',
      tokenUrl: 'https://platform.claude.com/v1/oauth/token',
    })
  })
})

describe('fetchUsage', () => {
  it('sends the OAuth usage request with bearer, beta and user-agent headers', async () => {
    respond(await fixture('usage.json'))
    await client().fetchUsage(ACCESS)

    const { url, init, headers } = lastCall()
    expect(url).toBe('http://127.0.0.1:9/mock/api/oauth/usage')
    expect(init.method ?? 'GET').toBe('GET')
    expect(headers.get('authorization')).toBe(`Bearer ${ACCESS}`)
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20')
    expect(headers.get('user-agent')).toBe(`claude-swap/${version}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps the recorded response to a domain snapshot', async () => {
    respond(await fixture('usage.json'))
    expect(await client().fetchUsage(ACCESS)).toEqual({
      fiveHour: { utilization: 42, resetsAt: new Date('2026-11-19T14:00:00.123Z') },
      sevenDay: { utilization: 97.5, resetsAt: new Date('2026-11-22T09:00:00Z') },
      fetchedAt: NOW,
    })
  })

  it('tolerates null or missing windows and null resets_at', async () => {
    respond({ five_hour: { utilization: 0, resets_at: null }, seven_day: null })
    expect(await client().fetchUsage(ACCESS)).toEqual({
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: null,
      fetchedAt: NOW,
    })
    respond({})
    expect(await client().fetchUsage(ACCESS)).toMatchObject({ fiveHour: null, sevenDay: null })
  })

  it('rejects a response of the wrong shape as BadResponse (field paths only)', async () => {
    respond({ five_hour: { utilization: 'lots', resets_at: 'yesterday' } })
    const err = await failure(client().fetchUsage(ACCESS))
    expect(err).toBeInstanceOf(BadResponseError)
    expect((err as Error).message).toContain('five_hour.utilization')
  })

  it('rejects a non-JSON body as BadResponse', async () => {
    respond('<html>oops</html>', { status: 200 })
    expect(await failure(client().fetchUsage(ACCESS))).toBeInstanceOf(BadResponseError)
  })
})

describe('refresh', () => {
  it('posts the refresh_token grant as JSON', async () => {
    respond(await fixture('token.json'))
    await client().refresh(previous)

    const { url, init, headers } = lastCall()
    expect(url).toBe('http://127.0.0.1:9/oauth/token')
    expect(init.method).toBe('POST')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('user-agent')).toBe(`claude-swap/${version}`)
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: previous.refreshToken,
      client_id: CLAUDE_CODE_CLIENT_ID,
    })
    expect(CLAUDE_CODE_CLIENT_ID).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps the response onto the previous claudeAiOauth value', async () => {
    respond(await fixture('token.json'))
    expect(await client().refresh(previous)).toEqual({
      accessToken: 'fake-access-token-refreshed',
      refreshToken: 'fake-refresh-token-rotated',
      expiresAt: NOW.getTime() + 28_800_000,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_20x',
    })
  })

  it('keeps previous scopes and refresh token when the response omits them', async () => {
    respond({ access_token: 'fake-access-token-2', expires_in: 60 })
    expect(await client().refresh(previous)).toMatchObject({
      accessToken: 'fake-access-token-2',
      refreshToken: previous.refreshToken,
      expiresAt: NOW.getTime() + 60_000,
      scopes: ['user:inference'],
    })
  })

  it('rejects a token response of the wrong shape without echoing it', async () => {
    respond({ access_token: 'fake-access-token-SECRET', expires_in: 'soon' })
    expect(await failure(client().refresh(previous))).toBeInstanceOf(BadResponseError)
  })
})

describe('error mapping', () => {
  const calls = {
    usage: () => client().fetchUsage(ACCESS),
    refresh: () => client().refresh(previous),
  }

  for (const [name, call] of Object.entries(calls)) {
    describe(name, () => {
      it('401 → Unauthorized', async () => {
        respond({ error: { type: 'authentication_error' } }, { status: 401 })
        expect(await failure(call())).toBeInstanceOf(UnauthorizedError)
      })

      it('400 invalid_grant → InvalidGrant', async () => {
        respond(
          { error: 'invalid_grant', error_description: 'Invalid refresh token' },
          { status: 400 },
        )
        expect(await failure(call())).toBeInstanceOf(InvalidGrantError)
      })

      it('other 400 → BadResponse with the status', async () => {
        respond({ error: 'invalid_request' }, { status: 400 })
        const err = await failure(call())
        expect(err).toBeInstanceOf(BadResponseError)
        expect(err).toMatchObject({ status: 400 })
      })

      it('400 with a non-JSON body → BadResponse', async () => {
        respond('nope', { status: 400 })
        expect(await failure(call())).toBeInstanceOf(BadResponseError)
      })

      it('5xx → BadResponse', async () => {
        respond('upstream down', { status: 503 })
        expect(await failure(call())).toMatchObject({ name: 'BadResponseError', status: 503 })
      })

      it('fetch failure → Network, without the original error', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed ${ACCESS}`))
        const err = await failure(call())
        expect(err).toBeInstanceOf(NetworkError)
        expect(err).not.toHaveProperty('cause')
      })

      it('timeout → Network', async () => {
        fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
        expect(await failure(call())).toMatchObject({
          name: 'NetworkError',
          reason: 'TimeoutError',
        })
      })
    })
  }

  it.each([
    ['120', 120],
    ['0', 0],
    ['Thu, 19 Nov 2026 10:01:30 GMT', 90],
    ['Thu, 19 Nov 2026 09:00:00 GMT', 0],
    ['garbage', null],
    [null, null],
  ])('429 Retry-After %s → RateLimited(retryAfter=%s)', async (header, expected) => {
    respond({}, { status: 429, headers: header === null ? {} : { 'retry-after': header } })
    const err = await failure(client().fetchUsage(ACCESS))
    expect(err).toBeInstanceOf(RateLimitedError)
    expect(err).toMatchObject({ retryAfter: expected })
  })
})
