# UI direction for generated apps

## Contents

1. Precedence
2. The first viewport is the user's world
3. Pick the archetype
4. Pick the direction and record it
5. Shell and agent instructions
6. Sample data
7. Agent moments the user can watch
8. Craft floor
9. Anti-patterns

## 1. Precedence

- The user's explicit direction and an existing brand win over this guide.
- For the domain surface, this guide wins over any installed design skill,
  including the scaffold's own `frontend-design` and `DESIGN.md`: it sets the
  populated first viewport, per-object agent verbs, filters, and the
  direction's token block (the scaffold's neutral tokens are the starting
  point, not a theme to preserve). Keep those skills' shadcn, chrome,
  accessibility, and polish rules.
- Chrome rules (titles, eyebrows, subtitles, stat strips, helper text) limit
  decoration, never the amount of real data on screen.
- The source's stated context of use sets the viewport you design first (a
  phone between calls, a wall display, print). Design that one first and
  still pass the other. A one-page reading column is right inside a pane
  layout when the user reads it on a phone; the no-centered-column rule is
  about page chrome around the data.

## 2. The first viewport is the user's world

The app is a place, not a procedure. A source describes steps; the app shows
the objects those steps act on, and the steps become status on them (Draft,
Checked, Approved). At 1440x900 the domain object (grid, board, chart,
document, table) fills most of the viewport, populated, with one visible agent
verb. Names, dates, and numbers are content. Keep non-data text in the first
viewport under about 40 words (the review script ignores record text and
document body marked `data-content`); explanation goes in a tooltip, a
popover, or a secondary region's empty state.

A stepper fits only when order is enforced and the artifact does not exist
until the last step, which almost never holds for a proven workflow. `Tabs`
switch peer views of the same data (Board | List, Sheet | App), never sequence.
A form is a Dialog, Popover, Sheet, or inline row editor behind an Add verb,
unless the form is the work (A12) or the input is the work (A11); then it is
the first object on screen, filled with a realistic sample, beside what it
produces. The agent composer takes free text.

## 3. Pick the archetype

Finish the sentence "the user looks at a **_ and acts on its _**", then open
that section of [ui-archetypes.md](ui-archetypes.md). One archetype per
destination; a second job gets its own navigation destination.

| The source is about                                           | Archetype                             |
| ------------------------------------------------------------- | ------------------------------------- |
| incoming items to sort, reply to, approve                     | A1 Triage queue                       |
| items moving through stages                                   | A2 Pipeline board                     |
| numbers, scenarios, a spreadsheet model                       | A3 Live workbench                     |
| time: appointments, shifts, releases, trips                   | A4 Schedule grid                      |
| generated artifacts to compare and refine                     | A5 Gallery and stage                  |
| proposed changes to accept or reject                          | A6 Review diff                        |
| sources turned into a brief, report, or one-pager             | A7 Research brief                     |
| signals, alerts, health, spend over time                      | A8 Monitor                            |
| a procedure with state, owners, and evidence                  | A9 Runbook                            |
| many records to browse, score, enrich                         | A10 Directory                         |
| one input becomes a result to judge and reuse                 | A11 Transform pane                    |
| structured records captured through a form                    | A12 Entry form                        |
| a dialogue whose value is the structure extracted from it     | A13 Conversation and artifact         |
| none of these, or the main object vanishes in the nearest one | Custom ("No fit" in ui-archetypes.md) |

Pairings are common (a queue whose selected item opens as a document, A1 with
A7; a directory with a board view, A10 with A2; a workbench with a drill-down
table, A3 with A10). The first archetype picks the direction; the second only
borrows components. If the source's main object disappears in the archetype
you picked, you picked wrong.

## 4. Pick the direction and record it

Take the directions whose Fits column lists the first archetype. Among them,
take the one whose Domain column names the source's domain. If none or several
match, number those candidates from 0 in table order and take the one at
(length of the app slug) mod (number of candidates). Never choose by taste. A
direction outside the Fits column needs a one-line reason in `DESIGN.md`.

| Direction     | Fits                    | Domain                                             | Type                                | Accent |
| ------------- | ----------------------- | -------------------------------------------------- | ----------------------------------- | ------ |
| ledger        | A3 A8 A10 A12           | finance, planning, forecasting, analytics          | Geist, tabular figures              | pine   |
| control-room  | A8 A1 A9 A10            | engineering, code, ops, incidents, security        | Inter Tight, JetBrains Mono         | amber  |
| paper-desk    | A7 A6 A9 A11 A13        | writing, research, policy, legal, education        | Figtree, Source Serif 4 body        | plum   |
| studio-canvas | A5 A2 A11               | creative, media, design, marketing                 | Bricolage Grotesque, Hanken Grotesk | lime   |
| tidepool      | A4 A10 A9 A1 A2 A12 A13 | people, recruiting, HR, scheduling, support        | Onest                               | teal   |
| signal-board  | A2 A1 A9                | sales, customer accounts, delivery, project status | Schibsted Grotesk                   | cobalt |

A brand in the source wins: its color goes in `--primary` and `--ring`, the
neutrals stay, and you still append a direction block and the shared block.
Apply the tokens from [ui-palettes.md](ui-palettes.md); a first screen on the
scaffold's grey tokens, or on a near-black primary, fails review.

Before appending to `DESIGN.md`, rename the scaffold's `## Visual direction`
heading to `## Chat route direction` and change its "Preserve the scaffold's
semantic tokens" guardrail to name your direction, so the in-app agent reads
one direction per surface. Then append a block like this:

```md
## <Route> surface

- Archetype: A3 Live workbench, with an A10 drill-down
- Direction: ledger (Fits A3, domain finance); tokens from ui-palettes.md
- Composition: drivers rail left, hero chart and period table right, agent
  findings pinned on the chart
- Agent moments: Pressure-test (header) writes findings through `add-finding`
- Sample data: the workbook's own values, labelled snapshot; cleared from the
  Sample data menu
- Signature: the one element only this domain has (pins on the chart that
  link back to the source cells)
- Refuses: the default look this domain usually gets, and what replaces it
  ("a KPI-card strip over the table" becomes "one hero output in the chart
  header")
```

## 5. Shell and agent instructions

- Add the domain route and a domain-named sidebar link; keep the chat route
  and the agent sidebar. The app must open on the domain surface: set
  `app.homePath` to the domain route. A standalone app whose slug differs from
  the template has `server/plugins/agent-native-email-branding.ts` with
  `homePath: "/home"` (the empty Chat): change only that value. When the file
  is missing (a slug equal to the template name, or a workspace app), create
  it:

  ```ts
  import { defineAppConfig } from "@agent-native/core/server";
  export default defineAppConfig({ app: { homePath: "/<route>" } });
  ```

  Then check that `/` lands on the route, and restart the dev server if it
  does not. Other edit points in the chat scaffold: a route file under
  `app/routes/`, a `<Link>` inside the `<nav>` of
  `app/components/layout/Sidebar.tsx` before `<ChatThreadsSection />`, and the
  route and selected ids in `app/hooks/use-navigation-state.ts`. Leave
  `home.tsx`, `chat.$threadId.tsx`, `Layout.tsx`, and `root.tsx` as they are.

- Teach the in-app agent the new app. Rewrite the purpose line of `AGENTS.md`
  and add one short section (routes, invariants, the action table with
  unpadded cells, the new navigation fields, the sample-data rule), keeping
  the file under about 5,500 characters (compact prompts cut it at 6,000). Put
  the primary actions in `INITIAL_TOOL_NAMES` and a domain-specific system
  prompt in `server/plugins/agent-chat.ts`, and the display name in
  `rawAppTitle` in `app/lib/app-config.ts` (and `app.name` in the branding
  plugin when it exists).
- The header title is the page's only title: no in-page H1, eyebrow, or
  subtitle, and no heading row under the header that names the view again
  ("Findings" under "Audit workbench"). Put the view switcher or object name
  in the header with `useSetPageTitle(node)` and the primary verb with
  `useSetHeaderActions(node)`, both from `@agent-native/toolkit/app-shell`.
  The title node must shrink: text in `<span className="min-w-0 truncate">`
  with the full value in `title`. Header actions never shrink, so at 390px keep
  one labelled button and turn the rest into icon buttons with `aria-label`,
  or one overflow menu.
- Panes fill the viewport: the page root is `flex h-full min-h-0`, and each pane
  scrolls itself. No `max-w-3xl mx-auto` page column; the A7 reading column is
  the one exception.
- The nav rail takes 276px and the open agent sidebar 380px, so at 1440 the
  domain surface is about 780px (1164px with the agent closed). Design
  two-pane layouts for that width (a 280-320px list beside a detail of about
  460px), collapse rails into popovers first, and reflow with container
  queries (`@container`, `@3xl:`). Review the sidebar-open click shot too.
- Import controls from `@/components/ui/*`. When one is missing, add a one-line
  re-export like the scaffold's `button.tsx`:
  `export * from "@agent-native/toolkit/ui/<name>";`. The toolkit ships tabs,
  badge, table, select, dialog, sheet, popover, slider, switch, toggle-group,
  scroll-area, resizable, skeleton, empty, avatar, progress, checkbox,
  separator, kbd, textarea, alert-dialog, and chart. Use
  `pnpm dlx shadcn@latest add <name>` only for a component the toolkit lacks.
- Editable grids use `DataGrid` from `@agent-native/toolkit/data-grid`. Charts
  use `ChartContainer` and `ChartTooltip` from `@/components/ui/chart` (a
  re-export of the toolkit's) over `recharts`, added at the toolkit's own
  range so one copy is installed:
  `pnpm add recharts@"$(node -p "require('./node_modules/@agent-native/toolkit/package.json').dependencies.recharts")"`.
  Icons come from `@tabler/icons-react`, one stroke weight.
- Long text (plans, briefs, notes, agent output) renders as formatted content:
  fixed sections as structure, free text through `InlineMarkdown` (with
  `renderLists`) from `@agent-native/toolkit/app/review`. Never raw `#` or
  `**`, and never markdown in a monospace block.
- Confirm destructive actions with `AlertDialog`, never browser dialogs.

## 6. Sample data

- Derive it from the source's examples: the same fields, ranges, and edge
  cases. Write synthetic lookalikes by default. Reuse the worked example's own
  names and values only when the user supplied them for this app (a workbook,
  a fixture) or the source marks them as fictional, and label them sample or
  snapshot. Never include anything marked internal or confidential, and never
  a real person's contact detail.
- Enough varied records to fill the archetype (a dozen or more by default),
  with the edge cases the source mentions (overdue, conflict, blocked, missing
  value). Numbers come from the same functions the UI uses, so totals agree
  across views.
- Make it look real. Store dates as offsets from the seed moment ("2 days
  ago", "Wed 14:00 this week") so the first viewport reads as now. Names are
  unique; amounts are not all round; titles vary in length, with one over 60
  characters and one 9-digit amount; optional fields are sometimes blank; each
  status the UI shows has at least two records. Avoid Acme, John Doe, Foo, and
  Test 1. A board lane holds 3-6 cards; merge or collapse a thinner one.
- Hazards stay visible: missing renders as missing, not 0; partial renders as
  partial; untrusted text renders as text and never enters a prompt as an
  instruction.
- Insert it with an idempotent action (for example `seed-sample-data`) that the
  client calls once per user; never at module load, in a migration, or at
  server start. Mark rows as sample. One "Sample data" menu entry clears them,
  and the choice is remembered. No badge on every row.
- Media goes in `public/` or file storage, never SQL. A spreadsheet's sample is
  the workbook's own bounded values, labelled as a snapshot.

## 7. Agent moments the user can watch

A control named in the source's verbs (Draft, Check, Pressure-test, Regenerate)
does four things:

1. At the click, the object enters a working state in local state, in the slot
   where the result will land (the `working` shimmer, "Drafting", Cancel).
   Then persist the status through an action so a reload and the agent see
   it: `idle`, `agent_working`, `needs_review`, `accepted`, `failed`. Failed
   never looks like idle.
2. It calls `sendToAgentChat` as SKILL.md step 4 describes, with the object id
   and a bounded summary; `chatTarget: "local"` keeps the run in this app's
   own agent when the app is embedded in another frame.
3. The agent writes the result through an action into the rows the UI renders;
   the chat run refreshes action queries, so the object updates in place.
4. The result shows attribution and Accept, Edit, Retry.

An object never stays busy without a run behind it:

- Read `useAgentEngineConfigured()` from
  `@agent-native/core/client/use-agent-engine-configured`. When `missing` is
  true (no AI provider), the click still opens the sidebar on the shared
  setup card, and the object shows "Connect AI to draft" instead of a working
  state.
- If `isGenerating` from `useSendToAgentChat()` in
  `@agent-native/toolkit/app/chat` has not turned true within about 8 seconds
  of the click, or turns false without a result, set `failed` with "No agent
  run finished" and Retry.
- The read action computes status: an `agent_working` row older than 10
  minutes reads as `failed`.

Put the verb on the object (row, card, block, cell, section) and at most one
bulk verb in the header. Never a lone ghost "Ask agent" beside a primary
button, and never a control labelled as AI that changes nothing on the page.

Agent-authored content carries one mark everywhere: a 6px `--primary` dot,
"Agent, 4s" in `text-muted-foreground`, and a `bg-accent` tint on the block
until the user accepts or edits it.

## 8. Craft floor

- Contrast: text 4.5:1, large text and chart marks 3:1. Status is a dot plus a
  label, never color alone.
- Color: one accent family for action, selection, and state; tinted neutrals.
  Status and chart colors come from tokens (`text-ok`, `bg-bad/10`,
  `stroke-chart-1`), never a Tailwind palette shade (red-100, gray-500), a
  white or black utility, or hex in a route or component: those stay light in
  dark mode.
- Type: one workhorse sans, tabular numbers for data, balanced headings, prose
  at 65-75ch, sentence case.
- Surfaces: shadows over borders on cards and panels; concentric radii (outer
  radius = inner radius + padding); a 1px low-opacity outline on images. Group
  by proximity before boxing: tight groups, generous separation, more space
  above a heading than below. A card gets a title or a description, never
  both.
- Interaction: a 40px hit area on desktop and 44px on touch (a dense direction
  may draw a 28-32px control and extend its hit area with a pseudo-element),
  press scale 0.96, visible focus rings, and hover, disabled, loading, and
  error states. Inputs are 16px on mobile; iOS zooms below that.
- Motion: 150-250 ms on named properties with `ease-out-strong`, never
  `transition-all`; motion shows state change only; no load choreography;
  honor `prefers-reduced-motion`.
- Overflow: check the long title and the 9-digit amount at 390px and with the
  sidebar open. Truncate with the full value reachable (`min-w-0 truncate`
  plus `title`, or a line clamp). A table with more than three columns becomes
  a row list at 390px (name, primary value, one secondary line) or pins its
  first column with a visible edge fade; a cut-off header is a fail.
- Charts: an explicit height on the container (`h-64` or an aspect class); a
  chart in a flex pane without one renders at 0px. One hero series in
  `--chart-1`, comparison series muted or `--chart-2` to `--chart-4`, direct
  end labels instead of a legend, a dotted 1px `--border` grid with no
  vertical lines, no axis lines, compact ticks with units ($1.2m, 38%),
  tabular figures, a zero baseline for bars, gaps drawn as gaps, the
  actual-to-projected boundary marked, and the one thing worth noticing
  annotated. No dual axes, 3D, or a pie with more than three slices. If a
  `dataviz` skill is installed, read it first.
- States: every collection has four, drawn in its own layout. Loading is a
  layout-shaped `Skeleton`. Empty (sample data cleared, or a filter with no
  hits) uses `Empty` from `@/components/ui/empty`: one sentence naming the next
  verb, and that verb as a button. Error is inline in the pane that failed:
  the reason, Retry, and the last good data left visible. Partial is a
  labelled row above the data, never a silently short list. A toast alone is
  not an error state. Writes are optimistic with rollback; a spinner only for
  a short mutation.

## 9. Anti-patterns

- A stepper, numbered tabs, "Step N of M", or a wizard as the shell.
- A centered narrow column; a textarea or form as the home of a source that is
  not form- or input-shaped (A11, A12).
- An eyebrow over a large H1 and a subtitle; the nav title repeated in the
  page; a heading under the header title; section headings that restate the
  object.
- Cards in cards; equal-weight card grids as page structure.
- A stat strip over data already visible; a row of big-number tiles (the
  hero-metric template). One hero number inside a chart header is fine.
- An empty first viewport while sample data is on; an empty state with no next
  verb; lorem, "Item 1", uniform fake rows.
- Unchanged scaffold tokens; one accent on everything; status-chip soup.
- Paragraphs over objects: helper text, explanatory footers; raw markdown.
- Default chart styling; SVG strokes that vanish in dark mode.
- Palette classes or hex for status, surface, or text; a colored side-border
  stripe wider than 1px on a card, row, or alert; an emoji or unicode glyph
  standing in for an icon.
- `transition: all`, entrance animation on every load, hover-only actions.
- Sparkle, wand, magic, or robot icons; a second freeform prompt box.
