import { type RouteConfig, route, index } from "@react-router/dev/routes";

/**
 * Dispatch's routes as a programmatic `RouteConfig[]`. Splat into the
 * consumer's `app/routes.ts`:
 *
 * ```ts
 * import { type RouteConfig } from "@react-router/dev/routes";
 * import { dispatchRoutes } from "@agent-native/dispatch/routes";
 *
 * export default [
 *   ...localRoutes,    // consumer's own routes win on collision
 *   ...dispatchRoutes, // dispatch fills in everything else
 * ] satisfies RouteConfig;
 * ```
 *
 * Route precedence: React Router 7 matches in declaration order, so
 * placing `dispatchRoutes` LAST means consumer-defined routes with the
 * same path take precedence. To override a single dispatch route, define
 * it in your local routes; to keep it, omit it.
 *
 * The `file` paths below resolve relative to this file at runtime — they
 * point into `packages/dispatch/dist/routes/pages/*.js` after build.
 *
 * Naming maps the original flatRoutes file conventions:
 *   `_index.tsx`        → `index(...)`
 *   `<name>.tsx`        → `route("<name>", ...)`
 *   `<a>.$<param>.tsx`  → `route("<a>/:<param>", ...)`
 *   `<a>._index.tsx`    → flattened as `route("<a>", ...)` (workspace
 *      versions are bare and don't wrap a parent layout)
 */
export const dispatchRoutes: RouteConfig = [
  index("./pages/_index.js"),
  route("overview", "./pages/overview.js"),
  route("apps", "./pages/apps.js"),
  route("apps/:appId", "./pages/apps.$appId.js"),
  route("new-app", "./pages/new-app.js"),
  route("vault", "./pages/vault.js"),
  route("integrations", "./pages/integrations.js"),
  route("agents", "./pages/agents.js"),
  route("workspace", "./pages/workspace.js"),
  route("messaging", "./pages/messaging.js"),
  route("destinations", "./pages/destinations.js"),
  route("identities", "./pages/identities.js"),
  route("approval", "./pages/approval.js"),
  route("approvals", "./pages/approvals.js"),
  route("audit", "./pages/audit.js"),
  route("team", "./pages/team.js"),
  route("tools", "./pages/tools._index.js"),
  route("tools/:id", "./pages/tools.$id.js"),
];
