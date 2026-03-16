---
name: charts
description: >
  Generate inline chart images (PNG) for embedding in chat responses.
  Use this skill when you need to create bar, line, or area charts for data visualization in chat.
---

# Chart Generation

## How It Works

Charts are generated server-side as PNG images using `chartjs-node-canvas` (Chart.js) and served via `/api/media/`. The `generate-chart` script renders charts and returns a fully qualified URL for embedding in chat markdown.

## Script Usage

```bash
pnpm script generate-chart --type=bar --title="Title" --labels='["A","B","C"]' --data='[1,2,3]' --color="#18B4F4"
```

### Parameters

| Param                  | Values                                                                     | Default                |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------- |
| `--type`               | `bar`, `line`, `area`                                                      | `bar`                  |
| `--title`              | Chart title (keep SHORT)                                                   | required               |
| `--subtitle`           | Optional subtitle — avoid unless needed                                    | —                      |
| `--labels`             | JSON array of x-axis labels                                                | required               |
| `--data`               | JSON array of numbers, OR array of `{label, data, color}` for multi-series | required               |
| `--color`              | Primary hex color                                                          | `#18B4F4`              |
| `--theme`              | `dark`, `light`                                                            | auto from `/api/theme` |
| `--stacked`            | `true` for stacked bars                                                    | `false`                |
| `--filename`           | Output filename (no ext)                                                   | auto from title        |
| `--width` / `--height` | Image dimensions                                                           | 800x400                |

### Output

`{ filename, url, width, height }` — the `url` is fully qualified with cache buster.

## Color Palette

| Color        | Hex       | Use                                |
| ------------ | --------- | ---------------------------------- |
| Blue         | `#18B4F4` | **Default/primary for all charts** |
| Purple       | `#8b5cf6` | Secondary                          |
| Green        | `#22c55e` | Tertiary                           |
| Amber        | `#f59e0b` |                                    |
| Indigo       | `#6366f1` |                                    |
| Red          | `#ef4444` |                                    |
| Teal         | `#14b8a6` |                                    |
| Orange       | `#f97316` |                                    |

## Style Preferences (from Steve)

- **Minimal text on chart** — short title only, no subtitle
- **Stats and context in chat text** around the chart, not on the image
- Large fonts: title 22px, axis 13px
- Few axis labels: maxTicksLimit 8 on x-axis, 5 on y-axis
- No rotated labels (maxRotation: 0)

### Good pattern:

```markdown
**Acme Corp Product Usage — Last 30 Days**
![chart](https://...your-app.example.com/api/media/chart.png?v=123)
**528 messages** over 18 active days | Peak: **89** (Feb 14)
```

## QuickChart Inline Styling (for non-script charts)

When using QuickChart (`https://quickchart.io/chart/create`) with Chart.js v2:

- Background: `#09090b` (zinc-950)
- Grid: horizontal only, dashed `[3,3]`, color `#27272a`
- Axis ticks: `#52525b`, 11px
- Title: `#fafafa`, 16px bold
- Legend: `#a1a1aa`, 11px
- Default bar/line color: `#18B4F4` (primary blue)
- Tooltips: bg `#09090b`, border `#27272a`, text `#fafafa`

## Multi-Series & Stacked Charts

- Use `--stacked=true` flag
- Pass data as `--data='[{"label":"User A","data":[...],"color":"#..."}]'`
- Script sets `stack: "stack1"` on all datasets

## Key Gotchas

- **Relative paths do NOT work** — chat UI is on a different origin. Always use the fully qualified URL from script output (uses `APP_ORIGIN`)
- Cache busting (`?v=<timestamp>`) auto-appended
- `chartjs-node-canvas` depends on `canvas` native module — `pnpm.onlyBuiltDependencies` must include `"canvas"`. If not built, run `pnpm rebuild canvas`
- Theme auto-detected from `media/theme.json` (set by sidebar toggle via `POST /api/theme`)
