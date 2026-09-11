import type { ProjectIR, SiteRoute } from "./types.js";

const BUILDER_ROUTE_KINDS = new Set(["marketing", "docs", "landing"]);

export function canRouteUseBuilder(route: SiteRoute): boolean {
  return BUILDER_ROUTE_KINDS.has(route.kind);
}

export function classifyBuilderEligibleRoutes(ir: ProjectIR): {
  eligible: SiteRoute[];
  blocked: SiteRoute[];
} {
  const eligible: SiteRoute[] = [];
  const blocked: SiteRoute[] = [];
  for (const route of ir.site.routes) {
    if (canRouteUseBuilder(route)) eligible.push(route);
    else blocked.push(route);
  }
  return { eligible, blocked };
}
