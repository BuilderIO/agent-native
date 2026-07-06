import { AGENT_ACCESS_PARAM } from "@agent-native/core/server";
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

import {
  ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
  ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT,
} from "../../shared/resource-agent-access.js";
import {
  buildSessionReplayAgentContext,
  safeJsonForHtml,
  SESSION_REPLAY_AGENT_ACCESS_PARAM,
} from "../lib/session-replay-agent-context.js";

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

function configuredAppBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  if (!raw || raw === "/") return "";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, "");
}

function stripAppBasePath(pathname: string): string {
  const basePath = configuredAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function sessionRecordingIdFromPath(pathname: string): string | null {
  const match = stripAppBasePath(pathname).match(/^\/sessions\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function analyticsResourceFromPath(
  pathname: string,
): { type: "dashboard" | "analysis"; id: string } | null {
  const stripped = stripAppBasePath(pathname);
  const dashboard = stripped.match(/^\/dashboards\/([^/]+)\/?$/);
  const analysis = stripped.match(/^\/analyses\/([^/]+)\/?$/);
  const type = dashboard ? "dashboard" : analysis ? "analysis" : null;
  const rawId = dashboard?.[1] ?? analysis?.[1];
  if (!type || !rawId) return null;
  try {
    return { type, id: decodeURIComponent(rawId) };
  } catch {
    return { type, id: rawId };
  }
}

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

interface AgentDiscoveryInjection {
  script: string;
  privateResponse: boolean;
}

async function buildAgentDiscoveryScript(
  event: any,
): Promise<AgentDiscoveryInjection | null> {
  const requestUrl = getRequestURL(event);
  const recordingId = sessionRecordingIdFromPath(requestUrl.pathname);
  const query = getQuery(event);
  if (recordingId) {
    const token = queryString(query[SESSION_REPLAY_AGENT_ACCESS_PARAM]);
    if (!token) return null;

    const context = await buildSessionReplayAgentContext({
      recordingId,
      token,
      origin: requestUrl.origin,
      includeTimeline: false,
    }).catch(() => null);
    if (!context) return null;

    return {
      script: `<script type="application/agent-native+json" id="analytics-session-replay-agent-context">${safeJsonForHtml(
        context,
      )}</script>`,
      privateResponse: true,
    };
  }

  const resource = analyticsResourceFromPath(requestUrl.pathname);
  if (!resource) return null;

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  const isDashboard = resource.type === "dashboard";
  return {
    script: renderAgentReadableResourceDiscoveryScript(
      buildAgentReadableResourceDiscovery({
        resourceType: isDashboard ? "dashboard" : "analysis",
        resourceId: resource.id,
        path: `/${isDashboard ? "dashboards" : "analyses"}/${encodeURIComponent(resource.id)}`,
        contextEndpoint: isDashboard
          ? ANALYTICS_DASHBOARD_AGENT_CONTEXT_ENDPOINT
          : ANALYTICS_ANALYSIS_AGENT_CONTEXT_ENDPOINT,
        origin: requestUrl.origin,
        basePath: configuredAppBasePath(),
        token,
        instructions:
          "Use contextUrl to read this Analytics artifact as structured JSON. Token links are read-only and do not grant edit access.",
      }),
      {
        id: isDashboard
          ? "analytics-dashboard-agent-context"
          : "analytics-analysis-agent-context",
      },
    ),
    privateResponse: Boolean(token),
  };
}

function injectAgentDiscovery(html: string, script: string): string {
  const scriptId = script.match(/\sid="([^"]+)"/)?.[1];
  if (scriptId && html.includes(`id="${scriptId}"`)) {
    return html;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }
  return `${html}${script}`;
}

export default defineEventHandler(async (event) => {
  const response = (await ssrHandler(event)) as Response;
  const discovery = await buildAgentDiscoveryScript(event);
  if (!discovery) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (discovery.privateResponse) {
    headers.set("Cache-Control", "private, max-age=0, no-store");
    headers.set("Referrer-Policy", "no-referrer");
    setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
  }

  return new Response(injectAgentDiscovery(html, discovery.script), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
