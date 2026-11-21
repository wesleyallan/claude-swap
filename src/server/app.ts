// Hono app: security middleware, JSON API under /api, static SPA with templated index.html.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import * as z from 'zod'
import {
  getCurrentLogin,
  getDashboard,
  getHistory,
  importCurrentLogin,
  NotLoggedInError,
  promoteAccount,
  removeAccount,
  renameAccount,
  reorderAccounts,
  setAccountEnabled,
  updatePreferences,
} from '@/application/use-cases'
import { AccountNotFoundError, InvalidOrderError } from '@/domain/errors'
import type { Preferences } from '@/domain/preferences'
import { ClaudeCodeFileError } from '@/infrastructure/claude-code/claude-code-session'
import type { Container } from './container'
import { toAccountDto, toDashboardDto, toHistoryDto } from './dto'

const percent = z.number().min(0).max(100)
const preferencesPatch = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    locale: z.enum(['en', 'es', 'pt-BR']),
    autoRotate: z.boolean(),
    thresholds: z.strictObject({ fiveHour: percent, sevenDay: percent }),
    pollIntervalSec: z.number().int().min(10).max(86_400),
  })
  .partial()
  .strict()
const accountPatch = z
  .strictObject({ label: z.string().trim().min(1).max(100), enabled: z.boolean() })
  .partial()
  .refine((p) => p.label !== undefined || p.enabled !== undefined, 'Nothing to update')
// Blank = keep the default label (the use case trims). No body / no JSON content type reads as {}.
const importBody = z.strictObject({ label: z.string().max(100) }).partial()
const orderBody = z.strictObject({ ids: z.array(z.string().min(1)).max(1000) })
const idParam = z.object({ id: z.string().min(1) })

/** zValidator with a uniform 400 body: field paths and messages only, never the input. */
const validate = <T extends z.ZodType, Target extends 'json' | 'param'>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      return c.json({ error: 'validation' as const, issues }, 400)
    }
  })

const ok = (c: Context) => c.json({ ok: true as const })

/** DNS rebinding: only `localhost:<port>` / `127.0.0.1:<port>`. CSRF: a present Origin must be same-origin. */
function guard(port: number): MiddlewareHandler {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])
  return async (c, next) => {
    // node-server builds the URL from the Host header; app.request() from the given URL.
    const host = new URL(c.req.url).host
    if (!hosts.has(host)) return c.json({ error: 'forbidden-host' }, 403)
    const origin = c.req.header('origin')
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
    if (!safe && origin !== undefined && origin !== `http://${host}`) {
      return c.json({ error: 'forbidden-origin' }, 403)
    }
    await next()
  }
}

/** serveStatic + Cache-Control on hits (`onFound` sets it before the response exists, so it is lost). */
function files(root: string, cacheControl: string): MiddlewareHandler {
  const serve = serveStatic({ root })
  return async (ctx, next) => {
    const res = await serve(ctx, next)
    // On a miss serveStatic returns whatever `next()` resolved to, which is not a Response.
    if (!(res instanceof Response)) return
    res.headers.set('Cache-Control', cacheControl)
    return res
  }
}

export function createApp(c: Container) {
  const api = new Hono()
    .get('/health', (ctx) => ctx.json({ status: 'ok' as const }))
    .get('/dashboard', async (ctx) => ctx.json(toDashboardDto(await getDashboard(c))))
    .get('/history', async (ctx) => ctx.json(toHistoryDto(await getHistory(c))))
    .get('/accounts/current', async (ctx) => ctx.json({ login: await getCurrentLogin(c) }))
    .post('/accounts/import', validate('json', importBody), async (ctx) =>
      ctx.json(toAccountDto(await importCurrentLogin(c, ctx.req.valid('json'))), 201),
    )
    .put('/accounts/order', validate('json', orderBody), async (ctx) => {
      await reorderAccounts(c, ctx.req.valid('json').ids)
      return ok(ctx)
    })
    .patch(
      '/accounts/:id',
      validate('param', idParam),
      validate('json', accountPatch),
      async (ctx) => {
        const { id } = ctx.req.valid('param')
        const { label, enabled } = ctx.req.valid('json')
        if (label !== undefined) await renameAccount(c, id, label)
        if (enabled !== undefined) await setAccountEnabled(c, id, enabled)
        return ok(ctx)
      },
    )
    .delete('/accounts/:id', validate('param', idParam), async (ctx) => {
      await removeAccount(c, ctx.req.valid('param').id)
      return ok(ctx)
    })
    .post('/accounts/:id/promote', validate('param', idParam), async (ctx) => {
      await promoteAccount(c, ctx.req.valid('param').id)
      return ok(ctx)
    })
    .get('/preferences', async (ctx) => ctx.json((await c.config.load()).preferences))
    .patch('/preferences', validate('json', preferencesPatch), async (ctx) =>
      // zod's partial output has `key?: T | undefined`; the use case wants exact optionals.
      ctx.json(await updatePreferences(c, ctx.req.valid('json') as Partial<Preferences>)),
    )
    .post('/engine/run', async (ctx) => {
      await c.engine.runNow()
      return ok(ctx)
    })

  const app = new Hono()
  app.use(
    guard(c.port),
    compress(),
    secureHeaders({
      // Everything is same-origin; Base UI/Recharts set inline `style` attributes (and shadcn's
      // chart a <style> element), so styles need 'unsafe-inline'. Scripts never do.
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      xFrameOptions: 'DENY',
    }),
  )
  app.onError((err, ctx) => {
    if (err instanceof AccountNotFoundError) return ctx.json({ error: 'account-not-found' }, 404)
    if (err instanceof InvalidOrderError) return ctx.json({ error: 'invalid-order' }, 400)
    if (err instanceof NotLoggedInError) return ctx.json({ error: 'not-logged-in' }, 409)
    if (err instanceof ClaudeCodeFileError) return ctx.json({ error: 'claude-code-file' }, 409)
    if (err instanceof HTTPException && err.status < 500) {
      return ctx.json({ error: 'bad-request' }, err.status)
    }
    c.logger.error('request failed', { method: ctx.req.method, path: ctx.req.path, err })
    return ctx.json({ error: 'internal' }, 500)
  })
  const routes = app.route('/api', api)
  app.all('/api/*', (ctx) => ctx.json({ error: 'not-found' }, 404))

  // Vite emits content-hashed files under assets/: cache them forever; a miss is a real 404.
  app.use('/assets/*', files(c.webRoot, 'public, max-age=31536000, immutable'))
  app.get('/assets/*', (ctx) => ctx.text('Not found', 404))

  const spa = async (ctx: Context) => {
    let html: string
    try {
      html = await readFile(join(c.webRoot, 'index.html'), 'utf8')
    } catch {
      return ctx.text('UI not built: run `npm run build`', 503)
    }
    const { theme, locale } = (await c.config.load()).preferences
    // `theme: system` gets no class (CSS follows prefers-color-scheme); both are validated enums.
    const tag = `<html lang="${locale}"${theme === 'system' ? '' : ` class="${theme}"`}>`
    ctx.header('Cache-Control', 'no-cache')
    return ctx.html(html.replace(/<html[^>]*>/i, tag))
  }
  app.get('/', spa)
  app.get('/index.html', spa)
  app.use('*', files(c.webRoot, 'no-cache'))
  app.get('*', spa)

  return routes
}

export type AppType = ReturnType<typeof createApp>
