# T05 — Anthropic usage & OAuth client

Skills: `tdd`, `vitest`. Spec: architecture §3.

## Do
- Ports: `UsageApi.fetchUsage(accessToken) → UsageSnapshot`, `TokenRefresher.refresh(refreshToken) → oauth`.
- Adapter `infrastructure/anthropic/` using global `fetch` (no axios), `AbortSignal.timeout(10_000)`,
  base URLs from env (`CLAUDE_SWAP_API_BASE_URL` default `https://api.anthropic.com`, `CLAUDE_SWAP_OAUTH_TOKEN_URL` default `https://platform.claude.com/v1/oauth/token`), client id constant.
- Usage: headers `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-swap/<version>` (no personal data).
  Tolerant zod parse (`passthrough`, nullable windows, `resets_at` ISO → Date) mapped to domain types.
- Refresh: JSON body `{ grant_type, refresh_token, client_id }`; map response (`access_token`, `refresh_token`, `expires_in` → `expiresAt` ms) into the `claudeAiOauth` shape, keeping scopes/subscriptionType from the previous value when absent.
- Typed errors: `Unauthorized` (401), `InvalidGrant` (400 invalid_grant), `RateLimited` (429, with `retryAfter`), `Network`, `BadResponse`.
- Errors and logs must never contain tokens (test it).

## Tests
Stub `fetch` (vi.fn) with recorded-shape JSON (use the real key set from architecture §3, fake values). Cover every error mapping.

## Done when
Green + commit `feat(anthropic): add usage and oauth refresh client`.
