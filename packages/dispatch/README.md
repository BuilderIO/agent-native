# @agent-native/dispatch

Workspace control plane for agent-native apps — vault, integrations,
destinations, cross-app workspace resources, recurring "dream" report jobs,
and cross-app delegation, shipped as a single drop-in package.

Powers the `dispatch` template. Provides:

- **Drizzle schemas** — destinations, identity links, link tokens, approval
  requests, audit events, dream reports/proposals, vault secrets/grants/
  requests/audit, workspace resources/grants
- **Server layer** — `setupDispatch(config)` plus Nitro plugins for auth,
  integrations, agent chat, DB, and core routes
- **Actions** — ~90 `defineAction` modules (vault grants/requests, workspace
  resource grants, destinations, dream jobs, provider-api catalog/docs/
  request, connected-agent discovery, audit/approvals, platform messaging,
  and more) consumed as agent tools + HTTP endpoints
- **Routes** — a full React Router 7 `RouteConfig[]` (chat, overview, apps,
  vault, integrations, agents, workspace, messaging, destinations,
  identities, approvals, automations, audit, settings, dreams, extensions,
  ...) to splat into a consumer's `app/routes.ts`
- **React components** — `DispatchShell`, `Layout`/`NavContent`,
  `CreateAppPopover`/`CreateAppFlow`, `AppKeysPopover`, plus a full
  shadcn/ui-based `components/ui/*` primitive set
- **Styles** — `dispatch.css` Tailwind layer

## Install

```bash
pnpm add @agent-native/dispatch
```

Peer-depends on `@agent-native/core` (`>=0.8.0`), `react`/`react-dom`
(`>=19.2.7`), and `react-router` (`>=8`).

## Compose

Template's `app/routes.ts`:

```ts
import { type RouteConfig } from "@react-router/dev/routes";
import { dispatchRoutes } from "@agent-native/dispatch/routes";

export default [
  ...localRoutes, // consumer's own routes win on collision
  ...dispatchRoutes, // dispatch fills in everything else
] satisfies RouteConfig;
```

Template's `server/plugins/*.ts` (each export lives in its own file so Nitro
auto-loads it):

```ts
// server/plugins/setup-dispatch.ts
import { setupDispatch } from "@agent-native/dispatch/server";
export default setupDispatch({ auth: { googleOnly: true } });

// server/plugins/auth.ts
export { dispatchAuthPlugin as default } from "@agent-native/dispatch/server";

// server/plugins/integrations.ts
export { dispatchIntegrationsPlugin as default } from "@agent-native/dispatch/server";

// server/plugins/agent-chat.ts
export { dispatchAgentChatPlugin as default } from "@agent-native/dispatch/server";

// server/plugins/db.ts
export { dispatchDbPlugin as default } from "@agent-native/dispatch/server";

// server/plugins/core-routes.ts
export { dispatchCoreRoutesPlugin as default } from "@agent-native/dispatch/server";
```

Template's `server/db/schema.ts`:

```ts
export * from "@agent-native/dispatch/db";
```

`@agent-native/dispatch/actions` doesn't need a manual import for most
consumers: `import "@agent-native/dispatch/server"` (pulled in by the plugin
wiring above) side-effect-registers every Dispatch action via
`registerPackageActions`, and the framework's `autoDiscoverActions` merges
them in after the consumer's local `actions/` directory. Drop a same-named
file in the consumer's own `actions/` to override any single action.

## Exports

| Subpath                            | What it is                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                                | Shared config types only — `DispatchConfig`, `DispatchAuthConfig`, `DispatchIntegrationsConfig`. Import this where a type is needed without pulling in server/client code.                                                                                                                                                                                                               |
| `./routes`                         | `dispatchRoutes` — a programmatic `RouteConfig[]` covering every Dispatch page (chat, overview, metrics, operations, apps, vault, integrations, agents, workspace, messaging, destinations, identities, approvals, automations, audit, settings, dreams, extensions, thread-debug, team, and a workspace-app catch-all route).                                                           |
| `./routes/pages/*`                 | Individual compiled page modules the routes above point at (e.g. `./routes/pages/vault.js`). Not normally imported directly.                                                                                                                                                                                                                                                             |
| `./server`                         | `setupDispatch(config)` plus the Nitro plugin set: `dispatchAuthPlugin`, `dispatchIntegrationsPlugin`, `dispatchAgentChatPlugin`, `dispatchDbPlugin`, `dispatchCoreRoutesPlugin`. Importing this module also side-effect-registers all Dispatch actions.                                                                                                                                 |
| `./server/lib/thread-link-preview` | `loadThreadLinkPreview(threadId)` — server-only helper (reads request context and checks thread ownership) that builds link-preview metadata for shared thread URLs.                                                                                                                                                                                                                     |
| `./actions`                        | `dispatchActions` — the flat name → `ActionEntry` map of every Dispatch action (vault, workspace resources, destinations, dream jobs, provider-api catalog/docs/request, connected agents, audit, approvals, platform messaging, and more).                                                                                                                                              |
| `./db`                             | `getDb()` / `db()`, the Drizzle `schema` namespace, the Dispatch table exports (`dispatchDestinations`, `dispatchIdentityLinks`, `dispatchLinkTokens`, `dispatchApprovalRequests`, `dispatchAuditEvents`, `dispatchDreams`, `dispatchDreamProposals`, `vaultSecrets`, `vaultGrants`, `vaultRequests`, `vaultAuditLog`, `workspaceResources`, `workspaceResourceGrants`), and migrations. |
| `./lib/thread-link-preview`        | Isomorphic helpers behind the server one above — `extractThreadPreviewImageUrl`, `buildThreadLinkPreviewMeta`, and the `ThreadLinkPreview` type. Safe to import from client code.                                                                                                                                                                                                        |
| `./components`                     | Escape-hatch UI pieces for custom layouts: `DispatchShell`, `Layout`/`NavContent` (plus `DispatchExtensionConfig`/`DispatchNavIcon`/`DispatchNavItem`/`DispatchNavSection` types), `CreateAppPopover`/`CreateAppFlow`, `AppKeysPopover`. Most consumers only need `dispatchRoutes` and never import from here directly.                                                                  |
| `./components/ui/*`                | The shadcn/ui primitive set Dispatch's own UI is built on (`button`, `dialog`, `dropdown-menu`, `card`, `command`, `calendar`, `chart`, ...), exported per-file so a consumer can reuse one primitive without pulling in the rest.                                                                                                                                                       |
| `./styles/dispatch.css`            | Tailwind layer with Dispatch-specific styles. Import once in the consumer's global CSS entry.                                                                                                                                                                                                                                                                                            |

## What it's for

Dispatch is the workspace control plane sitting above individual template
apps:

- **Vault** — shared workspace secrets with a request → grant → audit flow,
  scoped per app.
- **Workspace resources** — cross-app resources (e.g. shared instructions or
  data) with explicit per-app grants and effective-context resolution.
- **Integrations & destinations** — outbound messaging channel setup (Slack,
  Teams, Discord, Telegram, WhatsApp, email, and more) and a destinations
  queue for delivering agent output.
- **Dream jobs** — a recurring background job (`ensure-dream-job`) that scans
  agent thread-debug history across connected sources and produces pending,
  evidence-backed proposals (`create-dream-report`, `list-dream-candidates`,
  `apply-dream-proposal` / `reject-dream-proposal`) without an extra LLM call.
- **Connected agents & provider APIs** — discovery of other workspace apps
  (`list-connected-agents`, `open_app`, `ask_app`) and a generic provider-api
  catalog/docs/request surface for calling third-party APIs through stored
  credentials.
- **Approvals & audit** — a shared approval-request/audit-event model used
  across the above surfaces.

## Eject

There is no `agent-native.package.json` / CLI package-lifecycle wiring for
this package yet (unlike `@agent-native/scheduling`). To customize beyond the
`setupDispatch` config surface, copy the files you want to own out of
`node_modules/@agent-native/dispatch/src` into your own package and swap the
dependency manually.
