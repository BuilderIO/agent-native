# @agent-native/toolkit

Reusable app-building UI and helpers for Agent-Native apps.

`@agent-native/core` owns the foundational runtime contracts: actions, server
plugins, DB, app state, agent chat transport, sharing stores, collaboration
transport, and other framework primitives. `@agent-native/toolkit` owns reusable
app-building surfaces: shadcn-style UI primitives, app-shell helpers, shared
hooks, sharing and collaboration display UI, portable rich editors, Context
X-Ray presentation, and visual design controls.

Existing `@agent-native/core` imports remain supported during the migration
window through compatibility re-exports. Those re-exports are temporary
migration support. Toolkit stays Core-free: controlled Toolkit views receive
data and callbacks from Core runtime adapters instead of importing runtime
state, actions, or server contracts.

The Toolkit docs catalog is one discovery shelf for reusable app-building
capabilities, even when an implementation remains Core-owned. Scheduling,
Creative Context, and Pinpoint are Toolkit capability modules installed on
demand. They remain separate npm packages with independent lifecycle manifests
and docs. Dispatch is a separate product rather than a Toolkit module.

## AgentKit

AgentKit is split at a deliberate seam. Toolkit owns presentation primitives:
composers, prompt menus, agent-authored next-action bars, queue drawers, and
design-system adapters. Core owns runtime-backed chat surfaces and registries:
streaming text, activity traces, approvals, tool and widget renderers, threads,
attachments, and application-state adapters. Both layers are reusable, and
Toolkit stays Core-free. The provider-neutral event contract lives in
[`@agent-native/agentkit/protocol`](../agentkit/README.md).

AgentKit is an independent implementation optimized for Agent-Native workflows.
The protocol README records the shared product goals and clean implementation
boundary; it is not a runtime dependency or compatibility layer for another
chat product.

## Composer context

`PromptComposer` and `TiptapComposer` accept controlled `contextItems` and
`onRemoveContextItem(key)`, `onInspectContextItem(key)`, and
`onRetryContextItem(key)` callbacks. Each `AgentChatContextItem` has
`{ key, title, context, status?, statusMessage? }`. Status is `ready`, `pending`,
or `error`; omitted status means ready. Pending and failed items stay visible
inside the composer frame and block both click and keyboard submission.

Opt into the shared Add context menu with `contextMenuItems`. Its recursive
`ComposerContextMenuItem` union accepts categories with `children` and actions
with `onSelect(): void | Promise<void>`. Both have `id`, `label`, optional
`keywords`, `icon`, and `disabled`. Use unique IDs across the tree. Root search
finds all descendant actions; search within a category stays in that subtree.
The menu adds native Attach files through the composer's attachment action when
attachments are enabled. Omitting `contextMenuItems` keeps the existing menu.
Apps own discovery, selection state, and action semantics.

For an in-place picker, an action can also provide
`render(controls: ComposerContextPageControls): ReactNode` and
`onDismiss(): void`. Selecting it calls `onSelect` synchronously and replaces
the menu content inside the same compact, composer-anchored popover. Each render
uses the latest action matching its ID, so asynchronous results stay current,
including actions reached through root search. The outer composer stays mounted.

The page controls are `onBack()` (dismiss the picker and return to the originating
category), `onClose()` (dismiss and reset the menu), and `onResume()` (reopen the
captured page/category after a separate creation dialog). Resume does **not**
call `onSelect` or `onDismiss`; restore the host's picker view before invoking a
saved resume callback. Escape and outside dismissal call `onDismiss` too. Hosts
can preserve a creation/inspection view conditionally in that callback. Action
errors, including rejected promises, remain visible and reach `onAttachmentError`.

Use `ComposerContextSearchInput` inside a page's `Command`. It accepts the
standard `CommandInput` props except `leading`, plus optional `onBack`. Back is
a localized ghost icon in the search field's leading slot, with native button
keyboard behavior. `CommandInput` itself accepts an optional `leading: ReactNode`
slot and keeps its existing search icon by default. These page controls and the
search helper are exported from both `/composer` and the narrow `/agentkit`
Toolkit entry point.

`PromptComposer.onSubmit(text, files, references, options)` receives the
immutable selection in `options.contextItems`. Tiptap uses the same options
field in its submit callback. Both capture the snapshot before asynchronous
submission work and leave the submitted text unchanged. The host must consume
the snapshot when constructing its request. Controlled context is not cleared
automatically after submission.

Core's `AgentSidebar` and `AgentChatSurface` expose the same hooks with the
`composerContextItems` / `composerContextMenuItems` names and
`onBeforeComposerSubmit(snapshot)`. For thread-local selections, observe
`onActiveThreadChange(threadId)` and bind the resolved selection using
`composerContextThreadId`. Context bound to a different thread is withheld and
submission waits for the host to catch up. Omit the binding only when context
is deliberately shared across the project's threads. Provider setup and model
loading gate submission, not local drafting or context selection.

Import these components and types, `ComposerContextSnapshot`,
`areComposerContextItemsReady`, and `snapshotComposerContextItems` from
`@agent-native/toolkit/composer`. Snapshotting rejects unready items; check
readiness before starting a programmatic submission. Array input returns a
definite snapshot; undefined input stays undefined.

## Imports

```tsx
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import {
  ChatHistoryList,
  ChatHistoryRail,
} from "@agent-native/toolkit/chat-history";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import { ContextMeterView } from "@agent-native/toolkit/context-ui";
import {
  DataTable,
  DateRangePicker,
  GenericChartPanel,
  MetricCard,
  StatsCard,
  buildDashboardPanelGroups,
} from "@agent-native/toolkit/dashboard";
import { DataGrid } from "@agent-native/toolkit/data-grid";
import {
  CanvasCommentPins,
  DrawOverlay,
} from "@agent-native/toolkit/canvas-annotations";
import {
  createCanvasGestureController,
  createCanvasInteractionCore,
} from "@agent-native/toolkit/canvas-interactions";
import { VisualTweakControl } from "@agent-native/toolkit/design-tweaks";
import { SharedRichEditor } from "@agent-native/toolkit/editor";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import { Button } from "@agent-native/toolkit/ui/button";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { useToast } from "@agent-native/toolkit/hooks/use-toast";
import {
  SidebarFooterActions,
  usePersistentSidebarCollapsed,
  useSetHeaderActions,
} from "@agent-native/toolkit/app-shell";
```

Import `@agent-native/toolkit/styles.css` after Tailwind to include Toolkit's
source scanning. If an app renders `SharedRichEditor`, also import
`@agent-native/toolkit/editor.css`. If an app renders `ChatHistoryList` or
`ChatHistoryRail`, also import `@agent-native/toolkit/chat-history.css`.

`DrawOverlay` backs the Design and Slides drawing tools. `CanvasCommentPins`
provides lightweight, transient pins that send canvas context to an agent.
Translation, agent-chat routing, document context, and storage-backed review
threads stay with the app.

`createCanvasGestureController` provides a headless move and resize state
machine with zoom conversion, modifier policies, previews, cancellation, and a
single commit boundary. Apps provide adapters for selection, rendering, and
persistence. `createCanvasInteractionCore` exposes the same shared geometry,
text-activation, Escape, nudge, and shortcut policies without owning state.

Use `ChatHistoryRail` for app sidebars. It shows five recent chats by default,
progressively discloses up to fifteen, and keeps the app-provided New chat
action in a footer row with the ellipsis disclosure on its right. The app
continues to own thread persistence, sorting, routing, and mutations through
Core.

Use `SidebarFooterActions` for the shared left-sidebar utility row. Provide the
app-owned controls through its slots; the rendered order is feedback, search,
then collapse, with the same order stacked in collapsed sidebars.

Use `usePersistentSidebarCollapsed` for a collapsible desktop navigation
sidebar that should remember a person's choice after refresh. Each app supplies
its own stable storage key and first-use default. The hook restores valid
browser state immediately after hydration, keeps explicit changes responsive
when storage is unavailable, and exposes `persistenceStatus` so unavailable or
malformed storage is distinguishable from a saved preference. Keep temporary
mobile drawer state separate.

Inside template apps, prefer local adapters such as `@/components/ui/button` so
apps can replace their primitives without changing every callsite.

For a radio choice card, compose `FieldLabel` around `Field`, with a
`RadioGroupItem`, `FieldContent`, `FieldTitle`, and optional `FieldDescription`.
The `/ui/field` entry point follows shadcn's Field pattern: the entire label is
clickable and the checked radio controls the card's selected treatment. Group
cards with `FieldSet` and `FieldLegend`. Place a `Badge` alongside the radio when
the app supplies an actual tier or license restriction; the primitive does not
infer entitlements. Keep restricted options disabled and associate their reason
with `aria-describedby`.

## Dashboard kit

`@agent-native/toolkit/dashboard` is an ejectable, presentation-only dashboard
kit. It includes metric and stats cards, tables, a date-range picker, panel
ordering and layout helpers, and `GenericChartPanel`. Supply rows, schema, and
callbacks through app-owned action-backed adapters; the kit never fetches data,
stores dashboard state, resolves credentials, or imports Core runtime APIs.

Inspect or take ownership of the complete unit with:

```bash
agent-native eject inspect toolkit/dashboard
agent-native eject toolkit/dashboard --app <app> --apply
```

For durable dashboards, use `@agent-native/core/dashboard-storage` in the app's
server layer. Instantiate its schema and access-scoped store per app, rather
than sharing dashboard rows between apps. Resolve panel data with a
`PanelSourceResolver`; the built-in `program` resolver runs an app-owned data
program and is the zero-wiring default. Provider-specific resolvers stay in the
app that owns their credentials and query policy.

## Data grid kit

`@agent-native/toolkit/data-grid` provides the spreadsheet-like interaction
layer without owning a data model. Supply rows, typed columns, editor slots,
selection state, and commit callbacks from the app. Keyboard navigation,
selection, column resizing, and the scroll surface are shared; `renderHeader`,
`renderBody`, `renderRow`, and `renderFooter` let an app preserve product-
specific headers, grouping, and row actions while adopting the same grid
mechanics.

```tsx
<DataGrid
  rows={rows}
  columns={columns}
  getRowId={(row) => row.id}
  onCellCommit={({ row, column, value }) =>
    updateCell(row.id, column.id, value)
  }
/>
```

The kit never fetches data, calls actions, resolves credentials, or persists
edits. Eject it with `agent-native eject toolkit/data-grid --app <app>` when a
product needs a deeper local visual or interaction change.

## Customize Or Take Ownership

Use public props, slots, callbacks, stable classes, and local adapters first.
If a product needs a deeper override, the published package includes readable
TypeScript under `node_modules/@agent-native/toolkit/src/`. Treat it as a
read-only reference: copy the smallest component or helper into app-owned
source, change the app import, and customize that copy. Do not edit
`node_modules` or deep-import private `src` files at runtime.

Keep Core runtime contracts intact when taking ownership of Toolkit UI. Actions,
application state, auth/access, persistence, agent execution, chat transport,
and page-to-sidebar thread handoff remain on their public Core APIs. Copied UI
is an app-owned snapshot and will not receive upstream fixes automatically.
