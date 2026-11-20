import { defineConfig, devices } from '@playwright/test'

// No shared webServer: tests/e2e/fixtures.ts starts the built app per test (own temp HOME,
// CLAUDE_SWAP_HOME, CLAUDE_CONFIG_DIR) against a per-worker mock Anthropic API.
// `npm run test:e2e` builds first.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // The dashboard polls every 10 s, so UI assertions on engine changes may wait one poll.
  expect: { timeout: 15_000 },
  use: { trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
