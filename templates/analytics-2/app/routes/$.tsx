import { Navigate, useLocation, useOutletContext } from "react-router";

import { SettingsRouteFallback } from "@/components/workspace/SettingsRouteFallback";

import { RouteFrame, type RouteOutletContext } from "./routing/frames";
import { isUnavailableAnalyticsRoute, resolveRoute } from "./routing/registry";

export default function ApplicationRoute() {
  const location = useLocation();
  const context = useOutletContext<RouteOutletContext | undefined>();
  const route = resolveRoute(
    location.pathname + location.search + location.hash,
    context?.routing,
  );
  if (route.frame === "redirect" && route.to)
    return <Navigate to={route.to} replace />;
  if (isUnavailableAnalyticsRoute(route))
    return <SettingsRouteFallback view={route.view} />;
  const page = context?.renderPage?.(route) ?? null;
  if (context?.renderFrame) return context.renderFrame(route, page);
  return <RouteFrame route={route}>{page}</RouteFrame>;
}
