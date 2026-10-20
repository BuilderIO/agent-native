# Factory design direction

| Decision             | Direction                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Product mode         | Operate                                                                                                              |
| Audience and cadence | People who run automations for a team: a daily glance at what needs them, occasional editing of a workflow           |
| Visual world         | Plain control room. The workflow graph and the list of what needs a person are the page; chrome stays out of the way |
| Palette family       | Ink and graphite neutrals from the shared shadcn tokens. Color appears only on states and on integration icon tiles  |
| Type treatment       | Inter Variable, compact, sentence case, tabular numerals for counts                                                  |
| Composition          | Four tabs over list views. An open workflow is a full-page canvas with a docked inspector                            |
| Shape language       | `--radius` 0.5rem, 1px ring borders, `shadow-sm` on cards only                                                       |
| Anti-references      | Sparkle or wand icons for agent work, stat strips, titles that repeat the tab, subtitles, hand-built popovers        |

## Tokens, type, controls

- `app/global.css` holds the neutral tokens (light and dark, `--radius`), one `--provider-*` hue per integration and `--accent-ai`, and sets the body in Inter Variable. Components use semantic classes only (`bg-background`, `bg-card`, `bg-muted`, `text-muted-foreground`, `ring-border`, `bg-primary`, `text-destructive`, and the `bg-provider-*/15` tile tints), never palette colors. A new token goes in `global.css`, not in a component.
- Controls import from `@/components/ui/*`, never from the toolkit directly. Icons are Tabler. No emoji, and no sparkle, wand or robot icon for agent work.
- Agent work hands off to the right-hand AgentSidebar (`sendToAgentChat` with ids, `openSidebar: true`). There is no second prompt box.

## Color marks identity or state

- Color marks an integration's identity on its icon tile, and a state's meaning on chips and rings. It never colors a whole card.
- Quiet is the default: a finished run or passing step is `bg-muted text-muted-foreground`; running and waiting are `bg-muted text-foreground` with their icon.
- Only what needs a person is colored: failed is `bg-destructive/10 text-destructive`; a write whose outcome is unknown (`needs_check`) is `text-destructive ring-1 ring-inset ring-destructive/40`. A passing step shows just a mark; anything that needs a look says so in words. See `app/components/workflow/RunStatusChip.tsx` and `StatusChip` in `workflow-canvas/WorkflowNodeCard.tsx`.
- Connection and scheduler status in Settings use the toolkit's `ProviderReadinessBadge` through `ReadinessChip`.

## Canvas (`app/components/workflow-canvas/**`)

- **Node identity** is a 32px icon tile in the card's 56px header (name, then a one-line summary from `node-summary.ts`). The card keeps `ring-border`, or `ring-primary` when selected or lit in a run replay. Core logic (trigger, filter, switch, combine, split, wait, end) shows its kind icon from `node-kinds.ts` on a neutral `bg-muted` tile.
- **Integration tiles** (source, lookup, action) show the brand icon, or the letter when Tabler has none, on a 15% tint of the integration's hue. `providerIdentity` in `provider-identity.tsx` holds each provider's label, hue and icon. The hue appears only on that tile. AI and agent steps show their kind icon on the shared `--accent-ai` tint.
- **Ports** sit on the right edge. A node with one output draws one handle; a node with several lists a labeled row per port (`portLabel` in `flow-model.ts`: Match and Otherwise, Switch routes, a Wait's replied and timed out). An unconnected port is a hollow dot; a port with a problem has a destructive border.
- **Edges** are `muted-foreground` 1.5px. Selected is `foreground`, lit in a replay is `primary`, dimmed is `border`, a problem is `destructive`. A single-output edge carries its item count. A back-edge is dashed (`stroke-dasharray: 6 4` in `workflow-canvas.css`), drawn as a U-detour under every node it passes (`app/lib/workflow-editor/edge-path.ts`), and badged with its cap. A Wait's `parked` figure is a step count, not an edge.
- **Layout** comes from dagre (`app/lib/workflow-editor/layout.ts`). The canvas fills its parent; the inspector docks in a flex row, or becomes a sheet when narrow. `workflow-canvas.css` points React Flow's variables at the tokens, so light and dark follow the app.

## Density

- No page title that repeats the tab, no subtitle, no eyebrow, no count strip over visible content. A card, panel, tab, settings group or row gets a title or a description, never both; explanation goes in a tooltip. `templates/forms` is the reference, and `guard:no-default-chrome` checks added lines.
- Settings (`app/components/factory/SettingsView.tsx`) is groups of label-and-control rows. Connections lists only the providers this factory's workflows use. It links to Settings with `buildSettingsRoute` and does not copy the Integrations, Agent or Model pages.

## Feedback and motion

- Acknowledge an action in 100 ms and show a pending state by 400 ms. Update optimistically and roll back on failure. Load with layout-matching `Skeleton`; reserve spinners for brief mutations.
- Motion is opacity or transform, short, and wrapped in `motion-safe:` or a `prefers-reduced-motion` rule.
- Keyboard, visible focus and accessible names on every control; check a phone-width viewport. The canvas keeps stable dimensions when narrow.

## Shared and app-owned

- **Shared** (toolkit and core): the app shell and rail, the account menu and Settings pages, the AgentSidebar and composer, `SettingsGroup` and `SettingsRow`, `ProviderReadinessBadge`, the audit log. Configure these or link to them; do not copy them.
- **Factory-owned**: node kinds and the canvas, the run and step status chips, the Workflows, Items and Activity views, and the Settings rows for factory configuration.
