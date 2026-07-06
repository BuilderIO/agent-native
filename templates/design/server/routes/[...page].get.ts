import {
  AGENT_ACCESS_PARAM,
  getConfiguredAppBasePath,
} from "@agent-native/core/server";
import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import {
  buildAgentReadableResourceDiscovery,
  renderAgentReadableResourceDiscoveryScript,
} from "@agent-native/core/shared";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
} from "h3";

import { DESIGN_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";

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

function designIdFromPath(pathname: string): string | null {
  const match = stripBasePath(pathname).match(/^\/design\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function injectScript(html: string, script: string): string {
  if (html.includes("agent-native-design-agent-context")) return html;
  if (html.includes("</head>"))
    return html.replace("</head>", `${script}</head>`);
  if (html.includes("</body>"))
    return html.replace("</body>", `${script}</body>`);
  return `${html}${script}`;
}

export default defineEventHandler(async (event) => {
  const response = (await ssrHandler(event)) as Response;
  const requestUrl = getRequestURL(event);
  const designId = designIdFromPath(requestUrl.pathname);
  if (!designId) return response;

  const token = queryString(getQuery(event)[AGENT_ACCESS_PARAM]);
  const script = renderAgentReadableResourceDiscoveryScript(
    buildAgentReadableResourceDiscovery({
      resourceType: "design",
      resourceId: designId,
      path: `/design/${designId}`,
      contextEndpoint: DESIGN_AGENT_CONTEXT_ENDPOINT,
      origin: requestUrl.origin,
      basePath: getConfiguredAppBasePath(),
      token,
      instructions:
        "Use contextUrl to read the current design handoff JSON. Token links are read-only and do not grant edit access.",
    }),
    { id: "agent-native-design-agent-context" },
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (token) {
    headers.set("Cache-Control", "private, max-age=0, no-store");
    headers.set("Referrer-Policy", "no-referrer");
    setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
  }

  return new Response(injectScript(html, script), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
