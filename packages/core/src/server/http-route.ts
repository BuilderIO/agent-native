/**
 * The `http.route` every server request is recorded under, on the
 * `http.server.request.duration` metric and the `http.server` span.
 *
 * Every value comes from a closed set, because each distinct value mints a
 * full histogram series per method and status code:
 *
 * - a template from `FRAMEWORK_HTTP_ROUTES` for the framework's own endpoints
 *   (`:name` is one path segment, a trailing `*` is any remainder);
 * - `"/_agent-native/*"`, `"/mcp/*"`, or `"/.well-known/*"` for a path in
 *   one of those namespaces that no template covers;
 * - the template of the app's own Nitro file route (`/api/clips/:id`),
 *   which is bounded by the app's route files;
 * - `"/api/*"` for any other app API path;
 * - `"static"` for a request for a file (`/assets/…`, `*.js`, `favicon.ico`);
 * - `"page"` for any other GET or HEAD: documents and `.data` loader requests;
 * - `"other"` for everything else.
 *
 * Trusted action routes resolve before this, in `http-response-telemetry.ts`,
 * to the template the action declared. Never return a raw path from here.
 */

import {
  MCP_DIRECTORY_ROUTE_PREFIX,
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
} from "../mcp/route-paths.js";
import { AGENT_NATIVE_OPEN_PATH } from "../shared/agent-sidebar-url.js";
import { FRAMEWORK_INTERNAL_ROUTE_PREFIX } from "../shared/framework-route-prefix.js";
import { AGENT_NATIVE_SOCIAL_IMAGE_PATH } from "../shared/social-meta.js";
import {
  getAppBasePathFromViteEnv,
  stripAppBasePath,
} from "./app-base-path.js";
import { canonicalFrameworkPathname } from "./framework-route-prefix.js";

const P = FRAMEWORK_INTERNAL_ROUTE_PREFIX;
const WELL_KNOWN_PREFIX = "/.well-known";

export const HTTP_ROUTE_FRAMEWORK_OTHER = `${P}/*`;
export const HTTP_ROUTE_MCP_OTHER = `${MCP_PUBLIC_ROUTE_PREFIX}/*`;
export const HTTP_ROUTE_WELL_KNOWN_OTHER = `${WELL_KNOWN_PREFIX}/*`;
export const HTTP_ROUTE_API_OTHER = "/api/*";
export const HTTP_ROUTE_STATIC = "static";
export const HTTP_ROUTE_PAGE = "page";
export const HTTP_ROUTE_OTHER = "other";

/**
 * Framework endpoints, mirroring the mounts in `core-routes-plugin.ts`,
 * `auth.ts`, `agent-chat-plugin.ts`, `a2a/server.ts`, `mcp/`, and
 * `integrations/plugin.ts`. A mount handles its whole subtree, so most
 * entries end in `*`; a deeper entry exists only where one endpoint inside a
 * mount needs its own series. An endpoint missing from this list is still
 * recorded, under its namespace's `/*` bucket.
 */
export const FRAMEWORK_HTTP_ROUTES = [
  // Auth and identity
  `${P}/auth/session`,
  `${P}/auth/login`,
  `${P}/auth/logout`,
  `${P}/auth/desktop-exchange`,
  `${P}/auth/ba/*`,
  `${P}/auth/*`,
  `${P}/google/*`,
  `${P}/identity/*`,
  `${P}/oauth/*`,
  `${P}/org/*`,

  // Sync and polling
  `${P}/poll`,
  `${P}/events`,
  `${P}/poll-events`,
  `${P}/realtime-token`,
  `${P}/can-see`,
  `${P}/collab/*`,
  `${P}/application-state`,
  `${P}/application-state/compose/*`,
  `${P}/application-state/:key`,

  // Actions and tools
  `${P}/actions/:action`,
  `${P}/actions/*`,
  `${P}/webmcp/*`,
  `${P}/extensions/*`,
  `${P}/tools/*`,
  `${P}/slots/*`,

  // Agent chat and runs
  `${P}/agent-chat`,
  `${P}/agent-chat/runs/:runId/events`,
  `${P}/agent-chat/runs/*`,
  `${P}/agent-chat/threads/*`,
  `${P}/agent-chat/_process-run`,
  `${P}/agent-chat/*`,
  `${P}/agent-chat-stream`,
  `${P}/agent-teams/*`,
  `${P}/agent-engine/*`,
  `${P}/agents/*`,
  `${P}/runs/*`,

  // Cross-app (A2A)
  `${P}/a2a`,
  `${P}/a2a/approvals/*`,
  `${P}/a2a/_process-task`,
  `${WELL_KNOWN_PREFIX}/agent-card.json`,

  // MCP server (public and legacy prefixes) and MCP client management
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_DIRECTORY_ROUTE_PREFIX,
  `${MCP_PUBLIC_ROUTE_PREFIX}/oauth/*`,
  `${MCP_PUBLIC_ROUTE_PREFIX}/connect/*`,
  `${MCP_PUBLIC_ROUTE_PREFIX}/tool/:action`,
  MCP_LEGACY_ROUTE_PREFIX,
  `${MCP_LEGACY_ROUTE_PREFIX}/oauth/*`,
  `${MCP_LEGACY_ROUTE_PREFIX}/connect/*`,
  `${MCP_LEGACY_ROUTE_PREFIX}/servers/*`,
  `${MCP_LEGACY_ROUTE_PREFIX}/hub/*`,
  `${MCP_LEGACY_ROUTE_PREFIX}/*`,
  `${WELL_KNOWN_PREFIX}/oauth-protected-resource/*`,
  `${WELL_KNOWN_PREFIX}/oauth-authorization-server/*`,

  // Integrations and remote hosts
  `${P}/integrations/:platform/webhook`,
  `${P}/integrations/remote/poll`,
  `${P}/integrations/remote/heartbeat`,
  `${P}/integrations/remote/*`,
  `${P}/integrations/process-task`,
  `${P}/integrations/*`,
  `${P}/connections/*`,
  `${P}/builder/*`,

  // Workspace data and settings
  `${P}/resources/*`,
  `${P}/secrets/*`,
  `${P}/settings/*`,
  `${P}/notifications/*`,
  `${P}/onboarding/*`,
  `${P}/avatar/*`,
  `${P}/creative-context/*`,
  `${P}/file-upload/*`,
  `${P}/automations/*`,
  `${P}/jobs/*`,
  `${P}/observability/*`,
  `${P}/usage`,

  // Voice
  `${P}/transcribe-voice`,
  `${P}/transcribe-stream/*`,
  `${P}/voice-providers/*`,
  `${P}/realtime-voice/*`,
  `${P}/speak`,

  // Shell, embedding, and health
  AGENT_NATIVE_OPEN_PATH,
  `${P}/embed/*`,
  `${P}/ping`,
  `${P}/health/*`,
  `${P}/track`,
  `${P}/speculation-rules.json`,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  `${P}/recap-image/*`,
] as const;

/** Every value `httpRouteForRequest` can return besides an app file route. */
export const HTTP_ROUTE_BUCKETS = [
  HTTP_ROUTE_FRAMEWORK_OTHER,
  HTTP_ROUTE_MCP_OTHER,
  HTTP_ROUTE_WELL_KNOWN_OTHER,
  HTTP_ROUTE_API_OTHER,
  HTTP_ROUTE_STATIC,
  HTTP_ROUTE_PAGE,
  HTTP_ROUTE_OTHER,
] as const;

const MAX_APP_ROUTE_LENGTH = 200;
const STATIC_FILE_SEGMENT = /\.[A-Za-z0-9]{1,12}$/;

interface RoutePattern {
  route: string;
  segments: string[];
  score: number;
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

// Ranked like React Router's branches (see client/route-template.ts): a
// static segment outranks a param, which outranks a wildcard remainder.
function compilePattern(route: string): RoutePattern {
  const segments = pathSegments(route);
  let score = segments.length;
  for (const segment of segments) {
    if (segment === "*") score -= 2;
    else score += segment.startsWith(":") ? 3 : 10;
  }
  return { route, segments, score };
}

const FRAMEWORK_PATTERNS = FRAMEWORK_HTTP_ROUTES.map(compilePattern).sort(
  (left, right) => right.score - left.score,
);

function matches(pattern: string[], segments: string[]): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment === "*") return true;
    const value = segments[index];
    if (value === undefined) return false;
    if (segment.startsWith(":")) continue;
    if (segment !== value) return false;
  }
  return pattern.length === segments.length;
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function frameworkNamespaceBucket(pathname: string): string | undefined {
  if (isUnder(pathname, P)) return HTTP_ROUTE_FRAMEWORK_OTHER;
  if (isUnder(pathname, MCP_PUBLIC_ROUTE_PREFIX)) return HTTP_ROUTE_MCP_OTHER;
  if (isUnder(pathname, WELL_KNOWN_PREFIX)) return HTTP_ROUTE_WELL_KNOWN_OTHER;
  return undefined;
}

// Nitro's catch-all (`/**`, the SSR renderer) names no route of its own.
function appFileRoute(matchedRoute: unknown): string | undefined {
  if (typeof matchedRoute !== "string") return undefined;
  if (!matchedRoute.startsWith("/") || matchedRoute.startsWith("/**")) {
    return undefined;
  }
  return matchedRoute.length <= MAX_APP_ROUTE_LENGTH ? matchedRoute : undefined;
}

export interface HttpRouteRequest {
  method: string;
  pathname: string;
  /** Nitro's matched file-route template (`event.context.matchedRoute.route`). */
  matchedRoute?: unknown;
}

export function httpRouteForRequest(request: HttpRouteRequest): string {
  const pathname =
    stripAppBasePath(
      canonicalFrameworkPathname(request.pathname || "/"),
      getAppBasePathFromViteEnv(),
    ).replace(/\/+$/, "") || "/";

  const namespaceBucket = frameworkNamespaceBucket(pathname);
  if (namespaceBucket) {
    const segments = pathSegments(pathname);
    return (
      FRAMEWORK_PATTERNS.find((pattern) => matches(pattern.segments, segments))
        ?.route ?? namespaceBucket
    );
  }

  const fileRoute = appFileRoute(request.matchedRoute);
  if (fileRoute) return fileRoute;
  if (isUnder(pathname, "/api")) return HTTP_ROUTE_API_OTHER;

  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (
    isUnder(pathname, "/assets") ||
    (STATIC_FILE_SEGMENT.test(lastSegment) && !lastSegment.endsWith(".data"))
  ) {
    return HTTP_ROUTE_STATIC;
  }

  const method = request.method.toUpperCase();
  return method === "GET" || method === "HEAD"
    ? HTTP_ROUTE_PAGE
    : HTTP_ROUTE_OTHER;
}
