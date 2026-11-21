import type { Page } from '@playwright/test'
import { dashboard, expect, expectLive, fakeAccount, importLogin, test } from './fixtures'

const rowNames = (page: Page) =>
  page.getByRole('list', { name: 'Accounts by priority' }).getByRole('heading', { level: 3 })

const row = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Accounts by priority' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) })

const apiOrder = async (request: Parameters<typeof dashboard>[0]) =>
  (await dashboard(request)).accounts.map((a: { label: string }) => a.label)

test('imports two accounts through the Add account modal', async ({ page, app, request }) => {
  const a = fakeAccount('Alpha')
  const b = fakeAccount('Bravo')
  await page.goto('/')
  await expect(page.getByText('No accounts yet')).toBeVisible()

  for (const account of [a, b]) {
    await app.login(account)
    await page.getByRole('button', { name: 'Add account' }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(page).toHaveURL(/\/accounts\/new$/)
    await expect(dialog.getByText(account.email)).toBeVisible()
    await dialog.getByLabel('Name (optional)').fill(account.name)
    await dialog.getByRole('button', { name: 'Import current login' }).click()
    await expect(page.getByText(`${account.name} added`)).toBeVisible()
    await expect(dialog).toBeHidden()
  }

  await expect(rowNames(page)).toHaveText(['Alpha', 'Bravo'])
  expect(await apiOrder(request)).toEqual(['Alpha', 'Bravo'])
  // Bravo was the last /login, but Alpha is first in the list: the engine swaps back to it.
  await expectLive(app, a)
  // A swap writes the credentials first, then .claude.json: wait for the second write too.
  await expect
    .poll(async () => (await app.claudeFiles()).claudeJson.oauthAccount?.accountUuid)
    .toBe(a.uuid)
  const files = await app.claudeFiles()
  expect(files.credentials.mcpOAuth).toEqual({ fake: 'keep-me' })
  expect(files.claudeJson).toMatchObject({ numStartups: 7, oauthAccount: { accountUuid: a.uuid } })
})

test.describe('with three accounts', () => {
  test.beforeEach(async ({ app, request, page }) => {
    for (const name of ['Alpha', 'Bravo', 'Charlie'])
      await importLogin(app, request, fakeAccount(name))
    await page.goto('/')
    await expect(rowNames(page)).toHaveText(['Alpha', 'Bravo', 'Charlie'])
  })

  test('reorders by dragging the handle with the mouse', async ({ page, request }) => {
    const handle = page.getByRole('button', { name: 'Reorder Charlie' })
    await handle.scrollIntoViewIfNeeded()
    const from = await handle.boundingBox()
    const to = await row(page, 'Alpha').boundingBox()
    if (!from || !to) throw new Error('rows not laid out')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // Small steps so dnd-kit sees the pointer pass over each row; settle before dropping.
    await page.mouse.move(from.x + from.width / 2, to.y + 10, { steps: 30 })
    await page.mouse.move(from.x + from.width / 2, to.y + 5, { steps: 5 })
    await page.mouse.up()

    await expect(rowNames(page)).toHaveText(['Charlie', 'Alpha', 'Bravo'])
    await expect.poll(() => apiOrder(request)).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  test('reorders by keyboard with the drag handle', async ({ page, request }) => {
    const handle = page.getByRole('button', { name: 'Reorder Alpha' })
    await handle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')

    await expect(rowNames(page)).toHaveText(['Bravo', 'Alpha', 'Charlie'])
    await expect.poll(() => apiOrder(request)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  test('reorders with the move buttons', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Move Charlie up' }).click()
    await expect(rowNames(page)).toHaveText(['Alpha', 'Charlie', 'Bravo'])
    await expect.poll(() => apiOrder(request)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  test('Use now swaps the Claude Code credentials file', async ({ page, app, request }) => {
    const { accounts } = await dashboard(request)
    const bravo = accounts.find((a: { label: string }) => a.label === 'Bravo')
    await page.getByRole('button', { name: 'Use now: Bravo' }).click()

    await expect(rowNames(page)).toHaveText(['Bravo', 'Alpha', 'Charlie'])
    await expect
      .poll(async () => (await app.claudeFiles()).claudeJson.oauthAccount?.accountUuid)
      .toBe(bravo.id)
    await expect(row(page, 'Bravo')).toContainText('Active')
    await expect
      .poll(async () => (await dashboard(request)).activity)
      .toContainEqual(expect.objectContaining({ type: 'swap', to: bravo.id, reason: 'manual' }))
  })

  test('removes an account', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Remove Bravo' }).click()
    await expect(page).toHaveURL(/\/accounts\/.+\/remove$/)
    await page.getByRole('button', { name: 'Remove account' }).click()

    await expect(page.getByText('Bravo removed')).toBeVisible()
    await expect(rowNames(page)).toHaveText(['Alpha', 'Charlie'])
    expect(await apiOrder(request)).toEqual(['Alpha', 'Charlie'])
  })
})
