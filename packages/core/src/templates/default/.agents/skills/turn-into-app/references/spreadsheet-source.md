# Spreadsheet source review

Use this reference after a workbook upload or Google Sheets link is supplied to
`/turn-into-app`. It defines the bounded review contract before app creation.

## 1. Establish the source boundary

Record the source before interpreting it:

| Field        | Record                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| Source kind  | `xlsx`, `xls`, `csv`, or Google Sheets URL                                        |
| Provenance   | Original file name or spreadsheet ID and URL; never credentials or workbook bytes |
| Access       | Upload preview, authenticated provider read, or unavailable                       |
| Coverage     | Worksheet names, selected range(s), row/column bounds, and sample counts          |
| Completeness | Complete within the requested bound, partial, truncated, unreadable, or empty     |
| Refresh      | One-time snapshot or live refreshable source                                      |

For an uploaded XLS/XLSX file, the framework preview contains worksheet names,
dimensions, and representative displayed values within bounds. It does not
currently preserve cell fills or font colors in that text preview. Treat the
original workbook as the formatting authority only when a tool actually returns
cell formatting metadata. Never describe a text-only upload as style-verified.

For a Google Sheets URL:

1. Parse the spreadsheet ID and preserve the original URL as provenance.
2. Use the authenticated `google_drive` provider path. Inspect
   `provider-api-catalog` first, use `provider-api-docs` if the endpoint or
   fields are uncertain, and then call `provider-api-request`.
3. Read spreadsheet metadata and only bounded worksheet/range data. Request
   formatting metadata when the I/O decision depends on colors, including
   `userEnteredFormat.backgroundColor` and
   `userEnteredFormat.textFormat.foregroundColor` where the provider supports
   it. Do not use a public export URL to bypass access.
4. Preserve the spreadsheet ID, worksheet title, A1 range, account/connection
   choice without secrets, row limits, and refresh behavior in the brief.

Keep provider responses bounded. For large sheets, stage or save the response
and reduce it with the available dataset/code tools. A failed page, truncated
response, or unavailable connection is not an empty sheet.

## 2. Infer cells and ranges, then show the evidence

Classify source material into three separate buckets. Include representative
cell addresses or ranges and the evidence behind each classification.

| Bucket             | Default signal                                                                                                     | App treatment                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Inputs             | Yellow cell background, editable assumptions, user-entered constants, or labels such as `assumption` / `driver`    | Editable controls or bounded source parameters                         |
| Outputs            | Blue text, formula-derived result cells, summary blocks, or labels such as `forecast` / `recommendation`           | Read-only results, charts, recommendations, exports, or review actions |
| Static historicals | Black text used intentionally for prior-period/source records, raw rows, or labels such as `actual` / `historical` | Read-only context; never turn into editable inputs by default          |

These are conventions, not permission to guess. A default black font with no
explicit style metadata is not enough to label a range as historical. Resolve
conflicts using labels, formulas, neighboring headers, repeated patterns, and
the user's stated goal. If the evidence still conflicts, lower confidence and
ask the user to confirm the proposed mapping.

Keep source cells and app behavior distinct:

- `Source inputs` are the workbook cells or ranges the user is expected to
  change or refresh.
- `Source outputs` are the workbook cells or ranges the source already derives
  or presents.
- `Static historicals` are context the app may filter, compare, or summarize,
  but should not edit.
- `App outputs` are the new app's visible results, saved records, exports,
  alerts, or downstream handoffs. Do not invent these until the repeatable job
  or user confirmation makes them clear.

## 3. Offer candidate apps, not a tab dump

Group related worksheets into candidate repeatable jobs. A candidate should
have a recognizable user, trigger, inputs, transformation or judgment, and
outputs. Utility tabs such as lookups, raw imports, instructions, pivots, and
calculation helpers can support a candidate without becoming destinations.

Present a compact Q&A review with multi-select options. In generated app code,
use `askUserQuestion` from `@agent-native/core/client/agent-chat` with
`allowMultiple: true`, stable candidate IDs as option values, and
`allowFreeText: true` for corrections. It renders inline in the agent panel;
do not build a custom modal. Each option should fit in a scannable row or
choice card:

```text
Candidate: Pipeline forecast
Uses: Assumptions, Historical Pipeline, Forecast
Inputs: yellow assumptions in Assumptions!B4:B12 (high confidence)
Outputs: blue forecast summary in Forecast!B3:H10 (medium confidence)
Historical context: Historical Pipeline!A1:K500
Question: Confirm that forecast assumptions should be editable?
```

Mark the strongest recommendation with `recommended: true`, but do not silently
select it. Let the user select none, one, or several candidates, correct a
proposed tab/range, or answer the unresolved question. Keep each question to
2-4 grouped candidate jobs; for a larger workbook, group related tabs into
jobs rather than showing a tab dump or asking a separate question for every
worksheet. If there is only one high-confidence candidate, keep the review
compact and ask for confirmation only when the I/O mapping or source access is
unclear.

When several candidates are selected, pass a stable candidate ID, display name,
source worksheet/ranges, I/O mapping, confidence, and confirmation status for
each. The generated app should expose them as separate named left-navigation
destinations or tabs, not merge them into an opaque dashboard and not create a
separate workspace app for every worksheet.

## 4. Confirm before building or publishing

The confirmation view is a source-integrity checkpoint, not a product-design
questionnaire. Show:

- the source file or spreadsheet ID and snapshot/live choice;
- selected candidate destinations and their source tabs/ranges;
- editable inputs, read-only outputs, and static historical context;
- the evidence and confidence for each mapping;
- truncation, unreadable, missing-connection, and refresh limitations;
- the app outputs/actions that will be created.

Use clear actions such as `Confirm and build`, `Edit mapping`, and `Use a
different source`. If the host has a structured question or multi-select UI,
use it. Otherwise, ask one concise assistant message that presents the same
options and requires an explicit confirmation/correction before handoff.

After confirmation, the online host may call
`start-workspace-app-creation`; the Builder run itself remains autonomous and
must record any remaining non-blocking assumptions. In a local generated app,
persist the confirmation state in SQL/application state and keep the user on
the review surface while the agent builds. Never claim a full import, live
refresh, or output write until the corresponding source/action has succeeded.

## 5. Failure and recovery states

Keep these states distinct in the review and in the handoff:

- `unreadable` - parser/provider could not read the source;
- `partial` - only some worksheets, ranges, rows, or pages were read;
- `truncated` - the bounded preview ended before full coverage;
- `empty` - the requested readable range contains no values;
- `not-connected` - authenticated Google access is required but unavailable;
- `confirmed` - the user approved the candidate and I/O mapping.

For unreadable or not-connected sources, request a CSV/XLSX export or the
required connection. For partial or truncated sources, continue only with a
clearly bounded snapshot or ask for a narrower range. Do not coerce any of
these states into a successful empty source.
