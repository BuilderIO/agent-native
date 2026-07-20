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

## Imports

```tsx
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import { ChatHistoryList } from "@agent-native/toolkit/chat-history";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import { ContextMeterView } from "@agent-native/toolkit/context-ui";
import { VisualTweakControl } from "@agent-native/toolkit/design-tweaks";
import { SharedRichEditor } from "@agent-native/toolkit/editor";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import { Button } from "@agent-native/toolkit/ui/button";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { useToast } from "@agent-native/toolkit/hooks/use-toast";
import { useSetHeaderActions } from "@agent-native/toolkit/app-shell";
```

Import `@agent-native/toolkit/styles.css` after Tailwind to include Toolkit's
source scanning. If an app renders `SharedRichEditor`, also import
`@agent-native/toolkit/editor.css`. If an app renders `ChatHistoryList`, also
import `@agent-native/toolkit/chat-history.css`.

Inside template apps, prefer local adapters such as `@/components/ui/button` so
apps can replace their primitives without changing every callsite.

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
