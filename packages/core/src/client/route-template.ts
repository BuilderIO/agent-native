import { normalizeHttpTelemetryPath } from "../shared/telemetry-path.js";

type ManifestRoute = {
  id: string;
  parentId?: string;
  path?: string;
  index?: boolean;
};

type RoutePattern = {
  segments: string[];
  score: number;
};

const MAX_ROUTE_TEMPLATE_LENGTH = 200;
const PARAM_SEGMENT = /^:[\w-]+$/;

let cachedRoutes: Record<string, ManifestRoute> | undefined;
let cachedPatterns: RoutePattern[] = [];

// Mirrors React Router's branch ranking so the template is the route that
// rendered, without importing react-router (an optional peer of core).
function scorePattern(segments: string[], index: boolean): number {
  let score = segments.length;
  if (segments.includes("*")) score -= 2;
  if (index) score += 2;
  for (const segment of segments) {
    if (segment === "*") continue;
    score += PARAM_SEGMENT.test(segment) ? 3 : segment === "" ? 1 : 10;
  }
  return score;
}

function explodeOptionalSegments(segments: string[]): string[][] {
  if (!segments.length) return [[]];
  const [first, ...rest] = segments;
  const tails = explodeOptionalSegments(rest);
  if (!first.endsWith("?")) return tails.map((tail) => [first, ...tail]);
  const required = first.slice(0, -1);
  return [...tails.map((tail) => [required, ...tail]), ...tails];
}

function fullPathSegments(
  route: ManifestRoute,
  routes: Record<string, ManifestRoute>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: ManifestRoute | undefined = route;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.path) chain.unshift(current.path);
    current = current.parentId ? routes[current.parentId] : undefined;
  }
  return chain
    .join("/")
    .split("/")
    .filter((segment) => segment !== "");
}

function routePatterns(routes: Record<string, ManifestRoute>): RoutePattern[] {
  if (routes === cachedRoutes) return cachedPatterns;
  const patterns: RoutePattern[] = [];
  for (const route of Object.values(routes)) {
    if (route.path == null && !route.index) continue;
    for (const segments of explodeOptionalSegments(
      fullPathSegments(route, routes),
    )) {
      patterns.push({
        segments,
        score: scorePattern(segments, Boolean(route.index)),
      });
    }
  }
  patterns.sort((a, b) => b.score - a.score);
  cachedRoutes = routes;
  cachedPatterns = patterns;
  return patterns;
}

function matches(pattern: string[], pathSegments: string[]): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment === "*") return true;
    const value = pathSegments[index];
    if (value === undefined) return false;
    if (PARAM_SEGMENT.test(segment)) continue;
    if (segment.toLowerCase() !== value.toLowerCase()) return false;
  }
  return pattern.length === pathSegments.length;
}

function stripBasename(pathname: string, basename: string): string | null {
  const base = basename.replace(/\/+$/, "");
  if (!base) return pathname;
  const lower = pathname.toLowerCase();
  const lowerBase = base.toLowerCase();
  if (lower === lowerBase) return "/";
  return lower.startsWith(`${lowerBase}/`) ? pathname.slice(base.length) : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The route template a path renders, such as `/sessions/:id`, so telemetry
 * groups pages without carrying ids from the URL. Paths that no manifest
 * route matches fall back to the id-normalized path.
 */
export function routeTemplateForPath(
  pathname: string,
  routes: Record<string, ManifestRoute> | undefined,
  basename = "",
): string {
  const relative = stripBasename(pathname, basename);
  if (routes && relative !== null) {
    const pathSegments = relative
      .split("/")
      .filter((segment) => segment !== "")
      .map(decodeSegment);
    const match = routePatterns(routes).find((pattern) =>
      matches(pattern.segments, pathSegments),
    );
    if (match) {
      return `/${match.segments.join("/")}`.slice(0, MAX_ROUTE_TEMPLATE_LENGTH);
    }
  }
  return normalizeHttpTelemetryPath(pathname).slice(
    0,
    MAX_ROUTE_TEMPLATE_LENGTH,
  );
}

/** Browser only: the route template of the current location. */
export function currentRouteTemplate(): string {
  const routes = (
    window as Window & {
      __reactRouterManifest?: { routes?: Record<string, ManifestRoute> };
    }
  ).__reactRouterManifest?.routes;
  const basename = (
    window as Window & { __reactRouterContext?: { basename?: string } }
  ).__reactRouterContext?.basename;
  return routeTemplateForPath(window.location.pathname, routes, basename ?? "");
}
