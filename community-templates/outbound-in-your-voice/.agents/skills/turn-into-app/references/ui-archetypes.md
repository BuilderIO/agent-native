# UI archetypes

## Contents

- Shared by every archetype
- A1 Triage queue
- A2 Pipeline board
- A3 Live workbench
- A4 Schedule grid
- A5 Gallery and stage
- A6 Review diff
- A7 Research brief
- A8 Monitor
- A9 Runbook
- A10 Directory
- A11 Transform pane
- A12 Entry form
- A13 Conversation and artifact
- No fit

Thirteen layouts keyed by the shape of the source workflow, and a rule for
when none fits. Read only the section you picked in
[ui-direction.md](ui-direction.md). Sketches show the 1440x900 first viewport
with the agent sidebar closed; with it open the domain surface is about 780px
(1440 minus the 276px nav rail and the 380px sidebar), so rails collapse into
popovers first and panes reflow second.

## Shared by every archetype

- A left navigation with domain destinations; chat stays its own destination.
- The scaffold header carries the view switcher or object name
  (`useSetPageTitle`) and the one primary agent verb (`useSetHeaderActions`).
- Panes scroll themselves; sample data is present on arrival; each object has
  its own agent verb with a visible working state.
- At 390px a list-to-detail layout opens on the list, and the way into the
  detail is obvious: each row is a 44px target with a chevron, the detail
  opens full screen with Back, and a sticky bottom bar holds that object's
  agent verb.
- Components named below come from `@/components/ui/*`, re-exported from
  `@agent-native/toolkit/ui/<name>` when the scaffold lacks them.

## A1 Triage queue

Pick when: items arrive and a person sorts, replies, approves, or escalates
(inbox, support, applications, invoices, reviews, requests).

```
+----+-----------------------+---------------------------------------------+
|nav | [All][Needs you][Done]| Renewal terms, Acme Co        (Needs review)|
|    | o Acme renewal    2m  |---------------------------------------------|
|    | o Invoice 4821    9m  | Original message, collapsed to 6 lines      |
|    | * Contract redo  14m  | +- Agent draft ---------------------------+|
|    | o Refund ask      1h  | | Hi Dana, thanks for flagging the...     ||
|    | ... 16-24 rows ...    | | [Accept] [Edit] [Retry]      Agent, 4s  ||
|    |                       | +-----------------------------------------+|
+----+-----------------------+---------------------------------------------+
```

- Build with: resizable, scroll-area, toggle-group (filters), badge, avatar,
  textarea (draft editor), kbd, skeleton. `j`/`k` moves, `e` accepts.
- Agent verbs: row and detail "Draft reply" (the slot shimmers at once, the
  draft lands in the Agent draft block); header "Triage all" with the visible
  ids.
- Pairs with A7 when the selected item opens as a one-page document: the queue
  is ordered by urgency, each row shows its state and the reason for it.
- Seed: 16-24 items, 3 statuses, 2 with drafts, 1 overdue, 1 long subject.
- Mobile: the list is the page, rows with chevrons; detail pushes over it with
  Back and a sticky bar for "Draft reply".

## A2 Pipeline board

Pick when: items move through stages (deals, candidates, orders, content,
bugs, onboarding cohorts).

```
+----+----------------------------------------------------------------------+
|nav | [Board][List]  [Owner v] [+ Add]                      [Qualify lane] |
|    | New 6 $120k    Contacted 4     Meeting 3     Proposal 2      Won 5   |
|    | +-----------+  +-----------+   +-----------+ +-----------+           |
|    | |Acme   $40k|  |Globex $12k|   |...        | |...        |           |
|    | |DM  3d  ** |  |agent..    |   |           | |           |           |
|    | +-----------+  +-----------+   +-----------+ +-----------+           |
+----+----------------------------------------------------------------------+
```

- Build with: `pnpm add @dnd-kit/core@latest @dnd-kit/sortable@latest`
  (keyboard sensor on), badge, avatar, dialog (card detail; the right edge
  belongs to the agent), toggle-group (Board | List). Lane header: name, count,
  tabular sum.
- Agent verbs: card "Qualify" (the card ring pulses while working; score and
  next step land on the card); lane "Summarize" writes a note pinned to the
  lane.
- Seed: 5 lanes, 3-6 cards each (merge or collapse a thinner lane), values
  and ages varied, 1 stale, 1 blocked. Lanes are `h-fit`, not stretched to the
  pane height.
- Mobile: lanes snap-scroll horizontally inside their own container; with the
  A10 filter row, the only allowed sideways scrolls.

## A3 Live workbench

Pick when: inputs change outputs (spreadsheet model, forecast, pricing,
budget, calculator, what-if).

```
+----+----------------+----------------------------------------------------+
|nav | [Base|Up|Down] |  Ending cash   $70.9m  +$31.1m vs base             |
|    | Revenue growth |  +----------------------------------------------+  |
|    | ---o------ 24% |  | line chart, 3 scenarios, end values labeled  |  |
|    | Gross margin   |  | crosshair tooltip, findings as numbered pins |  |
|    | -----o---- 77% |  +----------------------------------------------+  |
|    | Headcount  +12 |  period table: FY27 FY28 FY29 (sticky header)      |
|    | [3 more levers]|  [Sheet | App] before and after toggle              |
+----+----------------+----------------------------------------------------+
```

- Build with: a slider paired with a numeric input per driver (drag or type),
  toggle-group (scenarios; Sheet | App), `recharts` line, area, or bar with soft
  fill, table, popover (source and provenance). One hero output with its delta
  in the chart header; other outputs are table rows, not a card strip.
- Sheet view shows the source cells read-only (`DataGrid` from
  `@agent-native/toolkit/data-grid`); App view is the workbench. The swap is
  the before and after, and changed outputs show their delta against the sheet.
- Recompute in the browser from the same functions the actions use, so a
  slider moves the chart instantly with no spinner.
- Agent verbs: header "Pressure-test" sends drivers and outputs; findings are
  saved by an action, appear as pins on the chart, and each has "Apply", which
  moves the sliders. Save scenario is optimistic.
- Seed: the sheet's own values; 3 saved scenarios; periods from one engine.
- Mobile: chart first, drivers in a bottom sheet, sticky Save. The period
  table becomes a period-by-period list.

## A4 Schedule grid

Pick when: the subject is time (appointments, shifts, releases, trips,
content calendars, bookings).

```
+----+-------------------------------------------------------+-----------+
|nav | < Oct 5-11 >  [Week|Day]   [Find conflicts]    [Apply] | Proposals |
|    |      Mon   Tue   Wed   Thu   Fri                      | Wed 8:30  |
|    | 8am  |     |     |/////|     |     ///= proposed      | [Accept]  |
|    | 9am  |     |     |APPT |     |     XXX= conflict      | [Dismiss] |
|    | 10am |     |     |/////|     |     now line, all-day  | Conflicts |
|    |      events as colored blocks, striped ghost proposals| 1 external|
+----+-------------------------------------------------------+-----------+
```

- Build with: CSS grid, 7 columns by 15-minute rows, blocks positioned by
  percent, ghost blocks with `repeating-linear-gradient`, popover (details),
  scroll-area (rail), badge. The rail is a list, never a form.
- Agent verbs: "Find conflicts" and "Propose blocks"; ghost blocks appear in
  the grid as the agent saves them, each with Accept and Dismiss. Apply writes
  externally, so it opens a review of the exact changes first.
- Seed: one real-looking week, 10-14 events, 2 appointments needing buffers,
  1 external-attendee conflict, 1 all-day.
- Mobile: day view, a week strip above it, proposals in a bottom sheet.

## A5 Gallery and stage

Pick when: the output is a set of generated artifacts to compare and refine
(creative, slides, layouts, images, copy variants, thumbnails).

```
+----+----------------------------------------------------------------------+
|nav | [All][Approved][Drafts]                  size --o--     [Generate 4] |
|    | +------+ +------+ +------+ +------+ +------+                         |
|    | | art  | | art  | | art  | | art  | | art  |   click: tile expands   |
|    | +------+ +------+ +------+ +------+ +------+   into a stage with a   |
|    | +------+ +------+ +------+ ...                 variant strip below   |
+----+----------------------------------------------------------------------+
```

- Build with: CSS grid with `aspect-ratio`, view transitions for tile to stage
  (`view-transition-name` per tile), toggle-group, slider (tile size), dialog or
  a full-pane stage with previous and next, tooltip. Media outlines per the
  palettes.
- Agent verbs: stage "More like this" and "Refine" (new tiles appear as
  skeletons, then fill); gallery "Generate 4".
- Seed: 9-12 authored SVG or CSS compositions in `public/`, varied ratios.
  Never grey boxes or stock placeholders.
- Mobile: two columns; the stage becomes full screen with swipe.

## A6 Review diff

Pick when: changes are proposed and a person accepts or rejects them
(contracts, copy, config, data fixes, moderation, code changes).

```
+----+-----------+--------------------------------------------+------------+
|nav | Changes 5 | Before             | After                 | Why        |
|    | [x] Title | The Company shall  | The Company will      | Plain      |
|    | [ ] Term  | ...~removed~       | ...+added+            | language   |
|    | [x] Fees  |--------------------------------------------| [Re-draft] |
|    | ...       | sticky: 3 of 5 accepted   [Approve accepted]            |
+----+-----------+--------------------------------------------+------------+
```

- Build with: `pnpm add diff@latest` for word-level hunks, a checkbox per hunk,
  toggle-group (Split | Inline), a sticky action bar, scroll-area, badge.
- Agent verbs: per hunk "Explain" and "Re-draft"; header "Review all" adds a
  rationale to each hunk. Approve is explicit and shows the count.
- Seed: one real-looking document with 5-7 hunks, mixed severity, 1 rejected.
- Mobile: hunk list first; a hunk opens a full-screen inline diff.

## A7 Research brief

Pick when: sources become a written brief, report, plan, one-pager, or dossier.

```
+----+---------+------------------------------------------+---------------+
|nav | Outline | Title lives in the document itself        | Sources (7)   |
|    | Summary | Paragraph with claims [1][3] as chips,    | [1] Report... |
|    | Market  | highlighted when its source is hovered    | [2] Filing... |
|    | Risks   | [Deepen] [Add counterpoint] on hover      | filter claims |
+----+---------+------------------------------------------+---------------+
```

- Build with: a 66ch reading column (the one place a centered column is
  right), the paper-desk serif body, hover-card for citation previews,
  scroll-area, skeleton paragraphs while a section regenerates.
- Fixed sections from the source render as structure (headings, chips,
  counters), not as one markdown blob, so a fixed shape stays visible.
- Agent verbs: section "Deepen", "Add counterpoint", "Check claims"; the
  section shows a working state and the new text lands with a visible diff.
- Seed: a finished document, 3-4 sections, 6-8 real-looking sources with
  title, publisher, date, and an excerpt. Never leave sources empty.
- Mobile: document full width; sources in a sheet from the citation chip.

## A8 Monitor

Pick when: signals over time need watching (alerts, spend, health, usage,
funnel, error rates, anomalies).

```
+----+---------------------------------------------------+----------------+
|nav | [Last 24h v] [Service v]            [Investigate] | Anomalies      |
|    |  +----------------------------------------------+ | * 14:20 spike  |
|    |  | hero series with band and anomaly markers    | |   agent note   |
|    |  +----------------------------------------------+ | * 09:02 drop   |
|    | [small multiple] [small multiple] [small multiple]|                |
|    | entity | sparkline | value | delta | status       |                |
+----+---------------------------------------------------+----------------+
```

- Build with: `chart` over `recharts` (one dominant chart across the pane,
  with a reference area for anomalies, and small multiples below it), a table with inline sparklines, select, badge, scroll-area. No
  stat-card strip. A gap in the data renders as a gap, not as zero.
- Agent verbs: anomaly "Investigate" (adds a finding under the anomaly);
  header "Investigate all". Clicking an anomaly brushes both charts to it.
- Seed: 30 days of generated series per entity with 2 injected anomalies,
  10-14 entities, mixed statuses.
- Mobile: charts stack; the anomaly feed becomes the first of two tabs.

## A9 Runbook

Pick when: a procedure has state, owners, evidence, and blockers (release,
onboarding, audit, incident, trip prep, compliance). Not a stepper: every item
is visible and any order is allowed.

```
+----+-------------+---------------------------------------------------+
|nav | Prep   4/4  | Release 4.2                  7 of 18   [Run next] |
|    | Verify 2/6  | [x] Freeze main              Sam      done        |
|    | Ship   0/5  | [x] Tag release              agent    done        |
|    | Comms  1/3  | [ ] Smoke tests   blocked: staging down      !    |
|    |             |     evidence, notes, links (expanded row)         |
+----+-------------+---------------------------------------------------+
```

- Build with: one scrolling document with section anchors, checkbox,
  collapsible rows, progress, avatar, badge for blocked and due. Progress lives
  in the rail.
- Agent verbs: item "Run" for agent-doable items (the row shows working, then
  done with evidence attached); header "Run next".
- Seed: 18 items in 4 groups, 7 done, 2 blocked, 1 overdue, owners mixed.
- Mobile: sections collapse; the rail becomes a sticky section picker.

## A10 Directory

Pick when: many records are browsed, edited, enriched, or scored (contacts,
accounts, vendors, candidates, inventory, findings, a sheet of rows).

```
+----+-----------------------------------------------------------------+
|nav | [All 214][Hot 18][Stale 31] +view   search      [Enrich selected]|
|    | [ ] Name        Company     Stage   Score        Last touch  Owner|
|    | [x] Priya Nair  Northwind   Demo    82 ..-^      3d          JL   |
|    | [x] ...         ...         ...     agent-filled cells carry a dot|
|    | row click opens a dialog profile with a timeline                  |
+----+-----------------------------------------------------------------+
```

- Build with: `DataGrid` from `@agent-native/toolkit/data-grid` (selection,
  inline edit, resizable columns), saved views as toggle-group pills, a
  selection bar, a dialog or sheet profile, skeleton rows, badge, avatar.
- An impact-by-effort or score-by-confidence scatter beside the table turns a
  ranked list into a decision view when rows carry two measures.
- Agent verbs: selection bar "Enrich", "Score", "Dedupe"; cells show a working
  shimmer, then the value with an agent dot and an Undo.
- Seed: 25-40 varied rows with gaps, duplicates, long names, mixed stages.
- Mobile: rows become two-line cards; the filter row scrolls sideways inside
  its own container.

## A11 Transform pane

Pick when: one input becomes one result the user judges and reuses (rewrite,
summarize, classify, translate, extract, generate from a brief, a calculator
with a text result). The input is the work: show it, filled.

```
+----+---------------------------+----------------------------------+-----------+
|nav | Input (sample, filled)    | Result                           | History   |
|    | [source text ..........]  | structured result or diff        | Today     |
|    | [Tone v] [Length v] [Run] | [Copy] [Accept] [Retry]          | * Run 14  |
|    |                           | Agent, 4s                        | * Run 13  |
+----+---------------------------+----------------------------------+-----------+
```

- Build with: resizable, textarea, select or toggle-group for options, a diff
  or structured result view, a history list with Restore, skeleton.
- Agent verbs: Run (the result pane shows the working state and receives the
  result through an action); Retry with a changed option.
- Seed: a realistic filled input, a finished result beside it, 8-12 history
  runs with varied options.
- Mobile: input above result; history in a sheet.

## A12 Entry form

Pick when: the job is capturing structured records and the form is the work
(intake, application, expense, order, survey).

```
+----+----------------------------------+------------------------------------+
|nav | New expense                      | Recent entries                     |
|    | Vendor [.......] Amount [.....]  | Date   Vendor    Amount   Status   |
|    | Category [v]   Receipt [drop]    | ... 12-20 rows ...                 |
|    | [Save]   [Fill from receipt]     | a selected row opens in the form   |
+----+----------------------------------+------------------------------------+
```

- Build with: real fields in sections (never a stepper), inline validation,
  sensible defaults, Enter to save, and a table beside the form so the form is
  not the only object.
- Agent verbs: "Fill from receipt" or "Check"; fields the agent filled carry
  the agent mark with Undo.
- Seed: the form holds one realistic draft; 12-20 saved entries, mixed
  statuses, a missing optional field.
- Mobile: tabs, Form | Entries.

## A13 Conversation and artifact

Pick when: the workflow is a dialogue (coach, interviewer, tutor, intake) and
the value is the structure extracted from it.

```
+----+-----------------------------------------+---------------------+
|nav | Sample session transcript, turns        | Scorecard / notes   |
|    | attributed, with the agent's marks      | next steps          |
|    | [Continue session]                      | updated by actions  |
+----+-----------------------------------------+---------------------+
```

- The agent sidebar is the live conversation; there is no second prompt box.
  The canvas is the conversation's memory and updates through actions.
- Agent verbs: "Continue session" (opens the sidebar with the session id and a
  bounded summary); each extracted item has Accept, Edit, Retry.
- Seed: one finished session and two earlier ones, with their scorecards.
- Mobile: scorecard first, transcript below.

## No fit

If no archetype fits, or the one that fits makes the source's main object
disappear, do not bend the source. Name the object noun, compose one
collection (list, table, board, calendar, grid, tree) with one focus
(document, detail, chart, form, map), put the agent verbs on the objects, and
record "Archetype: custom, nearest A\_" in `DESIGN.md`. When a listed
first-party template already is the object (`content` for an editable
document, `forms` for a form builder), scaffold from it and say so in the
brief. An editor the user types into gets suggestions as A6-style inline
diffs, not a section-level "Deepen" verb. A truly gated procedure, where order
is enforced and the artifact does not exist until the end, may use a stepper.
