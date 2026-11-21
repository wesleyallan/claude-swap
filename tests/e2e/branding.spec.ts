import { dashboard, expect, fakeAccount, importLogin, test } from './fixtures'

test('serves the icons and names the tab after the active account', async ({
  page,
  app,
  request,
}) => {
  for (const path of ['/favicon.ico', '/logo.svg', '/apple-touch-icon.png', '/site.webmanifest']) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
  await page.goto('/')
  await expect(page).toHaveTitle('Claude Swap')
  const a = fakeAccount('Pessoal')
  await importLogin(app, request, a)
  await expect.poll(async () => (await dashboard(request)).activeId).toBe(a.uuid)
  await expect(page).toHaveTitle('Pessoal - Claude Swap')
})

test('opens the documentation in the UI language', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).hover()
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toHaveText('Settings')
  await page.getByRole('button', { name: 'Documentation' }).hover()
  await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toHaveText('Documentation')
  await page.getByRole('button', { name: 'Documentation' }).click()
  const dialog = page.getByRole('dialog', { name: 'Documentation' })
  await dialog.getByRole('navigation').getByRole('button', { name: 'Running sessions' }).click()
  await expect(dialog.getByRole('heading', { name: 'Running sessions' })).toBeVisible()
})
