import type { Page } from '@playwright/test'
import {
  dashboard,
  expect,
  expectLive,
  type FakeAccount,
  fakeAccount,
  importLogin,
  runEngine,
  test,
} from './fixtures'

const row = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Accounts by priority' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) })

const usageOf = async (request: Parameters<typeof dashboard>[0], account: FakeAccount) =>
  (await dashboard(request)).usage[account.uuid]

test('429 on usage → error shown, polls back off until Retry-After', async ({
  page,
  app,
  mock,
  request,
}) => {
  const a = fakeAccount('Alpha')
  await importLogin(app, request, a)
  await mock.control({ token: a.accessToken, fail: 429 })
  await runEngine(request)
  await expect.poll(async () => (await usageOf(request, a))?.error).toMatch(/rate limited/)
  await page.goto('/')
  await expect(row(page, 'Alpha')).toContainText('Last check failed: Anthropic API rate limited')

  // The mock answers again, but the 60 s Retry-After keeps the engine from asking.
  await mock.control({ token: a.accessToken, fail: null })
  const before = (await dashboard(request)).engine.lastTickAt
  await runEngine(request)
  await expect.poll(async () => (await dashboard(request)).engine.lastTickAt).not.toBe(before)
  expect((await usageOf(request, a))?.error).toMatch(/rate limited/)
})

test('401 on an inactive account → refreshed at once, its usage recovers', async ({
  app,
  mock,
  request,
}) => {
  const a = fakeAccount('Alpha')
  const b = fakeAccount('Bravo')
  await importLogin(app, request, a)
  await importLogin(app, request, b)
  await expectLive(app, a) // B is now inactive: its tokens are ours to refresh
  await mock.control({ token: b.accessToken, fail: 401 })
  await runEngine(request)
  await expect
    .poll(async () => await usageOf(request, b))
    .toMatchObject({ fiveHour: { utilization: 10 } })
  expect((await usageOf(request, b))?.error).toBeUndefined()
})

test('401 on an inactive account whose refresh is refused → needs re-login', async ({
  page,
  app,
  mock,
  request,
}) => {
  const a = fakeAccount('Alpha')
  const b = fakeAccount('Bravo')
  await importLogin(app, request, a)
  await importLogin(app, request, b)
  await expectLive(app, a)
  await mock.control({ token: b.accessToken, fail: 401 })
  await mock.control({ token: b.refreshToken, fail: 'invalid_grant' })
  await runEngine(request)
  await page.goto('/')
  await expect(row(page, 'Bravo')).toContainText('Needs re-login')
})
