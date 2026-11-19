# T10 — Modal routes: add account, settings, remove

Skills: `shadcn`, `design-taste-frontend`, `vercel-composition-patterns`.

## Do
- Modals are routes rendered over the dashboard (back button closes, URL shareable, direct load renders dashboard + modal):
  - `/accounts/new`: step-by-step instructions (run `claude`, `/login` with the account — **not** `/logout`), shows the currently detected login, `Import current login` button, optional label field. Re-import of a known account = "tokens updated".
  - `/settings`: theme (light/dark/system), language, auto-rotate switch, thresholds 5h/7d (50–100), poll interval (60–3600 s). zod-validated form, inline errors.
  - `/accounts/:id/remove`: confirm dialog (warn if it's the active account).
- Focus trap, Esc closes, return focus to the trigger, i18n everything.

## Verify
Component tests for forms/validation. Playwright MCP run through each modal in both themes.

## Done when
Green + commits `feat(web): ...`.
