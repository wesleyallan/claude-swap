# T09 — Dashboard: charts & sortable account list

Skills: `design-taste-frontend`, `ui-ux-pro-max`, `shadcn`, `vercel-react-best-practices`, `vercel-composition-patterns`.

## Do (one screen, architecture §6)
- Top: stat tiles (active account, next reset countdown, swaps in last 24 h, engine mode) + chart of utilization over time
  (5h and 7d series, per account, shadcn chart/Recharts, lazy-loaded chunk). Accessible: legend, tooltip, data table fallback/aria summary.
- Below: ordered account list with dnd-kit sortable (pointer + keyboard sensors, visible drag handle, announcements i18n'd)
  and explicit move up/down buttons. Optimistic reorder via `PUT /accounts/order`, rollback on error with toast.
- Row: priority number, label + email, plan badge, `Active` badge, 5h and 7d progress bars with % and reset countdown,
  status chip (ok / exhausted / needs re-auth / disabled / unknown), `Use now` (promote), enabled switch, remove button (links to T10 modal route).
- Banners: unknown logged-in account (offer import), engine errors, no accounts empty state with CTA.
- Loading skeletons, error states, all strings i18n'd, bars colored by DESIGN.md success/warning/error at thresholds.

## Verify
Component tests for row states and reorder (keyboard). Playwright MCP screenshots light/dark × 3 locales, 1280 and 375 px; polish until it looks premium.

## Done when
Green + commits `feat(web): ...`.
