import * as z from 'zod'
import {
  BadResponseError,
  InvalidGrantError,
  NetworkError,
  RateLimitedError,
  UnauthorizedError,
} from '@/application/anthropic-errors'
import type { Clock, OAuthTokens, TokenRefresher, UsageApi } from '@/application/ports'
import type { UsageSnapshot, UsageWindow } from '@/domain/usage'
import { version } from '../../../package.json'
import { isoDate } from '../repositories/schemas'

type Env = Readonly<Record<string, string | undefined>>

/** Claude Code's public OAuth client id. */
export const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const TIMEOUT_MS = 10_000
const USER_AGENT = `claude-swap/${version}`

/** Unofficial endpoints, overridable so tests hit a mock server. Empty env values count as unset. */
export function anthropicEndpoints(env: Env = process.env) {
  return {
    apiBaseUrl: env.CLAUDE_SWAP_API_BASE_URL || 'https://api.anthropic.com',
    tokenUrl: env.CLAUDE_SWAP_OAUTH_TOKEN_URL || 'https://platform.claude.com/v1/oauth/token',
  }
}

// Tolerant: unknown keys pass, a window may be null or missing, resets_at may be null.
const windowSchema = z.looseObject({ utilization: z.number(), resets_at: isoDate.nullable() })
const usageSchema = z.looseObject({
  five_hour: windowSchema.nullish(),
  seven_day: windowSchema.nullish(),
})

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
})

const errorBodySchema = z.looseObject({ error: z.string() })

export interface AnthropicClientDeps {
  readonly apiBaseUrl: string
  readonly tokenUrl: string
  readonly clock: Clock
}

/** HTTP adapter for the usage and OAuth token endpoints (architecture §3). */
export class AnthropicClient implements UsageApi, TokenRefresher {
  constructor(private readonly deps: AnthropicClientDeps) {}

  async fetchUsage(accessToken: string): Promise<UsageSnapshot> {
    const url = `${this.deps.apiBaseUrl.replace(/\/+$/, '')}/api/oauth/usage`
    const body = await this.send(url, {
      headers: { authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
    })
    const usage = parse(usageSchema, body)
    return {
      fiveHour: toWindow(usage.five_hour),
      sevenDay: toWindow(usage.seven_day),
      fetchedAt: this.deps.clock.now(),
    }
  }

  async refresh(previous: OAuthTokens): Promise<OAuthTokens> {
    const body = await this.send(this.deps.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: previous.refreshToken,
        client_id: CLAUDE_CODE_CLIENT_ID,
      }),
    })
    const token = parse(tokenSchema, body)
    return {
      ...previous,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? previous.refreshToken,
      expiresAt: this.deps.clock.now().getTime() + token.expires_in * 1000,
      ...(token.scope ? { scopes: token.scope.split(' ').filter(Boolean) } : {}),
    }
  }

  /** Parsed JSON of a 2xx response; every other outcome becomes a typed error without secrets. */
  private async send(url: string, init: RequestInit & { headers: Record<string, string> }) {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...init.headers, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // Name only: the original error (and its cause) could echo request details.
      throw new NetworkError(err instanceof Error ? err.name : 'unknown')
    }
    // Unread bodies keep undici's connection busy until GC: release them before throwing.
    if (response.status === 401 || response.status === 429)
      await response.body?.cancel().catch(() => {})
    if (response.status === 401) throw new UnauthorizedError()
    if (response.status === 429) {
      throw new RateLimitedError(
        retryAfterSeconds(response.headers.get('retry-after'), this.deps.clock),
      )
    }
    const json: unknown = await response.json().catch(() => undefined)
    if (response.ok) {
      if (json === undefined) throw new BadResponseError(response.status, 'invalid JSON')
      return json
    }
    if (
      response.status === 400 &&
      errorBodySchema.safeParse(json).data?.error === 'invalid_grant'
    ) {
      throw new InvalidGrantError()
    }
    throw new BadResponseError(response.status, `HTTP ${response.status}`)
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  // Field paths only: zod messages may quote received values, which can be tokens.
  const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))]
  throw new BadResponseError(200, `unexpected shape at ${paths.join(', ')}`)
}

function toWindow(
  window: { utilization: number; resets_at: Date | null } | null | undefined,
): UsageWindow | null {
  return window ? { utilization: window.utilization, resetsAt: window.resets_at } : null
}

/** `Retry-After` is either delta-seconds or an HTTP date (RFC 9110). */
function retryAfterSeconds(header: string | null, clock: Clock): number | null {
  if (!header) return null
  const seconds = /^\d+$/.test(header) ? Number(header) : null
  if (seconds !== null) return seconds
  const at = Date.parse(header)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - clock.now().getTime()) / 1000))
}
