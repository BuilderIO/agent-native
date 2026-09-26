import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
  verifyScopedAgentAccessToken,
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

import {
  PLAN_AGENT_CONTEXT_ENDPOINT,
  PLAN_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable.js";

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

function planFromPath(pathname: string): {
  id: string;
  kind: "plan" | "recap";
} | null {
  const stripped = stripBasePath(pathname);
  const match = stripped.match(/^\/(plans|recaps)\/([^/]+)\/?$/);
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      kind: match[1] === "recaps" ? "recap" : "plan",
      id: decodeURIComponent(match[2]),
    };
  } catch {
    return {
      kind: match[1] === "recaps" ? "recap" : "plan",
      id: match[2],
    };
  }
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

  const suppliedToken = queryString(getQuery(event)[AGENT_ACCESS_PARAM]);
  const tokenAccess = suppliedToken
    ? verifyScopedAgentAccessToken(suppliedToken, {
        resourceKind: PLAN_AGENT_RESOURCE_KIND,
        resourceId: resource.id,
      }).ok
    : false;
  const token = tokenAccess ? suppliedToken : "";
  const script = renderAgentReadableResourceDiscoveryScript(
    buildAgentReadableResourceDiscovery({
      resourceType: "plan",
      resourceId: resource.id,
      path:
        resource.kind === "recap"
          ? `/recaps/${resource.id}`
          : `/plans/${resource.id}`,
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
  if (suppliedToken) {
    headers.set("Referrer-Policy", "no-referrer");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
  }
  if (tokenAccess) {
    // Tokenized HTML contains a bearer URL; key the shared cache by the full query.
    headers.set("netlify-vary", "query");
    setResponseHeader(event, "netlify-vary", "query");
  }

  return new Response(injectScript(html, script), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
