import { type RouteConfig, layout, route } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes({
  ignoredRouteFiles: [
    "**/*.test.{ts,tsx}",
    "**/*.spec.{ts,tsx}",
    "routes/home.tsx",
    "routes/home-layout.tsx",
    "routes/templates.tsx",
  ],
}).then((routes) => [
  ...routes,
  layout("./routes/home-layout.tsx", [
    route("home", "./routes/home.tsx"),
    route("templates", "./routes/templates.tsx"),
  ]),
]) satisfies RouteConfig;
