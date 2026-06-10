---
"@agent-native/core": minor
---

Extract hand-copied template shell into `@agent-native/core` as shared exports.

New exports:

- `@agent-native/core/server/entry-server` — exports `handleDocumentRequest` (default) and `streamTimeout`. Superset of all 6 entry.server.tsx variants in the template fleet. Removes dead `typeof wrapWithAnalytics === "function"` guards (it is a plain import, never conditionally undefined). Adds `.well-known/` 404 rejection (content template improvement, now the default for all).
- `@agent-native/core/client` — exports `AppProviders`, a composed `QueryClientProvider → ThemeProvider → TooltipProvider → Toaster` shell. Accepts `queryClient` prop so each template keeps its own `createAgentNativeQueryClient(overrides)` call. Supports the public-path SSR branch pattern (calendar/clips/content) via `isPublicPath` + `clientOnlyFallback` props.

`templates/starter` and `packages/core/src/templates/default` (scaffold) are migrated to one-line re-exports of the shared handler. A sync spec (`starter-shell-sync.spec.ts`) guards byte-identity between scaffold and starter so they never drift again.
