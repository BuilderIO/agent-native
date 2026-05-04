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
 * NOTE: pages are stubs until the lift completes (subsequent commits).
 */
export const dispatchRoutes: RouteConfig = [
  index("./pages/overview.js"),
  route("apps", "./pages/apps.js"),
];
