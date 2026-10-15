# Analytics for Operators: Product and Build Plan

**Goal:** Turn the Analytics template from an internal dashboard tool into a
product with a buyer. Make the core loop stop hurting first, then build for
operators: founders at startups with no data team, and the product, growth and
RevOps people who live in Amplitude, Sigma and spreadsheets today.

**Status:** Building (started 2026-10-13). Section 7 tracks the run; each unit
has a brief in `tasks/`.

All paths are relative to `templates/analytics/` unless noted.

---

## 1. Who we're building for

**Operators.** People who need answers from their company's data and don't have
an analyst on call.

| Segment                                    | Their data                                                    | What they compare us to       | What they need first                                                |
| ------------------------------------------ | ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| Founders and ops at 10 to 200 person teams | Stripe, HubSpot, production Postgres, PostHog or GA, Sheets   | Spreadsheets, nothing         | Connect in minutes, see their own numbers on day one                |
| Product and growth teams                   | Event data (warehouse or collector), replays, revenue and CRM | Amplitude, Sigma, Fusion      | Funnels, retention, fast edits, near-real-time events for alerts    |
| RevOps and GTM                             | HubSpot, Gong, Stripe, support tools                          | CRM reports, Clari, Sigma     | Account-level answers across tools                                  |

At a startup the founder plays all three roles, so these are one persona at
different company sizes, not three products.

**Positioning:** Hex, without needing a data team or a warehouse. Our edges are
joining data across tools in one question, an agent that acts through the same
controls as the UI, and open source.

**Why not data teams first (Hex's buyer):** they already use Hex and dbt, they
distrust SQL an agent wrote, and they won't evaluate without Snowflake or
Databricks. That is months of work before the first evaluation.

**Evidence we already have:** our internal users are product and growth people
at a company with a warehouse. In feedback since August they compare us to Amplitude
(a release dashboard), Sigma (multi-select filters) and Fusion Analytics (a 25
minute analysis that errored versus under 5 minutes). The action list leans heavily on GTM: Gong insights,
`account-deep-dive`, account health, HubSpot, Pylon.

---

## 2. Where we stand

**Already strong**

- The agent and the UI change dashboards through the same actions;
  `mutate-dashboard` checks the rendered result of each write.
- Joins across SaaS tools through the provider API, staged datasets and data
  programs (`.agents/skills/data-programs`).
- Session replay, an event catalog, error capture and uptime monitors in the
  same app.
- Other workspace apps can ask it questions over A2A; external tools reach it
  over MCP.
- Open source and self-hostable.

**Gaps found in the code**

| Gap                                           | Evidence                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A connected Postgres can't feed answers or panels | `POSTGRES_URL` is only used by `server/routes/api/test-connection.post.ts`. Panel sources are BigQuery, GA4, Amplitude, first-party, demo, Prometheus and program (`server/lib/dashboard-panel-query.ts:416`). `server/lib/postgres.ts` has no read-only mode and no statement timeout. |
| Most sources need a pasted key                | One-click OAuth exists only for Notion, HubSpot, Jira and Sentry (`app/lib/data-source-status.ts:83`). Stripe asks for a secret key.                                                                  |
| No shared revenue metrics                     | The `stripe` action looks up one customer at a time. The agent can compute MRR and churn ad hoc through `run-code` and the Stripe provider API, but writes the calculation fresh each time, so answers can differ day to day. |
| Table formatting is prompt-only               | `ColumnFormat` exists in panel config (`app/pages/adhoc/sql-dashboard/types.ts:49`) but there is no column menu to set it.                                                                            |
| Pitch targets someone else                    | `app/routes/home.tsx` and the README say "Open Source Alternative to Amplitude & FullStory".                                                                                                         |
| Warehouses                                    | BigQuery only, plus connected Postgres reads.                                                                                                                                                       |
| Python                                        | Production `run-code` is hardened QuickJS, JavaScript only (`packages/core/src/coding-tools/run-code.ts:126`).                                                                                        |

**Pain reported by internal users (Aug to Oct 2026)**

| Pain                                     | Reports                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every change goes through a prompt       | Users want to format, resize, reorder, hide and filter columns by clicking (Oct 13), and asked for multi-select filters (Oct 9). |
| The agent says it's done when it isn't   | A chart "changed" twice and didn't; a "cleared" banner left the chart on No data (Oct 6). `mutate-dashboard` failed three times in a row (Aug 21). |
| Slow                                     | 25 minutes then an error; 20 minutes loading; 2 minutes to add a moving average; slow dashboard lists; panels reloading every 60 seconds with 500 and 409 errors. |
| Cost                                     | Reads of the raw first-party events table are a large daily BigQuery cost (Oct 8). |
| Wrong or stale numbers                   | A stale signup count that Refresh didn't fix (Oct 6); a north-star WAU chart showing No data; Gong and HubSpot questions returning zeros. |
| Errors written for developers            | Messages that mean nothing to non-developers; bare error IDs; a "coverage-sensitive provider claim" refusal; a run stuck until the user was asked to reconnect a Builder space. |
| Sharing                                  | A shared chat link pasted the prompt into the viewer's own conversation; no way to request edit access. |
| Event freshness                          | Events arrive through BigQuery too late for alerts. |

**Shipped since some of these reports:** multi-select dashboard filters
(#7250, Oct 9) and render-checked dashboard edits with lower agent latency
(#6908, Oct 7). Re-test those reports before building more in those areas.

---

## 3. The plan

Phases run roughly in order. Phase 1 applies to every segment and goes first:
no pitch survives a 25 minute answer.

Each PR covers the four areas when they apply: UI, actions, skills or
instructions, and application state. Template changes that users notice get an
`agent-native changelog add` entry.

### Phase 0: Validate (no code, runs alongside Phase 1)

- Pull internal usage by role and question type from
  `list-dashboard-usage-stats` and ask-thread history.
- Re-run the reports in section 2 against current main, especially the chart
  edits the agent reported as done and the multi-select request, and note which
  are already fixed.
- Interview five outside founders and five outside product or growth leads with
  one cross-tool demo ("which churned accounts had support escalations last
  quarter?").
- Landing-page test of the operator pitch.

### Phase 1: Stop the pain

**PR 1.1: Click to edit tables.**
A column header menu on table panels: format (currency, decimal, percent),
hide, add as filter, resize and reorder. Uses the existing `ColumnFormat` panel
config and writes through `mutate-dashboard`, so the agent and the UI stay
equal. shadcn `DropdownMenu` or `ContextMenu`, text-only items.

- Skills: update `.agents/skills/dashboard-management` so the agent knows these
  edits exist and points users to them for formatting.
- App state: `selected-object` includes the column when a header is selected.

**PR 1.2: Click to edit charts.**
Chart type, series color, axis format and title from the panel toolbar, same
write path as 1.1.

**PR 1.3: The agent can't claim success that didn't happen.**
After #6908, confirm whether the Oct 6 false-success report still reproduces. The remaining
risk is the `unverified` outcomes in `server/lib/dashboard-panel-verification.ts`
(timeout, missing credential, skipped program, too expensive, over budget): the
agent must report them as unverified, never as done. Show each agent edit as a
change summary with one-click undo through `restore-dashboard-revision`.

**PR 1.4: Fresh, cheap panels.**
Reproduce the 60 second reload and the 500 and 409 errors first. Then: refresh
only panels that are visible and stale, read from cached rollups instead of the
raw events table, show an "as of" time on every panel, and make Refresh skip
the cache. Fixes the stale signup count and should cut most of the raw-table read cost.
Read `.agents/skills/performance` first.

**PR 1.5: Plain-language empty and error states.**
Map every `PanelVerificationStatus` and credential state to user copy with a
fix button: "Reconnect HubSpot", "Run this data program", "No rows match these
filters". No bare error IDs. Localize every string.

**PR 1.6: Time budget for questions.**
Show progress in plain words, cap run time, and return a partial answer that
says what's missing. A partial answer is labeled partial, never presented as
complete. Log time-to-answer per question.

**PR 1.7: Sharing that works.**
A shared chat opens that thread read-only with a Continue button instead of
pasting the prompt into the viewer's chat. Dashboards get "Request edit access".
Read `.agents/skills/sharing` first.

### Phase 2: Connect in minutes

**PR 2.1: Postgres as a query source.**
Add `postgres` as a panel and answer source. Every query runs in a read-only
transaction with a statement timeout and a row cap. Read the schema on connect
to seed the data dictionary. The `postgres` package is already a template
dependency, so drop the stale "optional dependency" error in
`server/lib/postgres.ts`.

**PR 2.2: One-click connections.**
OAuth for Stripe and Google (GA4 and Sheets) through the workspace connection
primitives. Accept Stripe restricted keys as the fallback. Read
`.agents/skills/secrets` and the `onboarding` skill first.

**PR 2.3: CSV and Sheets import.**
Files go to file storage, rows become a staged dataset the agent can query. No
raw file bodies in SQL. Read `.agents/skills/storing-data` first.

### Phase 3: Their own numbers on day one

**PR 3.1: Stripe metrics data program.**
One saved, shared data program for MRR, new, expansion and churned revenue, and
retention cohorts, with written definitions. Rebuild history from invoices,
because subscriptions only show current state and Stripe events go back 30
days. Stripe list endpoints page by last item id, which `providerFetchAll`
can't follow today: either loop by hand in the program or extend the helper in
`packages/core` (needs a changeset).

**PR 3.2: Seeded company dashboard.**
On first connect, build one dashboard from whatever is connected: revenue from
Stripe, pipeline from HubSpot, usage from Postgres or PostHog.

**PR 3.3: Account map across tools.**
One editable map linking Stripe customers, HubSpot companies and product users
by domain or email. Generalizes what `account-deep-dive` does for one account.

**PR 3.4: Show the work and save definitions.**
An evidence panel on every answer: source, time window, filters, row count and
query. Plain-language metric definitions for teams without dbt, saved the first
time the agent has to ask what a term means.

### Phase 4: Product and growth teams

**PR 4.1: Funnels, retention and cohorts as panel types.**
Build on the SQL in `actions/conversion-analysis/`.

**PR 4.2: Near-real-time events for alerts.**
Alerts read the first-party collector directly instead of waiting on BigQuery
batches.

**PR 4.3: Funnel step to replays.**
Click a drop-off step to open replays of those users in Sessions.

**PR 4.4: Product usage joined with revenue.**
"Which features do expanding accounts use?" through the account map from 3.3.

### Phase 5: Push it to them

**PR 5.1: Weekly summary.** Agent-written, covering what changed and why, on by
default after the first dashboard. Builds on report subscriptions and alerts.

**PR 5.2: Answers in Slack.** Ask Analytics from Slack and get the answer and a
link back.

### Phase 6: Pitch and first run

**PR 6.1:** Rewrite the homepage, SEO copy and README for operators.

**PR 6.2:** Replace the demo data with a realistic startup (Stripe, HubSpot, a
product database) that shows a cross-tool answer before the visitor connects
anything.

---

### Phase 7: Notebook-lite and Python

**PR 7.1: Analyses become notebooks.** Saved analyses gain ordered cells: SQL,
chart and text. Existing analyses stay readable.

**PR 7.2: Chained cells.** A SQL cell can query an earlier cell's result
through DuckDB, without going back to the source.

**PR 7.3: Agent cell edits.** The agent adds, edits and reorders cells through
actions, with the same rendered-result check dashboards use.

**PR 7.4: Open as notebook.** An ask thread turns into a notebook whose cells
are the queries the thread ran.

**PR 7.5: Publish as app.** A notebook's input cells become filters on a shared
read-only page.

**PR 7.6: Python spike.** Prove or rule out Pyodide on the server path the
agent uses (bundle size, cold start, pandas). Build Python cells only if the
spike passes.

### Phase 8: Holy-shit features

Bets that make the product feel like an analyst on the team, not a faster
dashboard. Each UI unit waits for sign-off on its prototype screens in
`prototypes/analytics-operators/`. Order: 8.1 first (the owner asked to prove
it in the prototype first), 8.2 alongside it, then 8.3, 8.4a, 8.4b and 8.4f,
then the rest.

**PR 8.1: Automatic investigations ("why did this change?").** When an alert
fires (4.2a, 4.2b, 4.2c) or someone asks why a metric moved, the agent runs a
bounded investigation inside 1.6a's time and cost budget and saves it as an
evidence notebook (7.1a): segment breakdowns, affected accounts (3.3a), what
shipped (GitHub), errors (Sentry and the error actions) and replays of
affected people. Every finding carries 3.4a's evidence. The notebook opens
with a plain-language answer and a confidence label, and lists what it could
not check with the reason, never a silent "no change". It lands as an in-app
notification, in Slack (5.2), back in the Slack thread it was asked in
(8.1g) and on the alert's channels. Split into 8.1a to 8.1g.

**PR 8.2: Insight to action.** From an answer, notebook or investigation, act
in sibling apps over A2A: email drafts to an account list (Mail), an issue
with the evidence (Jira), CRM field updates through the workspace's CRM
connection, a deck with access-checked live charts (Slides). Every outbound action is a draft or waits for an explicit confirm,
and apps pass ids and bounded summaries, not raw rows.

**PR 8.3: Apps built in Design.** "Make an app in Design" from a dashboard or
notebook. Design lays out branded, multi-screen app screens from the
workspace design system, bound to the notebook's named outputs through one
read-only, access-checked data contract; the app cannot fetch data itself
and runs sandboxed. Publishing makes a workspace mini-app that reads
Analytics over A2A. 7.5 stays the quick path.

**PR 8.4: Notebook parity.** Drillable charts with Top N, ratio and weighted
average calculations and pivot subtotals (8.4a); no-code Pivot, Filter, Table
display, Single value and Map cells (8.4b); a reactive cell graph with auto-run
and a Graph view (8.4c); review agent edits per cell with a version per agent
thread (8.4d); a SQL editor with a schema browser, typeahead and templating
(8.4e); Python cells, only once the 7.6 spike's go conditions hold (8.4f);
scheduled runs and chat with a published app (8.4g).

**PR 8.5: Buyer blockers.** Semantic model editing with a diff (8.5a),
endorsed tables (8.5b), signed embedding (8.5c) and mobile-friendly reading
(8.5d).

---

## 4. On hold

Snowflake and Databricks, full Python kernels, and more session replay depth.
Bring them back when a data-team buyer shows up.

**Full Python, when we need it.** The way in is the `SandboxAdapter` hook
(`packages/core/src/coding-tools/sandbox/adapter.ts`, selected with
`registerSandboxAdapter()` or `AGENT_NATIVE_SANDBOX`). It needs a language
field on each run, and a way for a remote runner to reach credentialed tools
without seeing secrets, because today's bridge listens on the parent's
localhost. Questions for whoever owns the Builder backend: cold start, network
lockdown, cost per run, and whether customer warehouse rows may leave the app.

---

## 5. How we'll know it's working

| Metric                                         | Moves with |
| ---------------------------------------------- | ---------- |
| Median time-to-answer                          | Phase 1    |
| Share of dashboard edits done by click         | 1.1, 1.2   |
| Agent edits reported done that weren't         | 1.3        |
| Daily BigQuery read cost                       | 1.4        |
| Share of signups that connect a source         | Phase 2    |
| Time from signup to first answer on own data   | Phases 2, 3 |
| Weekly active askers                           | All        |
| Weekly summary open rate                       | 5.1        |

---

## 6. Open decisions

1. **Which segment leads after Phase 1:** startups (Phase 2 next) or product
   and growth teams (Phase 4 next). Phase 0 interviews should decide it.
2. **Python runner:** whether the Builder backend can host it, and who owns it.
3. **Stripe OAuth:** whether a Stripe App listing and review is required for
   hosted OAuth, and how long it takes.

---

## 7. Build run

**Decisions (2026-10-13):**

- 2026-10-14, owner accepted the prototype v9 defaults. Where a brief differs, the prototype wins:
  - Dashboard filters: "Convert to dashboard filters" is offered on every dashboard whose panels still repeat `{{timeRangeStart}}` or `{{plan}}`. After conversion, Plan applies only to the panels that used it, and the rest can be turned on. The converted date filter is named "Date". There is no brief for first-class filters yet; the prototype screens (`ff-*`) are the spec until one is written.
  - Design apps: the data button reads "Data from Analytics" (8.3b).
  - Notebooks: agent edits are reviewed inline in each changed cell with Keep, Undo and Keep all, not in a separate sheet (8.4d). Calculated columns use a free-form formula; subtotals of a formula column are computed from the formula over the group, not by summing rows (8.4a2).
  - Phone: the page header stays as a compact row under the phone top bar (8.5d).
  - "Adjust the alert…" applies the change directly and offers Undo, because the change is reversible (8.1d).

- 2026-10-14: the owner approved adding Phase 8 (lane E) and asked to prototype bet A (8.1, automatic investigations) first. Every Phase 8 UI unit is gated on sign-off of its prototype screens; the 8.1 screens are in `prototypes/analytics-operators/` (the "Investigation:" and "Panel:" screens), with a draft-and-confirm preview of 8.2.

- 2026-10-14: the owner approved prototype v6, which starts the gated units. Chart series colors use seven swatches with no red (1.2). The notebook actions menu has no Email reports or Certify for AI queries (7.1b).

- 2026-10-14, owner answers on the Phase 8 briefs:
  - An investigation asked in Slack posts its finished answer, confidence label and notebook link back in the thread where it was asked. New unit 8.1g; 8.1c points at it.
  - Jira gets read and write access: 8.2b adds `write:jira-work` to the shared Jira connection, and existing OAuth connections reconnect once through the integrations UI ("Needs reauth" in Dispatch, "Reconnect needed" in Data sources).
  - No CRM app dependency: 8.2c uses the workspace's HubSpot (and later other CRM) connection through `provider-api-request`. Writes are drafts the user confirms on the approval card of a dedicated apply action. A core change to gate every provider write by default was dropped on 2026-10-14 (it reached eight apps and would stop unattended automation writes).
  - Chart images and live charts in decks are access checked: each viewer must be able to read the source dashboard or notebook, unless it is public. No unguessable URL grants access on its own (8.2d).
  - Next steps also show as contextual chips under chat answers (8.2a), after their prototype screen is drawn and signed off.
  - Publishing a Design app is Builder-only in v1, as a value prop for Builder accounts (8.3c, 8.3d).
  - People using a published app see only data they can already see in Analytics; 8.3a, 8.3b and 8.3d state it as a requirement with a test.
  - The notifications bell's unread count is solid blue (`bg-blue-500`, as in Design), not primary or red (8.1f).
  - Investigations go below Personal and Shared in the Notebooks list, not first (8.1d).
  - Not decided: the Python sandbox security sign-off and Node 24 versus Node 25 (8.4f1 conditions 2 and 3) stay open.

- Work lands as commits on the local integration branch
  `claude/analytics-template-competitor-3faa16`. Nothing is pushed until the plan
  owner reviews it.
- New surfaces get an HTML prototype for sign-off before they are built: the
  column and chart menus (1.1, 1.2), notebook-lite (Phase 7) and funnels and
  retention (4.1, 4.3). Everything else builds directly.
- Growth work (Phase 4) runs in parallel with the founder work.
- Phase 0 is human work. The run prepares the usage query and interview script.
- Prototype design calls, decided by the owner: chart editing is the chart
  header toolbar (title field, chart type, series colors, Y axis format,
  Done), not a single format menu (1.2); Format is Number, Currency or
  Percent with a Decimal places setting of 0 to 3, with no Decimal format,
  in the column menu and the Y axis menu (1.1a, 1.2); Add as filter hands
  the change to the agent, which adds the filter and rewrites the panel SQL
  (1.1a D1); funnel alerts watch the conversion rate between two steps,
  from a bell on the conversion line, not a step's event count (4.2c); every
  funnel step uses one series color with the amber drop-off (4.1b);
  notebooks get their own Notebooks sidebar section and list page while
  staying SQL dashboards with a notebook layout (7.1b, 7.1a).
- Owner calls, 2026-10-14: every sidebar section puts its create action in
  the header as a "+" beside the filter and chevron, the chevron is the only
  collapse control, and a long list ends in one "Show N more" row, with no
  New rows at the bottom (1.8, which 7.1b builds on); Publish as app lives
  in the notebook's ⋯ menu, and Re-run is the one header button at the
  dashboard header's compact size (7.5, 7.1b).
- Owner call, 2026-10-14, on the dashboard header (1.9): Share is the
  primary action, as the toolkit split control Clips uses (Share joined to a
  copy link button) with People and Agents tabs, in the primary variant at
  the compact header size (32px, 12px text, no user-plus icon), never the
  accent fill; Add is a secondary "+ Add" button immediately left of Share
  whose text-only menu (Chart…, SQL query…, Section) adds to the end; Views
  move out of the header into the filter bar as a View picker with an Edited
  state and one save path; the ⋯ menu is text-only in three groups. Reversible
  after the owner sees them built: Undo and Redo leave the menu for a Saved
  toast with Undo and ⌘Z, visibility and Hidden leave it for Share and the
  banner, the metadata moves into Dashboard history, Views move into the
  filter bar, and the insert bar between dashboard rows (new, with
  `mutate-dashboard`'s `newRowAt`) adds in place.
- Owner calls, 2026-10-14, toolkit-wide ("toolkit-wide, all apps should
  match"): 1.9's share panel moves to the compact density in the toolkit
  (a 320px popover, 24px controls, 12/16 text, 28px rows, on the 4/8 grid),
  and the People tab drops its Share link row whenever the split button's
  copy link is shown, in every app that renders `ShareButton` or the shared
  share controls (Analytics, Assets, Brain, Calendar, Clips, Content, Design,
  Forms, Plan, Slides, Dispatch, and the toolkit's agent panel and extension
  viewer), with no density prop and no Analytics-only path. 1.8's sidebar
  pattern changes the toolkit `ChatHistoryRail`, so all five apps that use it
  (Analytics, Plan, Brain, Assets, Factory) match, with no Analytics-only
  `renderRail`.
- Stripe OAuth needs a Stripe platform registration only the plan owner can make. 2.2
  ships restricted keys and the OAuth code path, ready for the client id.

**Lanes:**

| Lane            | Units                          |
| --------------- | ------------------------------ |
| A. Reliability  | 1.1 to 1.9                     |
| B. Founders     | 2.1 to 2.3, 3.1 to 3.4, 5, 6   |
| C. Notebook     | 7.1 to 7.6                     |
| D. Growth       | 4.1 to 4.4                     |
| E. Holy-shit features | 8.1 to 8.5               |

**Units.** Each brief in `tasks/` lists files, the four-area checklist,
tests, how to verify, dependencies and defaults for open questions. A brief's
"Reviewer notes" section, where present, records a check a builder must
settle before or while building.

| ID | Title | Lane | Size | Wave | Depends on | Brief |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1 | Phase 0 kit: usage by role and interview script | 0 | S | 1 | none | [0.1](tasks/0.1-phase-0-kit.md) |
| 1.1a | Click to edit tables: column menu and the shared click-edit write path | A | M | Sign-off | sign-off; after 1.3a, 1.3b, 1.4a, 1.5a, 1.5b, 4.1b merge | [1.1a](tasks/1.1a-table-column-menu.md) |
| 1.1b | Click to edit tables: resize and drag to reorder | A | M | Sign-off | 1.1a, sign-off | [1.1b](tasks/1.1b-table-column-resize-reorder.md) |
| 1.2 | Click to edit charts: type, series colors, axis format, title | A | M | Sign-off | 1.1a, sign-off | [1.2](tasks/1.2-click-to-edit-charts.md) |
| 1.3a | Truthful edit outcomes and an answer guard for unchecked edits | A | M | 1 | none | [1.3a](tasks/1.3a-truthful-edit-outcomes.md) |
| 1.3b | Change summary card in chat with one-click undo | A | M | 2 | 1.3a | [1.3b](tasks/1.3b-edit-summary-with-undo.md) |
| 1.4a | Fresh panels: no reload storms, visible-and-stale refetch, "as of", Refresh bypasses caches | A | M | 1 | none | [1.4a](tasks/1.4a-fresh-panels.md) |
| 1.4b | Measure and attribute first-party read cost | A | M | 3 | 1.4a | [1.4b](tasks/1.4b-first-party-read-cost.md) |
| 1.4c | Active-user daily table for first-party panels | A | M | 4 | 1.4b and its go decision | [1.4c](tasks/1.4c-active-user-day-table.md) |
| 1.4d | Move the most expensive first-party panels onto rollups | A | M | 5 | 1.4b, 1.4c | [1.4d](tasks/1.4d-panels-read-rollups.md) |
| 1.5a | Plain-language panel errors with fix buttons | A | M | 2 | none (after 1.4a) | [1.5a](tasks/1.5a-panel-error-states.md) |
| 1.5b | Plain-language empty, partial and render-error states | A | M | 3 | 1.5a | [1.5b](tasks/1.5b-panel-empty-states.md) |
| 1.6a | Framework answer time budget and labeled partial answers | A | M | 1 | none | [1.6a](tasks/1.6a-answer-time-budget.md) |
| 1.6b | Analytics adopts the five minute budget, plain-word progress, time to answer | A | M | 2 | 1.6a (after 1.3a) | [1.6b](tasks/1.6b-analytics-question-budget.md) |
| 1.7a | Shared chats open read-only with Continue | A | M | 1 | none | [1.7a](tasks/1.7a-shared-chat-read-only.md) |
| 1.7b | Request edit access on dashboards | A | M | 2 | none (after 1.7a) | [1.7b](tasks/1.7b-request-edit-access.md) |
| 1.8 | Sidebar section actions: "+" in the header, one "Show N more" | A | M | Sign-off | sign-off | [1.8](tasks/1.8-sidebar-section-actions.md) |
| 1.9 | Dashboard header: Share split button with People and Agents, an Add menu and insert bar, views in the filter bar, a grouped ⋯ menu | A | L | Sign-off | sign-off (after 1.3b, 1.7b) | [1.9](tasks/1.9-dashboard-header.md) |
| 2.1a | Postgres as a query source, and one shared panel source list | B | M | 1 | none | [2.1a](tasks/2.1a-postgres-query-source.md) |
| 2.1b | Read the Postgres schema into the data dictionary | B | S | 2 | 2.1a | [2.1b](tasks/2.1b-postgres-schema-dictionary.md) |
| 2.2a | Stripe restricted keys | B | S | 1 | none | [2.2a](tasks/2.2a-stripe-restricted-keys.md) |
| 2.2b | Stripe OAuth code path, ready for a client id | B | M | 2 | 2.2a | [2.2b](tasks/2.2b-stripe-oauth-code-path.md) |
| 2.2c | Google Analytics with Google sign-in and a property picker | B | M | 3 | 2.2b | [2.2c](tasks/2.2c-ga4-oauth.md) |
| 2.3a | Imported datasets and CSV import | B | M | 2 | 2.1a | [2.3a](tasks/2.3a-data-imports-csv.md) |
| 2.3b | Import files from Data sources and chat | B | M | 3 | 2.3a | [2.3b](tasks/2.3b-data-imports-ui-and-chat.md) |
| 2.3c | Import from Google Sheets | B | M | 4 | 2.3a, 2.3b, Picker secrets | [2.3c](tasks/2.3c-google-sheets-import.md) |
| 3.1a | Last-item cursor pagination for provider list endpoints | B | M | 1 | none | [3.1a](tasks/3.1a-last-item-cursor-pagination.md) |
| 3.1b | Stripe revenue metrics data program | B | M | 2 | 3.1a (after 3.4b) | [3.1b](tasks/3.1b-stripe-revenue-metrics-program.md) |
| 3.2 | Seeded Company overview dashboard on first connect | B | M | 3 | 2.1a, 2.1b, 3.1b (after 2.2c) | [3.2](tasks/3.2-seeded-company-dashboard.md) |
| 3.3a | Account map model, sync and resolve actions | B | M | 2 | 3.1a | [3.3a](tasks/3.3a-account-map-model-and-sync.md) |
| 3.3b | Accounts page to review and edit matches | B | M | 3 | 3.3a | [3.3b](tasks/3.3b-accounts-page.md) |
| 3.3c | Account deep dive through the account map, with Stripe billing | B | S | 3 | 3.3a, 3.1b, 3.1a | [3.3c](tasks/3.3c-account-deep-dive-on-map.md) |
| 3.4a | Evidence panel on every answer | B | M | 2 | none (after 1.6a, 3.1a) | [3.4a](tasks/3.4a-answer-evidence-panel.md) |
| 3.4b | Save a team metric definition the first time the agent asks | B | M | 1 | none | [3.4b](tasks/3.4b-saved-metric-definitions.md) |
| 4.1a | Growth surfaces prototype (reconcile the drawn screens with 4.1b to 4.3) | D | S | 1 | none | [4.1a](tasks/4.1a-growth-prototype.md) |
| 4.1b | Funnel definitions and SQL compiler | D | M | 2 | none (after 2.1a, 1.3a, 1.4a) | [4.1b](tasks/4.1b-funnel-definitions-and-compiler.md) |
| 4.1c | Funnel step builder in the panel editor | D | M | Sign-off | 4.1a sign-off, 4.1b | [4.1c](tasks/4.1c-funnel-builder-ui.md) |
| 4.1d | Retention and cohort panels | D | M | Sign-off | 4.1a sign-off, 4.1b, 4.1c | [4.1d](tasks/4.1d-retention-and-cohort-panels.md) |
| 4.2a | Fresh events for alerts | D | M | 1 | none | [4.2a](tasks/4.2a-fresh-events-for-alerts.md) |
| 4.2b | Growth alert conditions: at most, drop and rise | D | M | 2 | 4.2a | [4.2b](tasks/4.2b-growth-alert-conditions.md) |
| 4.2c | Funnel conversion alerts | D | M | Sign-off | 4.1a sign-off, 4.1b, 4.2b | [4.2c](tasks/4.2c-funnel-conversion-alerts.md) |
| 4.3 | Funnel step to replays | D | M | Sign-off | 4.1a sign-off, 4.1b, 4.1c | [4.3](tasks/4.3-funnel-step-to-replays.md) |
| 4.4 | Product usage joined with revenue | D | M | 3 | 3.3a, 3.1b | [4.4](tasks/4.4-usage-joined-with-revenue.md) |
| 5.1a | Weekly summary: facts, delivery and schedule | B | M | 1 | none | [5.1a](tasks/5.1a-weekly-summary-engine.md) |
| 5.1b | Weekly summary: on by default, Settings control, open tracking | B | M | 3 | 5.1a (after 1.3b) | [5.1b](tasks/5.1b-weekly-summary-default-on.md) |
| 5.2 | Answers in Slack | B | M | 1 | none (after 1.3a) | [5.2](tasks/5.2-answers-in-slack.md) |
| 6.1a | In-app pitch copy for operators | B | S | 4 | none; land after 6.2b and 2.1a | [6.1a](tasks/6.1a-in-app-pitch-copy.md) |
| 6.1b | Docs page and docs-site pitch, all locales | B | M | 4 | none; land after 6.1a, 6.2b, 2.1a | [6.1b](tasks/6.1b-docs-pitch-copy.md) |
| 6.2a | Demo company dataset and query action | B | M | 1 | none | [6.2a](tasks/6.2a-demo-company-dataset.md) |
| 6.2b | Demo company dashboard, demo label and Ask demo questions | B | M | 2 | 6.2a | [6.2b](tasks/6.2b-demo-company-dashboard.md) |
| 7.1a | Notebook model and actions | C | M | 3 | none (after the wave 1 and 2 units on its hot files) | [7.1a](tasks/7.1a-notebook-model-and-actions.md) |
| 7.1b | Notebook page | C | M | Sign-off | 7.1a, 1.8, sign-off | [7.1b](tasks/7.1b-notebook-page.md) |
| 7.2a | Cell engine spike: DuckDB versus PGlite | C | M | 1 | none | [7.2a](tasks/7.2a-cell-engine-spike.md) |
| 7.2b | Chained cells: a `cells` source | C | M | Sign-off | 7.1a, 7.1b, 7.2a, 2.1a, sign-off | [7.2b](tasks/7.2b-chained-cells.md) |
| 7.3 | Agent cell edits through `mutate-dashboard` | C | M | Sign-off | 7.1a, 7.1b, 7.2b | [7.3](tasks/7.3-agent-cell-edits.md) |
| 7.4 | Open an ask thread as a notebook | C | M | Sign-off | 7.1a, 7.1b, sign-off | [7.4](tasks/7.4-open-thread-as-notebook.md) |
| 7.5 | Publish a notebook as a read-only app | C | M | Sign-off | 7.1a, 7.1b, sign-off | [7.5](tasks/7.5-publish-as-app.md) |
| 7.6 | Python spike: Pyodide on the agent's server path | C | M | 1 | none | [7.6](tasks/7.6-python-spike.md) |
| 8.1a | Investigation model, plan and budget | E | M | 8 | 7.1a, 4.1b; 4.2c for the funnel subject | [8.1a](tasks/8.1a-investigation-model-and-budget.md) |
| 8.1b | Investigation checks: segments, releases and errors | E | M | 8 | 8.1a, 4.1b (after 4.3) | [8.1b](tasks/8.1b-investigation-checks.md) |
| 8.1e | Investigation checks: replays and affected accounts | E | M | 8 | 8.1a, 8.1b | [8.1e](tasks/8.1e-investigation-replays-and-accounts.md) |
| 8.1c | Investigation triggers and delivery (panel item and alert option gated) | E | M | Sign-off | 8.1a, 8.1b, 4.2b, 5.2; 4.2c for funnel alerts; sign-off | [8.1c](tasks/8.1c-investigation-triggers-and-delivery.md) |
| 8.1d | Investigation notebook UI | E | M | Sign-off | 8.1a, 8.1b, 8.1e, 7.1b, sign-off; 8.2a for Next steps | [8.1d](tasks/8.1d-investigation-notebook-ui.md) |
| 8.1f | Live investigation status: bell, toast, run card, alert line | E | M | Sign-off | 8.1a, 8.1c, sign-off; 4.2c for the funnel chip | [8.1f](tasks/8.1f-investigation-live-status.md) |
| 8.1g | Post a finished investigation back to the Slack thread it was asked in | E | S | 8 | 8.1c (its server half), 8.1a, 5.2 | [8.1g](tasks/8.1g-investigation-slack-thread-reply.md) |
| 8.2a | Insight to action: handoff contract, next actions, draft cards | E | M | Sign-off | 3.4a, 1.3b, 3.3a; 7.1a, 7.1b; 8.1a; sign-off (after 7.1b) | [8.2a](tasks/8.2a-insight-action-handoff.md) |
| 8.2b | Email drafts in Mail and Jira issues with evidence | E | M | Sign-off | 8.2a, sign-off | [8.2b](tasks/8.2b-mail-drafts-and-jira-issues.md) |
| 8.2c | CRM field updates through the workspace CRM connection, applied after approval | E | M | Sign-off | 8.2a, 3.3a, sign-off (after 8.2b) | [8.2c](tasks/8.2c-crm-field-proposals.md) |
| 8.2d | Decks with live Analytics charts in Slides | E | M | Sign-off | 8.2a, sign-off | [8.2d](tasks/8.2d-slides-decks-with-live-charts.md) |
| 8.3a | Named outputs and the read-only data contract | E | M | 8 | 7.1a | [8.3a](tasks/8.3a-named-outputs-data-contract.md) |
| 8.3b | Design data apps: one data channel, sandboxed | E | M | Sign-off | 8.3a, sign-off | [8.3b](tasks/8.3b-design-data-binding-and-sandbox.md) |
| 8.3c | Make an app in Design from a dashboard or notebook | E | M | Sign-off | 8.3a, 8.3b, 8.2a, sign-off (after 1.9, 7.5) | [8.3c](tasks/8.3c-make-an-app-in-design.md) |
| 8.3d | Publish a Design app as a workspace mini-app over A2A | E | M | Sign-off | 8.3b, 8.3c, sign-off (after 8.2b) | [8.3d](tasks/8.3d-publish-design-app-as-workspace-app.md) |
| 8.4a1 | Drillable charts: filter, exclude or break down a point | E | M | Sign-off | 1.1a, 1.2, sign-off (after 1.1b) | [8.4a1](tasks/8.4a1-chart-drill-menu.md) |
| 8.4a2 | Top N and calculated fields (ratio, weighted average) | E | M | Sign-off | 1.2, 8.4a1, sign-off | [8.4a2](tasks/8.4a2-top-n-and-calculations.md) |
| 8.4a3 | Pivot table panels with subtotals | E | M | Sign-off | 8.4a2, 1.1a, 1.2, sign-off | [8.4a3](tasks/8.4a3-pivot-table-subtotals.md) |
| 8.4b1 | No-code cells: Filter, Table display, Single value, Pivot | E | M | Sign-off | 7.1a, 7.1b, 7.2b, 8.4a3, sign-off (after 7.3, 7.5) | [8.4b1](tasks/8.4b1-no-code-cells.md) |
| 8.4b2 | Map cells and map panels | E | M | Sign-off | 8.4b1, 7.2b, sign-off | [8.4b2](tasks/8.4b2-map-cells.md) |
| 8.4c | Reactive cell graph, auto-run and Graph view | E | M | Sign-off | 7.1b, 7.2b, 7.5, 8.4b1, sign-off | [8.4c](tasks/8.4c-reactive-cell-graph.md) |
| 8.4d | Review agent edits per cell, a version per thread | E | M | Sign-off | 1.3b, 7.3, 7.1b, sign-off (after 7.4) | [8.4d](tasks/8.4d-review-agent-edits.md) |
| 8.4e1 | SQL editor: schema browser and typeahead | E | M | Sign-off | 2.1b, 2.3a, 7.1b, sign-off (after 7.2b) | [8.4e1](tasks/8.4e1-sql-editor-schema-and-typeahead.md) |
| 8.4e2 | SQL templating: completion, lint, resolved preview | E | M | Sign-off | 8.4e1, 7.5, sign-off | [8.4e2](tasks/8.4e2-sql-templating.md) |
| 8.4f1 | Python runtime: sealed child-process evaluator in core | E | M | Go conditions | 7.6 and its five go conditions | [8.4f1](tasks/8.4f1-python-sealed-evaluator.md) |
| 8.4f2 | Python cells in notebooks | E | M | Sign-off | 8.4f1, 7.1b, 7.2b, 8.4c, sign-off | [8.4f2](tasks/8.4f2-python-cells.md) |
| 8.4g1 | Scheduled notebook runs that notify on change | E | M | Sign-off | 7.1b, 8.4c, sign-off (after 5.1b) | [8.4g1](tasks/8.4g1-scheduled-notebook-runs.md) |
| 8.4g2 | Chat with a published app, scoped to its data | E | M | Sign-off | 7.5, 7.2b, 1.7a, sign-off (after 8.4g1) | [8.4g2](tasks/8.4g2-chat-with-published-app.md) |
| 8.5a | Semantic model editing with diff and history | E | M | Sign-off | 3.4b, 2.1b, sign-off | [8.5a](tasks/8.5a-semantic-model-history-and-diff.md) |
| 8.5b | Endorsed tables | E | M | Sign-off | 3.4a, 8.5a, 8.4e1, sign-off | [8.5b](tasks/8.5b-endorsed-tables.md) |
| 8.5c1 | Signed embedding: keys, tokens, scoped data | E | M | Owner call | 7.5, 1.7b, the owner's credential decision | [8.5c1](tasks/8.5c1-signed-embed-tokens-and-data.md) |
| 8.5c2 | Embed page, frame policy and Embed tab | E | M | Sign-off | 8.5c1, 1.9, 8.5d, sign-off | [8.5c2](tasks/8.5c2-embed-page-and-share-tab.md) |
| 8.5d | Mobile reading | E | M | Sign-off | 1.9, 7.1b, 7.5, sign-off (after 7.5) | [8.5d](tasks/8.5d-mobile-reading.md) |

"After X" in the Depends on column is a merge-order constraint from the
conflict list below, not a functional dependency. The dependency graph is
acyclic.

**Waves.** A wave starts when the waves before it have merged. Units in one
wave build in parallel; where two touch the same file, the merge order below
says who goes first and the second rebases.

1. **Wave 1, start now:** 0.1, 4.1a, 1.3a, 1.4a, 1.6a, 1.7a, 2.1a, 2.2a,
   3.1a, 3.4b, 4.2a, 5.1a, 5.2, 6.2a, 7.2a, 7.6.
   Merge order: 2.1a, then 1.3a, then 1.4a; 1.3a before 5.2; 2.1a before
   6.2a; 2.2a before 3.1a; 1.7a before 1.6a; 4.2a before 5.1a.
2. **Wave 2:** 1.3b, 1.5a, 1.6b, 1.7b, 2.1b, 2.2b, 2.3a, 3.1b, 3.3a, 3.4a,
   4.1b, 4.2b, 6.2b.
   Merge order: 1.5a, then 1.3b, then 4.1b; 2.3a, then 4.1b, then 6.2b
   (`PanelEditorDialog.tsx`); 1.7b before 6.2b; 2.1b before 2.2b.
3. **Wave 3:** 1.4b, 1.5b, 2.2c, 2.3b, 3.2, 3.3b, 3.3c, 4.4, 5.1b, 7.1a.
   Merge order: 1.5b, then 1.4b, then 7.1a, then 5.1b; 2.2c before 3.2;
   2.3b, then 3.3b, then 5.1b.
4. **Wave 4, each waits on a decision, a secret or other merges:** 1.4c
   (1.4b's go decision), 2.3c (Picker secrets), 6.1a and 6.1b (after 6.2b
   and 2.1a, so the copy can claim them; 6.1a before 6.1b).
5. **Wave 5:** 1.4d.

**After sign-off.** These build only once the plan owner signs off the
matching screens in `prototypes/analytics-operators/` (Phase 1 table and
chart screens; the sidebar section screens (1.8); the dashboard header
screens (1.9); notebook screens; growth screens, which 4.1a reconciles
first). Each also waits for its dependencies
in the table. Lane order:

- Phase 1 edits: 1.1a, then 1.2, then 1.1b. 1.1a also waits for 1.3a, 1.3b,
  1.4a, 1.5a, 1.5b and 4.1b, which reshape the same files.
- Growth: 4.1c, then 4.1d, then 4.3; 4.2c once 4.2b has merged.
- Sidebar: 1.8, then 7.1b builds its Notebooks section on it.
- Header: 1.9 after 1.3b and 1.7b have merged, and before 1.1a and 1.2,
  which reuse its Saved toast with Undo. 7.1b and 7.5 build on its text-only
  actions menu.
- Notebook: 7.1b, then 7.2b, then 7.3 (not gated itself, but it needs 7.2b),
  then 7.5 and 7.4.
- Phase 8 (lane E): the ungated engine units 8.1a, 8.1b, 8.1e and 8.3a are
  wave 8 and start once 7.1a and 4.1b have merged; 8.1c, 8.1d and 8.1f follow
  the 8.1 prototype sign-off, with 8.2a alongside 8.1d (Next steps); 8.1g
  follows 8.1c's server half and needs no sign-off. Then
  8.3b to 8.3d, 8.4a1 to 8.4a3, 8.4b1 and 8.4b2, and 8.4f1 to 8.4f2 once the
  7.6 go conditions hold; the rest after. Migration 176 is already taken on the
  integration branch; 8.1a uses 177, 8.1c 178 and 8.1g 179, 180 and 181 are 8.2a's, 182 is 8.2d's, and 190 to 195 go to 8.4d, 8.4f2, 8.4g1, 8.5a, 8.5b
  and 8.5c1. The 8.2b to 8.3d, 8.4 and 8.5 briefs, and 8.2a's chips under chat
  answers, name prototype screens that are not drawn yet; each needs its
  screen drawn and signed off first.

When units from different lanes are ready together, merge in this order,
because they share `SqlChart.tsx`, `SqlChartCard.tsx`,
`sql-dashboard/index.tsx` and `PanelEditorDialog.tsx`: 1.9, 1.1a, 1.2, 1.1b,
4.1c, 7.1b, 4.1d, 4.3, 4.2c, 7.2b, 7.3, 7.5, 7.4.

**Conflict resolutions.** Shared files and the rule for each. All paths are
relative to `templates/analytics/` unless they start with `packages/`.

| Files | Units | Resolution |
| --- | --- | --- |
| `app/i18n/*.ts` (11 catalogs) | nearly every UI unit | Each unit adds keys only under the namespaces its Copy section names, appended at the end of that block, all eleven files in one commit; rebase and rerun `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy` after every rebase. Namespace owners: `valueFormat` 1.1a (1.2 reuses), `panelState` 1.5a (1.5b and 1.3b reuse), `notebook` 7.1b (7.2b, 7.4, 7.5 append), `dataImports` 2.3b (2.3c appends). |
| `packages/toolkit/src/app/i18n/catalogs/*.ts` | 1.7a, 1.6a, 1.7b | Same append rule. Merge 1.7a, then 1.6a, then 1.7b. |
| `shared/dashboard-panel-sources.ts` and the six hand-copied source lists | 2.1a, 2.3a, 7.2b | 2.1a is the shared prerequisite: it creates the one list and deletes the copies. 2.3a and 7.2b only add an entry there (7.2b now depends on 2.1a and no longer consolidates on its own). |
| `server/lib/dashboard-panel-query.ts` | 2.1a, 1.4a, 1.5a, 2.3a, 1.4b, 2.2c, 7.2b | Wave order. 1.4a's `staleFallback` and 1.5a's typed program errors both change `runProgramPanel`; 1.4a lands first, 1.5a keeps both. |
| `app/lib/sql-query.ts` | 1.4a, 1.5a, 1.4b | 1.4a (`forceRefresh` for every source), then 1.5a (typed errors in `executeSqlQuery`), then 1.4b (panel ids sent with the query). |
| `app/components/dashboard/SqlChart.tsx`, `app/pages/adhoc/sql-dashboard/SqlChartCard.tsx` | 1.4a, 1.5a, 4.1b, 6.2b, 1.5b, 7.1a, then gated 1.1a, 1.2, 1.1b, 7.1b, 4.1d, 4.3, 4.2c | Wave order, then the cross-lane gated order above. "As of" stays in the card header (1.4a), failure and empty states in the card body (1.5a, 1.5b). |
| `app/pages/adhoc/sql-dashboard/index.tsx` | 1.7b, 6.2b, 1.5b, 5.1b, then gated 1.9, 1.1a, 1.2, 4.1c, 7.1b, 7.2b, 7.5 | Wave order. 1.7b owns the `fetchDashboard` typed result; later units build on it. 1.9 owns the header actions (moves the ⋯ menu into `DashboardActionsMenu.tsx` and Add panel into `DashboardAddMenu.tsx`) and the Saved toast in `persist`; 1.1a and 1.2 reuse that toast, and 7.1b and 7.5 add notebook items to `DashboardActionsMenu`. |
| Dashboard share surfaces: the `ShareButton` props at `index.tsx:2042`, `packages/toolkit/src/app/sharing/ShareButton.tsx`, `ShareDialog.tsx`, `AccessRequestsSection.tsx`, `packages/toolkit/src/sharing/ShareControls.tsx`, `SharePrimitives.tsx`, `templates/clips/app/components/player/share-dialog.tsx`, `templates/content/app/components/editor/DocumentToolbar.tsx` | 1.7b, 1.9 | 1.7b first (Request edit access beside Share, access requests in the share panel); 1.9 then adds `quickCopy` and `agentTabContent`, which moves the access requests into the People tab, and checks 1.7b's tests still find them. 1.9's toolkit changes are `quickCopy.size: "compact"` in `ShareButton` and `JoinedShareControl` (12px text, 14px icons, no user-plus icon), and the compact share panel for every app (decided toolkit-wide: 320px, 24px controls, 12/16 text, 28px rows, no Share link row with `quickCopy`) in `ShareButton.tsx`, `ShareControls.tsx`, `SharePrimitives.tsx` and `ShareDialog.tsx`, with Clips' `share-dialog.tsx` frame and Content's `showShareLinks={false}` removal in the same PR and one `minor` changeset. Any other unit touching an app's share surface merges after 1.9 and keeps the compact density. |
| `app/pages/adhoc/sql-dashboard/PanelEditorDialog.tsx` (`AddPanelPopover`) | 1.9, plus the units the wave and gated orders above name for this file | Those orders; 1.9 only adds a controlled `open`, an `initialTab` and an anchor mode to `AddPanelPopover`, and leaves the form alone. |
| `app/components/dashboard/DashboardHistoryPanel.tsx` | 1.9, 7.1b | 1.9 adds the optional `metadata` slot; 7.1b passes notebook metadata through it. |
| `server/lib/dashboard-panel-verification.ts` | 1.3a, 1.4a, 1.4b, 7.1a, 1.4d, 7.2b, 7.3 | 1.3a (`verifyPanelWrite` next steps), then 1.4a (`asOf` on `PanelVerification`), then 1.4b (rollup hint), then 7.1a (`panelRunsQuery`). |
| `actions/mutate-dashboard.ts`, `actions/dashboard-mutation-api.ts` | 2.1a, 1.3a, 1.3b, 1.9, 1.1a, 1.2, 7.2b, 7.3 | Wave order. 1.1a's narrowed SQL validation scope compares the panel before and after the ops and keeps `config.growth` in scope (fixed in the 1.1a and 4.1b briefs), so a funnel edit is never saved unvalidated. |
| `actions/update-dashboard.ts`, `actions/compose-dashboard.ts` | 2.1a, 1.3a, 1.3b, 4.1b, 5.1b, 7.1a, 4.1d, 7.2b, 7.5 | Wave order; each adds its own validation rule or result field and leaves the others' alone. |
| `shared/panel-render-contract.ts`, `app/pages/adhoc/sql-dashboard/types.ts`, chart-type lists in `app/routes/chart.tsx`, `AnalyticsReviewArtifactPreview.tsx`, `NewDashboardDialog.tsx` | 4.1b, 7.1a, 1.1a, 1.2, 1.1b, 4.1d, 7.5 | Append-only to `PANEL_CHART_TYPES` (`text` 7.1a, `retention` 4.1d, `input` 7.5) and `PANEL_CONFIG_KEYS` (`yDecimals`, `rightYDecimals` 1.2); 4.1d widens `growth`'s `onlyFor`. "Has no query" goes through 7.1a's `panelRunsQuery`, never a new `||` clause. |
| `server/lib/dashboards-store.ts` (`DashboardUpsertOutcome`) | 1.3b, 5.1b, 7.1a | 1.3b adds `previousRevisionId` (wave 2), 5.1b adds `created` on top (wave 3), 7.1a only touches summaries. |
| `server/db/schema.ts`, `server/plugins/db.ts` migrations | 5.1a, 4.2b, 2.3a, 3.3a, 1.4c, 4.2c | Pre-assigned versions, each with a unique `name` (the runner applies named migrations by name, so merge order does not matter): 5.1a 168, 4.2b 169, 2.3a 170, 3.3a 171 to 173, 1.4c 174, 4.2c 175. Run `pnpm guard:additive-migrations`. |
| `server/db/index.ts` | 1.7b, 2.3a, 3.3a | Append: 1.7b sets `accessRequests` on `dashboard`, 2.3a registers `data-import`, 3.3a registers identity columns. |
| `server/plugins/agent-chat.ts` (`realDataFinalGuard`, `prepareRequest`, prompt rules) | 1.3a, 5.2, 1.6b, 2.3b | 1.3a first; 5.2 moves the prompt rules only if needed; 1.6b's closeout check goes above 1.3a's guard call; 2.3b edits `prepareRequest` only. |
| `server/lib/agent-chat-plan-mode.ts` (`INITIAL_TOOL_NAMES`), `server/plugins/agent-chat.spec.ts`, `agent-chat-baseline.spec.ts` | 2.1a, 6.2a | 2.1a adds `postgres`, then 6.2a adds `query-demo-company`; each updates the expected list and checks the prompt baseline. |
| `AGENTS.md` (4,479 of a 5,500 warn and 6,000 hard character cap) | 1.1a, 1.2, 1.3a, 3.1b, 3.3a, 3.4a, 3.4b, 4.1b, 4.2b, 4.3, 4.4, 5.2, 6.2a, 7.1a, 7.3 | Shared budget of about 1,000 characters. 1.3a, 3.4a and 6.2a replace existing text and must not grow it; every other unit adds at most 60 characters, preferably a skill name in an existing bullet, and puts the rest in its skill. Run `pnpm guard:agent-chat-context` before every merge; over 5,500 means move text to a skill. |
| `.agents/skills/dashboard-management/SKILL.md` | about 15 units | Each unit owns a named subsection and appends. "Reading Panel State": 1.4a, then 1.5a, then 1.5b. Sources table: 2.1a, 2.3a, 7.2b. Click edits: 1.1a, 1.2, 1.1b. Growth section: 4.1b creates, 4.1c, 4.1d, 4.2c, 4.3 extend. |
| `.agents/skills/cross-source-analysis`, `data-querying`, `data-programs`, `provider-api`, `dashboard-ops`, `account-health` skills | 2.1a, 2.1b, 2.2a, 2.2b, 2.3a to 2.3c, 3.1a, 3.1b, 3.3a to 3.3c, 3.4a, 3.4b, 4.2a, 5.1a, 5.1b, 6.2a | Same append rule, in wave order. 3.1a replaces the broken Stripe `data.-1.id` recipe; later units do not reintroduce it. |
| `.agents/skills/sharing/SKILL.md` and its byte-identical template copy | 1.7a, 1.7b | 1.7a, then 1.7b; each edits both copies and keeps them identical. |
| `packages/toolkit/src/app/chat/AgentKitAssistantChat.tsx`; `packages/core/src/server/agent-chat-plugin.ts` | 1.6a, 3.4a; 1.7a, 1.6a | 1.6a (partial label) before 3.4a (supplement slot); 1.7a (GET thread role) before 1.6a (`onAgentRunComplete`). |
| `server/lib/stripe.ts`, `actions/stripe.ts` | 2.2a, 3.1a, 2.2b, 3.4a | 2.2a (key kind), then 3.1a (list pagination), then 2.2b (resolver and cache keys); 3.4a adds `evidence` to `actions/stripe.ts` after 3.1a's `truncated`. |
| `app/pages/DataSources.tsx`, `app/lib/data-source-status.ts`, `actions/data-source-status.ts`, `actions/update-data-source-credentials.ts`, `server/routes/api/test-connection.post.ts` | 2.2a, 1.5a, 2.1b, 2.2b, 6.2b, 2.2c, 2.3b, 3.2, 2.3c | Wave order. In `update-data-source-credentials.ts`: 2.2a's validator map, then 2.1b's follow-up, then 2.2c moves the GA seed into `dashboard-seeds.ts`, then 3.2 adds its seeding call. |
| `app/hooks/use-navigation-state.ts`, `actions/navigate.ts`, `actions/view-screen.ts` | 2.1b, 2.3b, 2.2c, 3.3b, 5.1b, 7.1b, 4.3, 2.3c, 7.5 | Each adds optional fields; wave order. 7.1b adds the `notebooks` view. |
| `app/hooks/use-dashboard-chat-context.ts` (`selected-object`) | 1.5a, 4.1b, then gated 1.1a, 1.2, 4.3, 7.3 | Each adds optional fields; a panel-only selection clears the others. |
| `app/pages/Ask.tsx` | 1.7a, 6.2b, 7.4 | 1.7a (share button), then 6.2b (demo suggestions), then 7.4 (header button). |
| `server/lib/analytics-alerts.ts`, `server/jobs/analytics-alerts.ts` | 4.2a, 4.2b, 1.4b, 4.2c | 4.2a, then 4.2b, then 1.4b (caller label), then 4.2c. 5.1a only reads incidents. |
| `server/lib/dashboard-report-render.ts` | 1.4b, 7.1a, 1.1a, 4.1d | 1.4b and 7.1a in wave 3, then 1.1a (shared cell formatter) and 4.1d (retention HTML). |
| `server/lib/analytics-memory-capture.ts` | 3.4b, 7.4 | 3.4b (wave 1), then 7.4 moves the lineage walker. |
| `server/lib/first-party-metric-catalog.ts` | 4.1b, 4.1c, 1.4d | 4.1b moves the time helpers in their own commit, 4.1c adds `FIRST_PARTY_TIME_RANGE_FILTER`, 1.4d rewrites panels last. |
| `app/components/layout/Sidebar.tsx`, `MobileNav.tsx` | 3.3b, 1.8, 7.1b | 3.3b (Accounts item after Data sources), then 1.8 (section header "+" and the single "Show N more" row), then 7.1b (Notebooks section between Dashboards and the nav links, built on 1.8's header, and its collapsed nav item). |
| `packages/core/src/server/workspace-provider-oauth.ts`, `core-routes-plugin.ts`, `connections/catalog.ts`, `provider-api/index.ts` | 2.2b, 2.2c | 2.2b consolidates the provider list and token descriptor; 2.2c builds on it. |
| `prototypes/analytics-operators/` | 4.1a and the session that started it | 4.1a edits the existing growth screens in place and coordinates per `concurrent-agents`; no third Analytics prototype. |
| `.changeset/*.md` | 1.3a, 1.6a, 1.7a, 1.7b, 1.8, 2.2b, 2.2c, 2.3a, 3.1a, 3.4a, 6.1a, 6.1b, 7.2a | One file per unit; no shared file. |

**Needs the owner.** Decisions, access and secrets only the plan owner can
provide. Nothing is pushed until the owner reviews it.

- Sign off the prototype screens in `prototypes/analytics-operators/`, and
  settle where the drawn screens and the briefs still differ: the step menu
  and Sessions chip wording (4.3).
- After 1.9 is built, keep or reverse its three moves out of the ⋯ menu (Undo and Redo, visibility and Hidden, the metadata), Views moving into the filter bar with one save path, and the new insert bar between rows; and confirm 1.9 adds the Saved toast with Undo that the prototype draws but the code does not have yet.
- Confirm defaults the briefs flag: positional series colors (1.2); notebooks are SQL dashboards with
  `layout: "notebook"` (7.1a); v1 apps publish only to the share list
  (7.5); the weekly summary turns on with a user's first dashboard (5.1b);
  new users get only the demo company and existing Node Exporter installs
  stay (6.2b); the fictional "Acme Cloud" and its planted story (6.2a);
  `.js` program seeds versus a TS module (3.1b, 3.2, 3.3a).
- Approve all draft copy for the pitch (6.1a, 6.1b: tagline, features, SEO,
  README, docs landing, competitor naming and whether to use "Hex
  alternative"), the demo label and Ask demo questions (6.2b).
- Run a week of 1.4b's measurement on the deployed app, confirm whether the
  BigQuery `_daily_rollups`, `_user_days` and `_query` relations are tables
  or views, and make the go or no-go call for 1.4c and 1.4d; then create the
  `_user_event_days` table and scheduled query from the shipped DDL and
  share before-and-after bytes.
- For 4.2a: share production `get-first-party-analytics-health` numbers for
  an affected workspace, confirm the late alerts were on the collector with
  the BigQuery sink, and approve the 70 minute delivered-event retention and
  the one-minute Netlify alert schedule.
- Stripe OAuth (2.2b): register the Stripe app or platform, provide
  `STRIPE_CLIENT_ID` and `STRIPE_CLIENT_SECRET`, register the redirect URI,
  confirm Stripe Apps OAuth versus Connect, and find out whether a listing
  review is needed (open decision 3).
- Google: add `analytics.readonly` to the managed OAuth client and complete
  sensitive-scope verification, enable the Analytics Data and Admin APIs
  (2.2c); provide `GOOGLE_PICKER_API_KEY` and `GOOGLE_PICKER_APP_ID` and
  enable the Picker API (2.3c).
- Deployment configuration: private blob storage for imports (2.3a); a model
  credential and an email provider for the weekly summary (5.1a); a Slack
  app install on a reachable deployment, and permission for any beta check
  (5.2).
- Test accounts: a Stripe test-mode account with more than 100 customers and
  a few subscriptions including one annual and one cancelled (3.1a, 3.1b),
  and a HubSpot test portal with domains that match those customers (3.3a).
- Approve the cell engine decision rule and, if DuckDB wins, a 64 to 71 MB
  native binding (7.2a); approve the Pyodide thresholds and decide who would
  host a remote Python runner (7.6, open decision 2).
- Phase 0: supply the internal email-to-role map, recruit five outside
  founders and five outside product or growth leads, run the interviews, and
  run the usage query with org owner or admin access (0.1). Open decision 1
  (which segment leads after Phase 1) follows from it.
- After deploy, read median time to answer from the tracking sink (1.6b).

**Built so far:** nothing yet.
