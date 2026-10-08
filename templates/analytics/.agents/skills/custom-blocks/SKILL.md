---
name: custom-blocks
description: >-
  Create, embed, clone, or repair a Custom Block (extension panel). Use for a bespoke visualization native panels cannot draw, or to fix or copy an extension-backed dashboard.
---

# Custom Blocks

Analytics has one user-facing artifact type: dashboards. Build with native
dashboard panels and Data Programs first. A sandboxed extension embedded in a
dashboard is presented to users as a Custom Block, not as a separate Analytics
artifact.

Use native chart, table, metric, section, funnel, heatmap, callout, filter, and
layout capabilities whenever they can represent the request faithfully.
Reusable ROI, engagement, cross-sell, and win/loss dashboards compose these
native panels around real SQL or Data Program results. Use a Data Program when
the durable need is reusable fetching, transformation, or computed data that
native panels can render. Dual-axis charts are native (`config.rightYKeys`),
never an extension. Do not create a Custom Block merely because a request says
custom, asks for a dashboard, or would take more effort with native components.

## When To Create One

Create a Custom Block only when the user explicitly asks for a genuinely
bespoke or one-off visualization or interaction, the native dashboard model
cannot represent it faithfully, and its intended scope is this dashboard.

- Create it with `create-extension`, immediately embed it as a
  `chartType: "extension"` panel with `config.extensionId`, and set
  `config.customBlock` to `{ authoredBy: "agent", intent: "one-off", scope: "dashboard", nativeGapReason: "custom-visualization" | "custom-interaction" | "custom-layout" | "other" }`.
  Choose the narrow categorical reason; never put prompt text, customer data, or
  other free text in this metadata.
- Use the host theme CSS variables and match the dashboard typography, card
  spacing, and density so the sandboxed content reads as an agent-authored patch
  to Analytics instead of a foreign mini-app. Describe it as a sandboxed,
  agent-authored dashboard patch.
- Never leave it standalone or direct the user to an Extensions page.
- A Custom Block is a fast runtime patch, not the durable destination for
  reusable product behavior. If the request should work across dashboards or
  users, changes app chrome or business logic, adds a reusable chart type, needs
  native accessibility/export/governance, or explicitly asks for app code, a PR,
  or a native feature, call `connect-builder` with the request verbatim instead
  of creating a Custom Block. If scope is ambiguous, ask whether the user wants a
  one-off block for this dashboard or a reusable app feature.
- When the user chooses Promote to app code, preserve the existing Custom Block
  and pass its dashboard id, panel id, extension id, and requested native
  placement through `connect-builder`; do not delete or replace the block until
  the native implementation is reviewed and deployed.
- Legacy analyses and existing extension-backed dashboards remain readable and
  editable for compatibility.

An explicit request to build one authorizes every non-destructive step in the
same turn: query or scaffold, seed extension data (`extension-data-set`), save,
embed, and `navigate`. Do not leave an empty shell or ask whether to proceed.

## Extension Data Boundary

Code inside a Custom Block runs in an iframe and may call only actions that are
HTTP-mounted and intended for `appAction`. Use the canonical `bigquery` action
for warehouse SQL; never call `query-agent-native-analytics`,
`bigquery-table-info`, or another `http: false` agent-only action from extension
code. For first-party Analytics data, prefer a native `source: "first-party"`
panel, or query it as the agent and seed the extension data store.

## Embedding An Extension As A Panel

Use `chartType: "extension"` to add an extension box alongside normal SQL
charts. The panel skips `source` and `sql`. For ordinary requests such as "put
X in this dashboard," save the author-selected extension id in
`config.extensionId`. This makes the selection part of the shared dashboard and
keeps the widget present in scheduled report captures:

```jsonc
{
  "id": "pipeline-widget",
  "title": "Pipeline Widget",
  "chartType": "extension",
  "width": 3,
  "config": { "extensionId": "extension-123" },
}
```

Direct embeds receive the dashboard id, name, description, current filters, and
panel context. Embedding does not grant extension access, so share the
extension with the dashboard audience (`share-resource --resourceType
extension ...`); otherwise viewers see an "extension unavailable" placeholder.

Use a stable `config.extensionSlotId` only when the user explicitly wants each
viewer to choose or install their own widget:

```text
analytics.dashboard.<dashboard-id>.panel.<panel-id>
```

Create or choose the extension, call `add-extension-slot-target` with the
extension id and slot id, then call `install-extension` with the same values.
The dashboard panel is shared, while the installed extension is per-user. Empty
slots show the normal install affordance instead of a broken iframe.

```jsonc
{
  "id": "pipeline-widget",
  "title": "Pipeline Widget",
  "chartType": "extension",
  "width": 3,
  "config": {
    "extensionSlotId": "analytics.dashboard.weekly-metrics.panel.pipeline-widget",
  },
}
```

- Both direct and slot-backed extensions receive dashboard and panel context.
- Installs and extension access are per viewer. Slot installs are per-user
  preferences, so different viewers can see different widgets and scheduled
  reports running as a service identity may show an empty slot. This is why
  slots are opt-in rather than the default.
- Inspect an existing Custom Block through the `get-sql-dashboard` panel
  summaries (`extensionId`, `extensionSlotId`).

## Cloning A Direct-Extension Dashboard (e.g. per-customer copies)

When the user asks for a copy of an existing extension-backed dashboard for a
different customer/org (for example "make an Intuit version of the Roku usage
dashboard"), follow this playbook. Extension bodies are frequently tens of
thousands of characters. The reliable path is to read+transform+write the body
INSIDE `run-code` (where `workspaceRead` returns the full file) and then create
from that written file — never by pulling the body into chat context first or
re-typing it as a `content` argument.

1. `get-sql-dashboard` on the source dashboard (pass the extension panel's id in
   `panelIds`) and confirm the target panel is a `chartType: "extension"` panel
   with `config.extensionId`; grab that extension id. For a slot-backed panel,
   clone the dashboard panel with a new stable `extensionSlotId`, then target
   and install the desired extension into that slot instead of using this
   body-copy playbook.
2. `get-extension` for that id with `forceContent: true` **exactly once**. Reuse
   that body for the rest of the turn — a second same-run read intentionally
   omits `content` and returns `contentOmitted` instead. That is not the content
   disappearing; use the copy you already have. Do NOT try to re-fetch the body
   with `run-code` (`appAction('get-extension')`) to page past a display
   truncation — the same-run omit makes it return empty `content`, wasting turns.
   If you need the full body again, read the workspace resource file (step 5) or
   set `forceContent: true` on a single native `get-extension`.
3. Change ONLY the small customer-specific static config (e.g. the
   `ACCOUNT_USAGE_STATIC` block: company name, title, org-discovery filters,
   messaging). Prefer a focused `update-extension` edit/patch over regenerating
   the entire HTML.
4. **Call `create-extension` / `update-extension` as native tools.** They are
   mutating actions and are NOT callable from `run-code` / `appAction` (the
   sandbox bridge only exposes read-only actions). Do not try to create or update
   an extension from inside `run-code`.
5. **If the source body already exists as a workspace/shared resource file**
   (e.g. a pre-built `intuit-analytics-extension.html`), do the read AND the
   customer swap in ONE `run-code` call, then create from the written file:
   - Inside `run-code`: `const src = await workspaceRead('<source>.html')`
     returns the WHOLE file (it auto-pages; there is no 50k cap here), do the
     small string-replace on the static config block, then
     `await workspaceWrite('<target>.html', modified)`.
   - Then call `create-extension` (native) with
     `contentFromWorkspaceFile: '<target>.html'` and leave `content` empty — the
     server reads the full file verbatim.
   Do NOT read the source body with the `resources` read tool (or `get-extension`)
   first just to transform it: that display is capped and wastes a turn. And do
   NOT re-emit an 80k+ char body as the `content` argument — it gets cut off
   mid-stream. `contentFromAttachment` only sees files the user pasted into chat,
   not workspace resources. `create-extension`/`update-extension` are mutating and
   cannot run from `run-code`, so only the read+write+transform happens there.
6. Finally save a new dashboard embedding the new extension panel
   (`chartType: "extension"`, `config.extensionId`) with `update-dashboard`, then
   `navigate` to it.

## Repairing An Existing Extension-Backed Dashboard

When the user asks to fix data loading in an existing or migrated
extension-backed dashboard, treat the current extension body as user-authored
design. Read the dashboard config and extension once, identify the smallest
data-loading seam, and call `update-extension` with exactly `id`,
`operation="edit"`, and a `payloadJson` string containing focused
`patches`/`edits` that change only that seam. Never send empty placeholder
fields. Preserve the existing layout, CSS, copy, and interactions. Do not send a
reconstructed full `content` body for a data-only repair.

A request that combines a visual rewrite (compacting, removing sections,
renaming, changing padding) with a data repair is a broad rewrite: after
inspecting the current extension, use `operation="replace"` with the complete
replacement in `payloadJson`. If a focused edit fails, inspect the current body
and change the target rather than retrying the same arguments.

### Display truncation is cosmetic — do not chase the "missing" tail

A tool result ending in `...[truncated — full result was N chars; only first
50,000 shown]` (from the `resources` read tool or `get-extension`) means only the
DISPLAYED text was capped. The file is intact. `run-code`'s `workspaceRead`
returns the full N chars, and `contentFromWorkspaceFile` hosts the full file.
Never read the same file twice or try to "page the rest" to recover the tail —
that is the single biggest source of wasted turns on clone requests. Decide to
clone, then go straight to the `run-code` read+transform+write path in step 5.
