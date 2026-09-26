import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
} from "@agent-native/core/server";
import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import {
  buildAgentReadableResourceDiscovery,
  injectDocumentMarkup,
  renderAgentReadableResourceDiscoveryScript,
} from "@agent-native/core/shared";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
} from "h3";

import { PLAN_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";
import {
  planKindFromRouteSegment,
  planPathForKind,
  planRouteSegmentPattern,
} from "../../shared/plan-routes.js";
import type { PlanKind } from "../../shared/types.js";

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

function stripBasePath(pathname: string): string {
  const basePath = getConfiguredAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

const PLAN_PAGE_PATH_PATTERN = new RegExp(
  `^\\/(${planRouteSegmentPattern()})\\/([^/]+)\\/?$`,
);

function planFromPath(pathname: string): { id: string; kind: PlanKind } | null {
  const stripped = stripBasePath(pathname);
  const match = stripped.match(PLAN_PAGE_PATH_PATTERN);
  if (!match?.[1] || !match[2]) return null;
  const kind = planKindFromRouteSegment(match[1]);
  if (!kind) return null;
  const rawId = match[2];
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // A malformed percent-escape is still a routable segment; discovery only
    // needs the literal id the client will request.
    id = rawId;
  }
  return { kind, id };
}

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function injectScript(html: string, script: string): string {
  if (html.includes("agent-native-plan-agent-context")) return html;
  return injectDocumentMarkup(html, script, { target: "head" });
}

export default defineEventHandler(async (event) => {
  const response = (await ssrHandler(event)) as Response;
  const requestUrl = getRequestURL(event);
  const resource = planFromPath(requestUrl.pathname);
  if (!resource) return response;

  const token = queryString(getQuery(event)[AGENT_ACCESS_PARAM]);
  const script = renderAgentReadableResourceDiscoveryScript(
    buildAgentReadableResourceDiscovery({
      resourceType: "plan",
      resourceId: resource.id,
      path: planPathForKind(resource.id, resource.kind),
      contextEndpoint: PLAN_AGENT_CONTEXT_ENDPOINT,
      origin: requestUrl.origin,
      basePath: getConfiguredAppBasePath(),
      token,
      instructions:
        "Use contextUrl to read the visual plan bundle as structured JSON. Token links are read-only.",
    }),
    { id: "agent-native-plan-agent-context" },
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (token) {
    headers.set("Referrer-Policy", "no-referrer");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
  }

  return new Response(injectScript(html, script), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
