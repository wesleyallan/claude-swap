import * as z from 'zod'
import { DEFAULT_PREFERENCES } from '@/domain/preferences'

/** Every data file is at this schema version; bump it together with a migration. */
export const SCHEMA_VERSION = 1

/** ISO string on disk ↔ `Date` in memory. */
export const isoDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})

const percent = z.number().min(0).max(100)
const P = DEFAULT_PREFERENCES

// Per-field defaults: a hand-edited config missing a key keeps the rest instead of being reset.
export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default(P.theme),
  locale: z.enum(['en', 'es', 'pt-BR']).default(P.locale),
  autoRotate: z.boolean().default(P.autoRotate),
  thresholds: z
    .object({
      fiveHour: percent.default(P.thresholds.fiveHour),
      sevenDay: percent.default(P.thresholds.sevenDay),
    })
    .default(P.thresholds),
  pollIntervalSec: z.number().int().min(10).default(P.pollIntervalSec),
})

/** `oauthAccount` (Claude Code identity): unknown keys (organizationUuid, displayName, …) are preserved. */
export const oauthAccountSchema = z.looseObject({
  accountUuid: z.string().min(1),
  emailAddress: z.string(),
})

export const accountSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  email: z.string(),
  organizationName: z.string().nullable(),
  subscriptionType: z.string().nullable(),
  enabled: z.boolean(),
  needsReauth: z.boolean().default(false),
  addedAt: isoDate,
  oauthAccount: oauthAccountSchema,
})

export const configSchema = z.object({
  preferences: preferencesSchema.default(P),
  accounts: z
    .array(accountSchema)
    .refine((a) => new Set(a.map((x) => x.id)).size === a.length, 'duplicate account id'),
})

/** `claudeAiOauth`: unknown keys (scopes, rateLimitTier, …) are preserved. */
export const oauthTokensSchema = z.looseObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
})

export const secretsSchema = z.object({ tokens: z.record(z.string(), oauthTokensSchema) })

const usageWindow = z.object({ utilization: z.number(), resetsAt: isoDate.nullable() })

export const usageSnapshotSchema = z.object({
  fiveHour: usageWindow.nullable(),
  sevenDay: usageWindow.nullable(),
  fetchedAt: isoDate,
  error: z.string().exactOptional(),
})

export const historyPointSchema = z.object({
  t: isoDate,
  accountId: z.string(),
  fiveHour: z.number().nullable(),
  sevenDay: z.number().nullable(),
})

export const activityEntrySchema = z.discriminatedUnion('type', [
  z.object({
    t: isoDate,
    type: z.literal('swap'),
    from: z.string().nullable(),
    to: z.string(),
    reason: z.enum(['top-priority', 'auto-exhausted', 'auto-reset', 'manual', 'all-exhausted']),
  }),
  z.object({
    t: isoDate,
    type: z.enum(['account-added', 'account-removed', 'needs-reauth', 'error']),
    accountId: z.string().exactOptional(),
    message: z.string().exactOptional(),
  }),
])

export const stateSchema = z.object({
  usage: z.record(z.string(), usageSnapshotSchema),
  history: z.array(historyPointSchema),
  activity: z.array(activityEntrySchema),
  lastActiveId: z.string().nullable(),
})
