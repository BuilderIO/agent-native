import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// Re-scan trigger: picks up newly-added files in app/routes (e.g. diff-kitchen-sink).
export default flatRoutes() satisfies RouteConfig;
