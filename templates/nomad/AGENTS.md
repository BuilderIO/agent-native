# nomad — Agent Guide

Nomad is a residency-and-tax compliance cockpit for digital nomads. It keeps a
presence ledger of country entries/exits (`stays`) and computes day counts
against compliance `rules` — Schengen 90/180 rolling windows, 183-day
calendar-year tax residency, visa stay caps, and PR presence minimums — then
surfaces traffic-light statuses, countdowns, and proactive alerts.

## Domain Model

- **Stay** — one continuous stay in a country: `countryCode`, optional `city`,
  inclusive `entryDate`/`exitDate` (`YYYY-MM-DD`; `exitDate` null = still
  there), `source` (`manual`/`inbox`/`import`), `status`
  (`confirmed`/`pending`). Pending stays come from the inbox scan and are
  EXCLUDED from all rule math until confirmed.
- **Rule** — `kind` is one of `rolling-window` (limit within trailing
  `windowDays`), `calendar-year` (limit per calendar year), or
  `presence-minimum` (must accumulate `limitDays` within `windowDays`). Scope
  is `countryCode` OR `zone: "schengen"` (days in any Schengen state count
  together). Entry and exit days both count as presence days.
- **Visa** — a document with a hard validity window: `label`,
  `countryCode` OR `zone: "schengen"` (a Schengen visa grants the whole
  area), optional inclusive `validFrom` (not usable before it), inclusive
  `expiresOn`. The engine caps every matching must-exit
  projection at the visa expiry (`cappedByVisaId` on the rule computation)
  and raises `visa-expiry` alerts (warn ≤30 days, danger ≤14 while inside).
- **Profile** — settings-backed (`nomad-profile` key): fiscal home country,
  citizenship country, immigration status, goals, tracked countries,
  inbox-scan preference, onboarding state.

## Actions

| Action              | Method | Purpose                                                                                                     |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `compliance-status` | GET    | Full computed snapshot: current location, per-rule day counts + severities + must-exit-by/re-entry dates, per-country map statuses, alerts, trips. Use for any "how many days / where can I be / when must I leave" question. Supports `asOf` for what-if dates. |
| `list-stays`        | GET    | Presence ledger, newest first; optional `countryCode` filter.                                                |
| `upsert-stay`       | POST   | Create (countryCode+entryDate) or patch (`id` + changed fields) a stay. Confirm a pending stay with `{ id, status: "confirmed" }`; close an open stay by setting `exitDate`. |
| `delete-stay`       | POST   | Remove a stay (e.g. discard a wrongly detected booking).                                                     |
| `list-rules`        | GET    | Raw rule definitions (use compliance-status for computed numbers).                                           |
| `upsert-rule`       | POST   | Create or patch a rule. Scope with `countryCode` or `zone: "schengen"`, never both.                          |
| `delete-rule`       | POST   | Stop tracking a rule (ledger untouched).                                                                     |
| `upsert-visa`       | POST   | Create or patch a visa/permit with optional `validFrom` and hard `expiresOn`. Scope with `countryCode` or `zone: "schengen"`. When a user mentions a visa and its dates, log it. |
| `delete-visa`       | POST   | Remove a visa; exit projections stop being capped by it.                                                     |
| `upsert-visa`       | POST   | Create or patch a visa/permit with optional `validFrom` and hard `expiresOn`. Scope with `countryCode` or `zone: "schengen"`. When a user mentions a visa and its dates, log it. |
| `delete-visa`       | POST   | Remove a visa; exit projections stop being capped by it.                                                     |
| `update-profile`    | POST   | Patch profile fields; seeds well-known preset rules for tracked countries idempotently.                      |
| `scan-inbox`        | POST   | Run the inbox scan now; returns pending stays awaiting confirmation. Booking parsing is a stub until a Mail app is connected over A2A. |
| `view-screen`       | —      | Navigation state + compact compliance summary. Call first.                                                  |
| `navigate`          | —      | Move the UI: views `cockpit`, `chat`, `onboarding`, `settings`, or `country:<ISO2>` (e.g. `country:PT`).     |

Rules of thumb:

- Never assume today's date — `view-screen` and `compliance-status` return
  `today`; read it before any date reasoning.
- The profile's `citizenshipCountry` is the passport the user travels on.
  Combine it with recorded visas (check `validFrom`/`expiresOn`) and statuses
  to reason about entry access; use your own knowledge for visa-free lists and
  recommend official verification for consequential plans.
- Never assume today's date — `view-screen` and `compliance-status` return
  `today`; read it before any date reasoning.
- The profile's `citizenshipCountry` is the passport the user travels on.
  Combine it with recorded visas (check `validFrom`/`expiresOn`) and statuses
  to reason about entry access; use your own knowledge for visa-free lists and
  recommend official verification for consequential plans.
- Fiscal-residency tracking: use `presence-minimum` with `windowDays: null`
  for per-calendar-year minimums (e.g. "≥183 home-country days/yr"). The
  engine adds feasibility: at-risk when the target is mathematically
  unreachable by Dec 31, close when nearly every remaining day is required.
  Caveats the agent must carry: residency is ties-based, not day-count-based;
  183+ sojourn days can DEEM a non-resident resident (the rule cuts both
  ways); provincial regimes (e.g. RAMQ) have their own day floors; ceasing
  residency triggers exit formalities (departure tax). Day counters are
  heuristics — recommend professional verification.
- Fiscal-residency tracking: use `presence-minimum` with `windowDays: null`
  for per-calendar-year minimums (e.g. "≥183 home-country days/yr"). The
  engine adds feasibility: at-risk when the target is mathematically
  unreachable by Dec 31, close when nearly every remaining day is required.
  Caveats the agent must carry: residency is ties-based, not day-count-based;
  183+ sojourn days can DEEM a non-resident resident (the rule cuts both
  ways); provincial regimes (e.g. RAMQ) have their own day floors; ceasing
  residency triggers exit formalities (departure tax). Day counters are
  heuristics — recommend professional verification.
- Never estimate day counts by hand — `compliance-status` runs a day-by-day
  simulation that correctly handles days aging out of rolling windows and
  caps exits at visa expiries.
- The cockpit map opens a quick-action popover on country click ("I'm here
  now", log trip, add visa, track, details) — "I'm here now" closes the
  current open stay (exit today) and starts a new open stay (entry today);
  travel days count in both places by convention.
- Compliance math is deterministic, but visa/tax interpretation varies by
  nationality and treaty. Remind users to verify consequential decisions with
  an immigration or tax professional.
- Country reference data (names, flags, Schengen membership, map coordinates,
  rule presets) lives in `shared/countries.ts`; the pure calculation engine in
  `shared/compliance.ts` (unit-tested in `shared/compliance.spec.ts`).

## Countries & Inclusivity

Every ISO 3166-1 country is first-class everywhere: stays, rules, tracked
countries, the map, and all pickers accept any alpha-2 code. Names come from
`Intl.DisplayNames` (localized), flags are computed from the code, and
`presetsForCountry()` in `shared/countries.ts` returns curated rule presets
where known plus a generic 183-day tax counter for everywhere else. The
cockpit map is a real world map (world-atlas 110m TopoJSON + d3-geo): every
country is clickable and resolves to `/countries/<ISO2>`; untracked country
pages offer a one-tap "Track" that seeds presets via update-profile.

## Onboarding

`/onboarding` follows a Wispr-Flow-style flow: a "what brings you here?"
goals step (stored on the profile as `goals`), searchable fiscal home,
immigration status, destinations with a live armed-rules preview, a
"where are you right now?" step that logs a real day-1 stay, and an optional
inbox-scan step. Every step is skippable and Continue is never blocked;
finishing merges (never replaces) tracked countries and re-runs are prefilled
from the existing profile.

## Countries & Inclusivity

Every ISO 3166-1 country is first-class everywhere: stays, rules, tracked
countries, the map, and all pickers accept any alpha-2 code. Names come from
`Intl.DisplayNames` (localized), flags are computed from the code, and
`presetsForCountry()` in `shared/countries.ts` returns curated rule presets
where known plus a generic 183-day tax counter for everywhere else. The
cockpit map is a real world map (world-atlas 110m TopoJSON + d3-geo): every
country is clickable and resolves to `/countries/<ISO2>`; untracked country
pages offer a one-tap "Track" that seeds presets via update-profile.

## Onboarding

`/onboarding` follows a Wispr-Flow-style flow: a "what brings you here?"
goals step (stored on the profile as `goals`), searchable fiscal home,
immigration status, destinations with a live armed-rules preview, a
"where are you right now?" step that logs a real day-1 stay, and an optional
inbox-scan step. Every step is skippable and Continue is never blocked;
finishing merges (never replaces) tracked countries and re-runs are prefilled
from the existing profile.

## Data isolation (sensitive data)

Stays, rules, visas, and the profile are per-user: every table carries
`owner_email`, every action resolves the authenticated user via
`requireOwner()` (`server/lib/owner.ts`) and scopes reads/writes with it, and
the profile lives under the user-scoped settings key `u:<email>:nomad-profile`.
Chat threads are per-user via the framework (`chat_threads.owner_email`);
`application_state` is session-scoped. There is no org/workspace sharing of
compliance data — this is deliberate: travel history, citizenship, and visas
are sensitive. Never add an unscoped query; run
`pnpm action db-check-scoping` after schema changes. Demo seed rows belong to
the dev sentinel owner, so authenticated deployments start each user empty
(onboarding is the first-run experience).

## Data isolation (sensitive data)

Stays, rules, visas, and the profile are per-user: every table carries
`owner_email`, every action resolves the authenticated user via
`requireOwner()` (`server/lib/owner.ts`) and scopes reads/writes with it, and
the profile lives under the user-scoped settings key `u:<email>:nomad-profile`.
Chat threads are per-user via the framework (`chat_threads.owner_email`);
`application_state` is session-scoped. There is no org/workspace sharing of
compliance data — this is deliberate: travel history, citizenship, and visas
are sensitive. Never add an unscoped query; run
`pnpm action db-check-scoping` after schema changes. Demo seed rows belong to
the dev sentinel owner, so authenticated deployments start each user empty
(onboarding is the first-run experience).

## Demo mode

The framework demo mode (agent sidebar → Settings → Demo mode) is a
browser-local presentation preference: core anonymizes displayed emails in
GET responses, and this template additionally hides identifying free text —
city names in the timeline/ledger and the passport chip. Backend, agent, and
exports always operate on real data; never make actions consult demo mode.

## Demo mode

The framework demo mode (agent sidebar → Settings → Demo mode) is a
browser-local presentation preference: core anonymizes displayed emails in
GET responses, and this template additionally hides identifying free text —
city names in the timeline/ledger and the passport chip. Backend, agent, and
exports always operate on real data; never make actions consult demo mode.

## Inbox scan

`scan-inbox` records the scan and surfaces `pending` stays. In a full
deployment, a weekly recurring job calls a connected Mail app over A2A to parse
flight/hotel confirmations into pending stays; this template ships the
confirmation workflow (pending → confirm/discard) without the mail credential.
When wiring it up, keep the contract: detected trips are inserted as
`status: "pending"`, `source: "inbox"`, and the user confirms via UI or agent.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Treat the chat as the default UI. When the user asks for a capability, prefer
  adding or improving the action surface first, then add a page, table, form, or
  widget only when the user needs to inspect, compare, approve, or share durable
  objects.
- If the user wants to plug in their own agent backend, keep the app shell and
  thread UI intact and adapt the chat through the framework's `AgentChatRuntime`
  connector helpers instead of forking the transcript/composer UI.
- Keep the action surface small and orthogonal: every action is a tool in the
  model's context window, so prefer one CRUD-style `update` (patch of fields)
  over many per-field actions, reach for an existing generic query / escape
  hatch (`provider-api-*`, dev `db-query`) before minting a new read action,
  mark UI-only or programmatic actions `agentTool: false` to hide them from the
  model (distinct from `toolCallable: false`, which only gates the extension
  iframe), and delete or hide actions the UI no longer uses. See the `actions`
  skill.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.

## Application State

- `navigation` should describe the current view and selected entity ids. The
  default view is `cockpit` at `/`; chat lives at `/chat`, country pages at
  `/countries/<ISO2>` (navigation includes `countryCode`).
- `navigate` may be used to move the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Framework Docs Lookup

- Before implementing or explaining non-trivial Agent Native behavior, use the
  `agent-native-docs` skill and the built-in `docs-search` action/tool to read
  the version-matched framework docs bundled with `@agent-native/core`.
- Use the built-in `source-search` action/tool, or search
  `node_modules/@agent-native/core/corpus`, when you need current core or
  first-party template implementation examples.
- Prefer those installed docs over memory or public docs when package APIs,
  generated-app conventions, workspaces, actions, or agent surfaces are involved.

## Skills

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `agent-native-docs`, `storing-data`, `real-time-sync`, `security`,
`delegate-to-agent`, `frontend-design`, `shadcn-ui`, and
`self-modifying-code`.
