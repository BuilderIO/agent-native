# @agent-native/toolkit

Reusable app-building UI and helpers for Agent-Native apps.

`@agent-native/core` owns the foundational runtime contracts: actions, server
plugins, DB, app state, agent chat transport, sharing stores, and other
framework primitives. `@agent-native/toolkit` owns optional reusable surfaces
used to compose apps: shadcn-style UI primitives, shared hooks, shell helpers,
and other app-building modules.

Existing `@agent-native/core` imports remain supported during the migration
window through compatibility re-exports.

## Imports

```tsx
import { Button } from "@agent-native/toolkit/ui/button";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { useToast } from "@agent-native/toolkit/hooks/use-toast";
import { useSetHeaderActions } from "@agent-native/toolkit/app-shell";
```
