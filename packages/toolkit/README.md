# @agent-native/toolkit

Reusable app-building UI and helpers for Agent-Native apps.

`@agent-native/core` owns the foundational runtime contracts: actions, server
plugins, DB, app state, agent chat transport, sharing stores, collaboration
transport, and other framework primitives. `@agent-native/toolkit` owns reusable
app-building surfaces: shadcn-style UI primitives, app-shell helpers, shared
hooks, sharing display UI, and collaboration display UI.

Existing `@agent-native/core` imports remain supported during the migration
window through compatibility re-exports. Those re-exports are temporary
migration support; the long-term dependency direction is Toolkit composing core
runtime APIs where needed, not core permanently depending on Toolkit for app UI.

Extract future behaviorful kits one at a time before broadening the split.
Sharing is the first candidate because it validates runtime composition, access
checks, action-backed data, and share-link UI together.

## Imports

```tsx
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import { Button } from "@agent-native/toolkit/ui/button";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { useToast } from "@agent-native/toolkit/hooks/use-toast";
import { useSetHeaderActions } from "@agent-native/toolkit/app-shell";
```

Inside template apps, prefer local adapters such as `@/components/ui/button` so
apps can replace their primitives without changing every callsite.
