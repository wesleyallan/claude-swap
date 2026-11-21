import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, fakeAccount, importLogin, test } from './fixtures'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page) {
  // Let entry animations finish so contrast is measured on final colors.
  await page.waitForTimeout(400)
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => `${n.target} ${n.failureSummary}`),
    })),
  ).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test(`dashboard and modals have no WCAG A/AA violations (${theme})`, async ({
    page,
    app,
    request,
  }) => {
    await importLogin(app, request, fakeAccount('Alpha'))
    await importLogin(app, request, fakeAccount('Bravo'))
    expect((await request.patch('/api/preferences', { data: { theme } })).ok()).toBe(true)
    const { accounts } = await (await request.get('/api/dashboard')).json()

    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await expect(page.getByRole('list', { name: 'Accounts by priority' })).toBeVisible()
    await expectNoViolations(page)

    for (const path of [
      '/settings',
      '/docs',
      '/accounts/new',
      `/accounts/${accounts[1].id}/remove`,
    ]) {
      await page.goto(path)
      await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible()
      await expectNoViolations(page)
    }

    await page.goto('/docs-dev')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Developer documentation' }),
    ).toBeVisible()
    await expectNoViolations(page)
  })
}
