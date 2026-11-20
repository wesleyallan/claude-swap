import { dashboard, expect, test } from './fixtures'

test('settings persist across a reload', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Dark' }).click()
  await dialog.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'Español' }).click()
  await dialog.getByLabel('5-hour limit (%)').fill('90')
  await dialog.getByLabel('Weekly limit (%)').fill('97')
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(async () => (await dashboard(request)).preferences)
    .toMatchObject({ theme: 'dark', locale: 'es', thresholds: { fiveHour: 90, sevenDay: 97 } })

  await page.reload()
  // The server renders theme and language into <html>, so they hold before any script runs.
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { name: 'Cuentas' })).toBeVisible()

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await expect(dialog.getByLabel('Límite de 5 horas (%)')).toHaveValue('90')
  await expect(dialog.getByLabel('Límite semanal (%)')).toHaveValue('97')
})
