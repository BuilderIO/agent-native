# Legacy Client Fetch Audit (2026-06-03)

These are known legacy client-side route calls found while adding the
`client-methods` rule. Treat them as cleanup targets when editing the relevant
area. Do not migrate them mechanically without reading the local action/data
contracts; some need new actions or helper modules first.

## Highest Priority

- `templates/analytics/app/pages/analyses/AnalysesList.tsx`,
  `templates/analytics/app/pages/analyses/AnalysisDetail.tsx`,
  `templates/analytics/app/components/layout/Sidebar.tsx`, and
  `templates/analytics/app/components/layout/CommandPalette.tsx` use `/api/*`
  for normal app data. `list-analyses` and `get-analysis` already exist; add
  action-backed hooks/helpers for dashboard, explorer, theme, and user-pref
  routes.
- `templates/slides/app/context/DeckContext.tsx` and
  `templates/slides/app/pages/Presentation.tsx` use `/api/decks` for deck CRUD.
  `list-decks` and `get-deck` already exist; add or expose UI-safe actions for
  upsert/delete flows before migrating.
- `templates/mail/app/hooks/use-emails.ts`,
  `templates/mail/app/hooks/use-scheduled-jobs.ts`,
  `templates/mail/app/hooks/use-automations.ts`, and
  `templates/mail/app/pages/SettingsPage.tsx` still use `/api/*` for normal
  email/settings/automation work. Reuse existing actions where possible and add
  missing structured actions for aliases, scheduled jobs, and automation
  settings.
- `templates/calendar/app/hooks/use-events.ts` bypasses existing private event
  actions for event CRUD. Prefer `get-event`, `update-event`, `delete-event`,
  and `rsvp-event` through action hooks or `callAction`.

## Medium Priority

- Raw action endpoint calls remain in several client flows, including Gmail
  filters, calendar people search, slides import, videos composition generation,
  and design variant flow. Prefer hooks or `callAction`.
- Template navigation hooks duplicate application-state fetch logic. Prefer
  `setClientAppState`, `readClientAppState`, `deleteClientAppState`, or a shared
  navigation-state helper.
- Mail integration credentials are written through application state in
  `templates/mail/app/hooks/use-integrations.ts` and `use-apollo.ts`; move
  credential values to secrets/actions instead of browser-readable app-state.
- Content comments and versions are partially migrated. Add missing actions such
  as `resolve-comment`, `delete-comment`, `list-document-versions`, and
  `restore-document-version`.

## Acceptable Exceptions

Uploads/file transfer, exports, public/anonymous pages, OAuth/auth redirects,
webhooks/tracking endpoints, media/blob routes, collab text endpoints,
framework setup/status routes, low-level core helper implementations, and the
extension bridge `appFetch` / `extensionFetch` can be route-shaped protocols.
Prefer named helpers when more than one caller needs the behavior.
