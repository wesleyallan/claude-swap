import type { Page } from '@playwright/test'
import {
  dashboard,
  expect,
  expectLive,
  fakeAccount,
  importLogin,
  runEngine,
  test,
} from './fixtures'

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

const row = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Accounts by priority' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) })

test('auto-swaps away from an exhausted account and back once it resets', async ({
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
  await page.goto('/')
  await expect(row(page, 'Alpha')).toContainText('Active')

  // A hits 100 % of its 5-hour window → the engine moves Claude Code to B.
  await mock.control({ token: a.accessToken, fiveHour: { utilization: 100, resetsAt: inHours(2) } })
  await runEngine(request)
  await expectLive(app, b)
  expect((await app.claudeFiles()).claudeJson.oauthAccount.accountUuid).toBe(b.uuid)
  await expect(row(page, 'Bravo')).toContainText('Active')
  await expect(row(page, 'Alpha')).toContainText('Limit reached')
  await expect
    .poll(async () => (await dashboard(request)).activity)
    .toContainEqual(
      expect.objectContaining({ type: 'swap', from: a.uuid, to: b.uuid, reason: 'auto-exhausted' }),
    )
  // Two swaps: importing B made it the live login, so the engine first went back to A.
  await expect(page.getByText('2 automatic or manual swaps')).toBeVisible()

  // A's window resets (resets_at is now in the past) → back to A, the higher priority.
  await mock.control({
    token: a.accessToken,
    fiveHour: { utilization: 100, resetsAt: new Date(Date.now() - 1000).toISOString() },
  })
  await runEngine(request)
  await expectLive(app, a)
  await expect(row(page, 'Alpha')).toContainText('Active')
  await expect
    .poll(async () => (await dashboard(request)).activity)
    .toContainEqual(
      expect.objectContaining({ type: 'swap', from: b.uuid, to: a.uuid, reason: 'auto-reset' }),
    )
})

test('marks an account needing re-login when its refresh token is revoked', async ({
  page,
  app,
  mock,
  request,
}) => {
  const a = fakeAccount('Alpha')
  // Expires within the 10-minute refresh window, so claude-swap refreshes it once inactive.
  const b = fakeAccount('Bravo', { expiresAt: Date.now() + 5 * 60_000 })
  await mock.control({ token: b.refreshToken, fail: 'invalid_grant' })
  await importLogin(app, request, a)
  await importLogin(app, request, b)
  await expectLive(app, a) // B is no longer live, so the engine owns its tokens now

  await runEngine(request)
  await page.goto('/')
  await expect(row(page, 'Bravo')).toContainText('Needs re-login')
  await expect(page.getByRole('button', { name: 'Use now: Bravo' })).toBeDisabled()

  // A fresh /login with B and a re-import clears the flag.
  const relogged = {
    ...b,
    refreshToken: `${b.refreshToken}-new`,
    expiresAt: Date.now() + 8 * 3_600_000,
  }
  await importLogin(app, request, relogged)
  await expect(row(page, 'Bravo')).not.toContainText('Needs re-login')
  await expect(page.getByRole('button', { name: 'Use now: Bravo' })).toBeEnabled()
})

test('pauses on an unknown login until it is imported', async ({ page, app, request }) => {
  const a = fakeAccount('Alpha')
  const stranger = fakeAccount('Stranger')
  await importLogin(app, request, a)
  await app.login(stranger)
  await runEngine(request)

  await page.goto('/')
  await expect(page.getByText('Swapping is paused')).toBeVisible()
  await expect(page.getByText(stranger.email).first()).toBeVisible()
  // The engine must not overwrite the fresh /login.
  await runEngine(request)
  await expect.poll(async () => (await dashboard(request)).engine.unknownLogin).toBe(stranger.email)
  await expectLive(app, stranger)

  await page.getByRole('button', { name: 'Import account' }).click()
  await expect(page).toHaveURL(/\/accounts\/new$/)
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog.getByText(stranger.email)).toBeVisible()
  await dialog.getByRole('button', { name: 'Import current login' }).click()

  await expect(page.getByText('Swapping is paused')).toBeHidden()
  await expect(row(page, 'Stranger')).toBeVisible()
  // Imported below Alpha, so the engine resumes and goes back to the top account.
  await expectLive(app, a)
})
