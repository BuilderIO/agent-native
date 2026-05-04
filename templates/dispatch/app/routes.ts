import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

/**
 * Routes are file-based (one shell file per route under `app/routes/`).
 * Each shell is a 1-line re-export from `@agent-native/dispatch/routes/pages/<name>`.
 *
 * Why not splat `dispatchRoutes` from the package directly? React Router 7's
 * programmatic routes config uses `file` paths that the dev compiler resolves
 * relative to the consumer's `app/` directory — so package-internal `./pages/*`
 * paths don't work. The shell-file pattern keeps file-based routing intact
 * while delegating component logic to the package; each shell is one line.
 */
export default flatRoutes() satisfies RouteConfig;
