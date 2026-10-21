# Factory design direction

| Decision             | Direction                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product mode         | Operate                                                                                                                                                       |
| Audience and cadence | People who run automations for a team: a daily glance at what needs them, occasional editing of a workflow                                                    |
| Visual world         | Plain control room. The workflow graph and the list of what needs a person are the page; chrome stays out of the way                                          |
| Palette family       | Ink and graphite neutrals from the shared shadcn tokens. Color appears on states, integration icon tiles, the AI accent, and the icons of data and flow kinds |
| Type treatment       | Inter Variable, compact, sentence case, tabular numerals for counts                                                                                           |
| Composition          | Four tabs over list views. An open workflow is a full-page canvas, and a step opens in a modal                                                                |
| Shape language       | `--radius` 0.5rem, 1px ring borders, `shadow-sm` on cards only                                                                                                |
| Anti-references      | Sparkle or wand icons for agent work, stat strips and subtitles outside the approved exceptions, titles that repeat the tab, hand-built popovers              |

## Tokens, type, controls

- `app/global.css` holds the neutral tokens (light and dark, `--radius`), one `--provider-*` hue per integration and `--accent-ai`, and sets the body in Inter Variable. Components use semantic classes only (`bg-background`, `bg-card`, `bg-muted`, `text-muted-foreground`, `ring-border`, `bg-primary`, `text-destructive`, and the `bg-provider-*/15` tile tints), never palette colors. `--success` marks passing steps and flowed edges, `--kind-data` and `--kind-flow` tint the icons of data and flow kinds, and `--scrim` is the modal backdrop, dark in both themes and set to 50% opacity where it is used. A new token goes in `global.css`, not in a component.
- Controls import from `@/components/ui/*`, never from the toolkit directly. Icons are Tabler. No emoji, and no sparkle, wand or robot icon for agent work.
- Agent work hands off to the right-hand AgentSidebar (`sendToAgentChat` with ids, `openSidebar: true`). There is no second prompt box.

## Color marks identity or state

- Color marks an integration's identity on its icon tile, and a state's meaning on chips and rings. It never colors a whole card.
- Quiet is the default: a skipped or unrun step shows no mark. A passing step gets a 2px `success` border and a check.
- Only what needs a person is colored: `failed` and `needs_check` (a write whose outcome is unknown) both get a 2px `destructive` border and a destructive mark, a circle for failed and a triangle for needs-check. A canvas mark has no words, so its tooltip says what happened. See `app/components/workflow/RunStatusChip.tsx` and `StatusMark` in `workflow-canvas/WorkflowNodeCard.tsx`.
- Connection and scheduler status in Settings use the toolkit's `ProviderReadinessBadge` through `ReadinessChip`.

## Canvas (`app/components/workflow-canvas/**`)

- **Node identity** is a square tile 96px wide with 16px corners and a 1.5px `border` ring (`node-metrics.ts`). It holds the icon: 48px for an integration, 40px for a kind. The name sits 8px under the tile in 14px medium, at most two lines. A one-line 12px summary from `node-summary.ts` sits 4px under that. Both ignore the pointer, so clicks on them reach the canvas. A trigger has a rounder left side, with its bolt just outside it. The name is `node.label` when set, else the operation's label or the kind's (`nodeTitle`). A number at the end of the identifier is kept, so `filter2` reads "Filter 2". The identifier never shows on the canvas. A summary that repeats the name, as every operation step's does, is left out.
- **Tile color.** An integration (source, lookup, action) takes the 15% tint of its hue from `providerTile` in `provider-identity.tsx`, with its brand icon on it. A provider with no Tabler icon shows its letter at 48px. AI and agent steps take the `--accent-ai` tint. The other kinds keep the card fill and tint only the icon: `--kind-data` for filter, split and combine, `--kind-flow` for switch, wait and end (`kindTile` in `node-kinds.ts`).
- **Status and selection.** One 20px mark sits 6px in from the bottom-right corner; the first match wins: failed or needs-check, then a problem, then an unconnected provider, then success. While a run is going, the step it started last gets a 2px ring 3px outside the tile that turns every 1.5s. The ring stays on that step after it finishes, until the next step starts, and goes when the run ends. A Wait with parked items gets a muted ring that turns every 4.5s and an "N waiting" badge under its label, whether or not a run is shown. Both rings stop turning under reduced motion. A selected tile has a 6px translucent ring. A step on the path of the item being viewed keeps a 2px primary ring. A shown run's mode (Dry run, Test or Live) sits in a pill at the canvas's top-left.
- **Size and gaps.** A tile is 96px tall while its busier side has at most two handles, and each handle past two adds 32px. Layout leaves 128px between columns and 96px between rows (`RANK_GAP` and `ROW_GAP` in `layout.ts`), which clears the name under the tile above.
- **Ports** sit on the right edge; an input sits centered on the left. Output _i_ of _n_ is at (i+1)/(n+1) of the tile height. Each handle is a 16px dot with a 1px `muted-foreground` border and card fill, inside a 24px hit area. On hover it grows to 1.5x over 0.2s. The dot is only for dragging a connection. On a step with several outputs, each port shows its label just outside the edge (`portLabel` in `flow-model.ts`), with the run count after it. An unconnected output shows a plus: a 2px line, 46px long, or 80px when the step has a label or items went through the output; the line is then `success`. The line ends in a 24px "Add step" button that calls `onAddAfter`. A port with a problem has a destructive label.
- **Edges** are 2px cubic curves with square caps, leaving the source sideways and entering the target from the left. A 40px transparent band makes them easy to point at. Default is `muted-foreground` at 55%, solid on hover; flowed in a run is green; selected is `foreground`; dimmed is `border`; a problem is `destructive` (`workflow-edges.css`). A connection's pill reads "N items", or "N items total" when the source ran more than once, and shows only above zero. Hovering a connection shows Add step and Remove connection at its midpoint, and a loop offers only Remove, on its label. A back-edge keeps its 1.5px dashed route, a U-detour under every node it passes (`app/lib/workflow-editor/edge-path.ts`), labelled "Up to N passes".
- **Creator panel.** Adding a step opens a non-modal panel at the canvas's right edge (`creator/NodeCreator.tsx`), 385px wide. It slides in and closes after a pick, a described request or Escape. The start list, which is the root when the workflow has no trigger, has a one-line subtitle. The root lists are Triggers, Actions, AI, Data and Flow. Triggers and Actions open the apps, and most rows carry a one-line description. A search box shows on the root lists and on any list with more than eight rows. Describe it to the agent hands the request to the AgentSidebar, and an unconnected provider shows Connect.
- **Node details** open in a modal over the page (`app/components/workflow/node-details/`), inset 24px from the window edges and full screen under 768px, on a `bg-scrim/50` backdrop. Three columns: Input, Parameters (420px, with Parameters and History tabs) and Output. Input and Output show the items at that step as Schema, Table or JSON, and Output is split by port. The name field in the modal's header sets the step's label.
- **Layout** comes from dagre (`app/lib/workflow-editor/layout.ts`). The canvas fills its parent. `workflow-canvas.css` points React Flow's variables at the tokens, so light and dark follow the app.

## Workflows list (`app/components/workflow/WorkflowsView.tsx`)

- **Header and stat strip.** A page title and a one-line subtitle sit over a four-cell stat strip: On (with the total), Needs you, Waiting and Failing. Search, a status filter and a sort sit under it, and attention is the default sort. Each row opens its workflow, and its menu has Rename and Duplicate. This is the approved density exception.

## Density

- No page title that repeats the tab, no subtitle, no eyebrow, no count strip over visible content. A card, panel, tab, settings group or row gets a title or a description, never both; explanation goes in a tooltip. `templates/forms` is the reference, and `guard:no-default-chrome` checks added lines. Three exceptions are approved to match the reference UX: the creator's visible row descriptions, its one-line start subtitle, and the Workflows list's title, subtitle and stat strip. The guard does not flag them, so they need no pragma.
- Settings (`app/components/factory/SettingsView.tsx`) is groups of label-and-control rows. Connections lists only the providers this factory's workflows use. It links to Settings with `buildSettingsRoute` and does not copy the Integrations, Agent or Model pages.

## Feedback and motion

- Acknowledge an action in 100 ms and show a pending state by 400 ms. Update optimistically and roll back on failure. Load with layout-matching `Skeleton`; reserve spinners for brief mutations.
- Motion is opacity or transform, short, and wrapped in `motion-safe:` or a `prefers-reduced-motion` rule.
- Keyboard, visible focus and accessible names on every control; check a phone-width viewport. The canvas keeps stable dimensions when narrow.

## Shared and app-owned

- **Shared** (toolkit and core): the app shell and rail, the account menu and Settings pages, the AgentSidebar and composer, `SettingsGroup` and `SettingsRow`, `ProviderReadinessBadge`, the audit log. Configure these or link to them; do not copy them.
- **Factory-owned**: node kinds and the canvas, the run and step status chips, the Workflows, Items and Activity views, and the Settings rows for factory configuration.
