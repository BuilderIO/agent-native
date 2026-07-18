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

The Toolkit docs catalog groups reusable app-building UI by capability even
when an implementation remains Core-owned. Domain packages such as Scheduling
and Creative Context remain separate packages with their own lifecycle
manifests and docs.

## Imports

```tsx
import { ToolkitProvider } from "@agent-native/toolkit/provider";
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
source scanning and editor styles.

Inside template apps, prefer local adapters such as `@/components/ui/button` so
apps can replace their primitives without changing every callsite.
