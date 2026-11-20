import { request as httpRequest } from 'node:http'
import { expect, fakeAccount, importLogin, test } from './fixtures'

/** Raw request so the Host header is exactly what an attacker's DNS-rebinding page would send. */
function rawRequest(port: number, method: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path: '/api/dashboard', headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('rejects a foreign Host header (DNS rebinding)', async ({ app }) => {
  const evil = await rawRequest(app.port, 'GET', { host: `evil.example:${app.port}` })
  expect(evil.status).toBe(403)
  expect(JSON.parse(evil.body)).toEqual({ error: 'forbidden-host' })

  const ok = await rawRequest(app.port, 'GET', { host: `localhost:${app.port}` })
  expect(ok.status).toBe(200)
})

test('rejects a cross-origin mutation (CSRF)', async ({ request }) => {
  const res = await request.post('/api/engine/run', { headers: { origin: 'http://evil.example' } })
  expect(res.status()).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden-origin' })
})

test('never sends tokens to the browser', async ({ request, app }) => {
  const a = fakeAccount('Alpha')
  await importLogin(app, request, a)
  const body = await (await request.get('/api/dashboard')).text()
  expect(body).not.toContain(a.accessToken)
  expect(body).not.toContain(a.refreshToken)
})
