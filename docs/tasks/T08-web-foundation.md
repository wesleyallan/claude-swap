# T08 — Web foundation: design system, theme, i18n, router

Skills: `shadcn`, `design-taste-frontend`, `ui-ux-pro-max`, `vercel-react-best-practices`, `web-design-guidelines`.

## Do
- Design tokens: translate `DESIGN.md` (colors, type scale, radii, spacing, elevation) into Tailwind v4 `@theme` CSS variables,
  light = warm cream canvas / coral primary, dark = DESIGN.md dark surfaces. Fonts via `@fontsource` (self-hosted, no Google calls):
  a serif display close to Copernicus/Tiempos (e.g. Newsreader/Fraunces) + a humanist sans (e.g. Inter). Record the choice.
- shadcn/ui init wired to those tokens (components.json, `src/web/components/ui`). Add only components actually used.
- Theme: toggle in the header's top-right (light/dark, with "system" in settings); optimistic class switch + `PATCH /preferences`; initial theme comes from the server-injected class (no flash).
- i18n with `use-intl`: `messages/en.json` (source), `es.json`, `pt-BR.json`; locale from preferences; language select in header.
  Test: all catalogs have identical key sets and no empty values. Dates/relative times/percentages via Intl formatters.
- API layer: `lib/api.ts` with Hono `hc<AppType>`; TanStack Query client (refetch 10 s, pause when tab hidden).
- TanStack Router (code-based or file-based — pick one, record it): root layout with header (logo, engine status pill, Add account, Settings, language, theme),
  index route placeholder, modal outlet pattern ready for T10.
- Accessibility baseline: skip link, focus rings from tokens, `prefers-reduced-motion`.

## Verify
Component tests (theme toggle, locale switch). Playwright MCP screenshots of the shell in light/dark × en/pt-BR at 1280 and 375 px; fix anything off.

## Done when
Green + commits `feat(web): ...`.
