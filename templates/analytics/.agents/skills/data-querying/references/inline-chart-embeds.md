# Inline Chart Embeds (the live `/chart` embed)

For an in-chat answer, emit a fenced ` ```embed ` block whose `src` points at
the app's own `/chart` route with a base64url-encoded panel in the `panel`
query param. The chat renderer mounts that route in a sandboxed same-origin
iframe, which renders a live `SqlChart` that re-queries when its source
changes. This is a different mechanism from `generate-chart` (a static
PNG/SVG render) — see "How This Differs From `generate-chart`" below.

## The Two Layers

1. **The chat markdown embed fence** — this lives in core, not in the
   template. Analytics chat renders through `AgentChatSurface` →
   `MarkdownText` (`packages/core/src/client/chat/markdown-renderer.tsx`),
   whose `markdownComponents.pre` handler intercepts any code block tagged
   `language-embed` and renders `IframeEmbed`
   (`packages/core/src/client/IframeEmbed.tsx`) instead of a `<pre>`.
   `parseEmbedBody` there reads `key: value` lines:
   - `src` (required) — the iframe URL.
   - `title` (optional) — shown in the embed's "Preview" header bar and used
     as the iframe `title`. Defaults to "Embedded content".
   - `aspect` (optional) — one of `16/9`, `4/3`, `1/1`, `21/9`, `3/2`, `2/1`;
     anything else falls back to `16/9`. Ignored when `height` is set.
   - `height` (optional) — pixels; overrides `aspect`.

   `isSameOriginSrc` only allows same-origin URLs: a path starting with `/`
   (but not `//`), `./`, or `../`, or an absolute URL whose origin matches the
   app's. Anything cross-origin renders an "Embed blocked" notice instead of
   an iframe. The iframe itself is sandboxed
   (`allow-scripts allow-same-origin allow-forms allow-popups`),
   `referrerPolicy="same-origin"`, and lazy-loaded. An embedded page can call
   `postNavigate()` from `@agent-native/core/client/embed` to pop the user out
   into the parent window at the same path.

   The template also ships its own `embed`-fence implementation in
   `templates/analytics/app/components/Markdown.tsx`, but that one renders
   **saved analysis bodies** (`app/pages/analyses/AnalysisDetail.tsx`), not
   chat. It is stricter: relative `src` only (no absolute same-origin URL) and
   `height` clamped to 2000. Keep embeds relative and they work in both.

2. **The `/chart` route** — `templates/analytics/app/routes/chart.tsx`. It
   reads the `panel` search param and decodes it with `decodePanel`
   (`chart.tsx:31-73`), then renders `<SqlChart panel={result} />`
   (`chart.tsx:115`), the same live chart component dashboards use
   (`templates/analytics/app/components/dashboard/SqlChart.tsx:1111`).

So the full pattern the agent must emit is:

```embed
src: /chart?panel=<base64url-encoded-panel-json>
title: Daily pageviews
height: 320
```

## The Panel JSON Shape (validated by `decodePanel`, `chart.tsx:31-73`)

| Field       | Required | Type / allowed values                                                                     | Notes                                                                                                                                                                                                             |
| ----------- | -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`       | yes      | non-empty string                                                                          | The query to run.                                                                                                                                                                                                 |
| `source`    | yes      | `"bigquery"` \| `"ga4"` \| `"amplitude"` \| `"first-party"` \| `"demo"` \| `"prometheus"` | `chart.tsx:22-29`. This is every `DataSourceType` (`app/pages/adhoc/sql-dashboard/types.ts:1-8`) **except `"program"`** — data-program-backed sources cannot be embedded this way.                                |
| `chartType` | yes      | `"line"` \| `"area"` \| `"bar"` \| `"metric"` \| `"table"` \| `"pie"`                     | `chart.tsx:12-19`. This is every `ChartType` (`types.ts:10-20`) **except `"section"`, `"heatmap"`, `"callout"`, `"extension"`** — those are dashboard-layout-only types and are not valid for a standalone embed. |
| `id`        | no       | string                                                                                    | Defaults to `"embed"`.                                                                                                                                                                                            |
| `title`     | no       | string                                                                                    | Defaults to `""`. Shown above the chart in `ChartRoute` (`chart.tsx:109-113`) — separate from the outer `embed` fence's own `title:` line, which only sets the iframe's `title` attribute.                        |
| `width`     | no       | number ≥ 1, floored                                                                       | Defaults to `1`. Legacy dashboard row-layout field; has no effect on the standalone `/chart` page.                                                                                                                |
| `config`    | no       | `SqlPanelConfig` object (`types.ts`)                                                      | Passed through as-is — `decodePanel` only checks `typeof === "object"`, it does not validate individual keys.                                                                                                     |

Any other `source`/`chartType` value, or a missing/blank `sql`, makes
`decodePanel` return an error and the route renders `ChartError`
(`chart.tsx:75-92`) instead of a chart.

### Useful `config` keys (from `SqlPanelConfig`, `types.ts`)

- `xKey`, `yKey` / `yKeys` — column names for the x-axis and series. If
  omitted, `SqlChart`'s `detectKeys` (`SqlChart.tsx:1013-1060`) auto-picks a
  date/string-like column for `xKey` and all remaining numeric columns for
  `yKeys`, so these are usually only needed to override the guess. Prefer
  writing SQL that already returns unambiguous column names over relying on
  auto-detection.
- `colors` / `color` — series colors.
- `yFormatter` — `"number"` | `"currency"` | `"percent"`.
- `columns` — `table` chartType only: `{ key, label?, format?, linkKey?, hidden? }[]`.
- `stacked`, `legend`, `pivot`, `limit`, `valueLabels`, `description` — see
  `SqlPanelConfig` in `types.ts` for the full list.

## Encoding The `panel` Param

`decodePanel` un-does a URL-safe, unpadded base64 encoding
(`chart.tsx:33-35`): it replaces `-` back to `+` and `_` back to `/`, then
pads with `=` before `atob`-decoding and `JSON.parse`-ing. To encode, do the
reverse — base64-encode the JSON, then replace `+` with `-`, `/` with `_`,
and strip any trailing `=` padding.

Worked example (verified round-trip):

Panel JSON:

```json
{
  "title": "Daily pageviews",
  "sql": "SELECT date_trunc('day', timestamp) AS day, COUNT(*) AS pageviews FROM analytics_events WHERE event_name = 'pageview' GROUP BY 1 ORDER BY 1",
  "source": "first-party",
  "chartType": "line"
}
```

Resulting embed:

```embed
src: /chart?panel=eyJ0aXRsZSI6IkRhaWx5IHBhZ2V2aWV3cyIsInNxbCI6IlNFTEVDVCBkYXRlX3RydW5jKCdkYXknLCB0aW1lc3RhbXApIEFTIGRheSwgQ09VTlQoKikgQVMgcGFnZXZpZXdzIEZST00gYW5hbHl0aWNzX2V2ZW50cyBXSEVSRSBldmVudF9uYW1lID0gJ3BhZ2V2aWV3JyBHUk9VUCBCWSAxIE9SREVSIEJZIDEiLCJzb3VyY2UiOiJmaXJzdC1wYXJ0eSIsImNoYXJ0VHlwZSI6ImxpbmUifQ
title: Daily pageviews
height: 320
```

Since it's a plain query-string param, keep the SQL reasonably short — it
rides in a URL that also has to survive markdown fencing and the iframe's
`src` attribute. It does not need extra URL-encoding beyond the base64url
step above (base64url output contains only `A-Za-z0-9-_`, which is
URL-safe).

## How This Differs From `generate-chart`

`generate-chart` (`templates/analytics/actions/generate-chart.ts`) renders a
**static** PNG (or SVG fallback) file to the media directory:

- Params are separate top-level fields (`title`, `labels`, `data`, `type`,
  `subtitle`, `width`, `height`, `theme`, `color`), where `labels` and `data`
  are **pre-stringified JSON arrays** the caller must have already computed —
  there is no `sql`/`source` and no live query.
- Only three chart types: `bar`, `line`, `area` (no `pie`, `metric`, `table`).
- The output is a saved image file, not a live component — it never
  re-queries if the underlying data changes.
- It exists for `save-analysis` artifacts and other places that need a
  persisted image (exports, archived reports), not for in-chat answers.

The `/chart` embed instead re-runs `sql` against `source` live through
`SqlChart`/`useSqlQuery`, so it always reflects current data and supports the
full `pie`/`metric`/`table` chart types dashboards use. Prefer it for every
in-chat data answer; reach for `generate-chart` only when building a
save-analysis artifact that needs a static image.
