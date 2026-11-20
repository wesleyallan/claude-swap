// Failures of the UsageApi / TokenRefresher ports. Messages never carry tokens or response bodies.

/** HTTP 401: the access token is expired or revoked. */
export class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError'
  constructor() {
    super('Anthropic API rejected the access token (401)')
  }
}

/** HTTP 400 `invalid_grant`: the refresh token is dead; the account needs a new /login. */
export class InvalidGrantError extends Error {
  override readonly name = 'InvalidGrantError'
  constructor() {
    super('Anthropic OAuth rejected the refresh token (invalid_grant)')
  }
}

/** HTTP 429. `retryAfter` is in seconds, `null` when the server did not say. */
export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError'
  constructor(readonly retryAfter: number | null) {
    super(`Anthropic API rate limited (retry after ${retryAfter ?? '?'} s)`)
  }
}

/** The request never got a response (DNS, connection, timeout). `reason` is the error name only. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError'
  constructor(readonly reason: string) {
    super(`Anthropic API unreachable: ${reason}`)
  }
}

/** Unexpected status or a body that is not the expected JSON shape. */
export class BadResponseError extends Error {
  override readonly name = 'BadResponseError'
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Unexpected Anthropic API response (${status}): ${reason}`)
  }
}

export type AnthropicApiError =
  | UnauthorizedError
  | InvalidGrantError
  | RateLimitedError
  | NetworkError
  | BadResponseError
