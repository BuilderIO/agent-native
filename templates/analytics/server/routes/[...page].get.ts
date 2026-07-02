import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
} from "h3";

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

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

async function buildAgentDiscoveryScript(event: any): Promise<string | null> {
  const requestUrl = getRequestURL(event);
  const recordingId = sessionRecordingIdFromPath(requestUrl.pathname);
  if (!recordingId) return null;

  const query = getQuery(event);
  const token = queryString(query[SESSION_REPLAY_AGENT_ACCESS_PARAM]);
  if (!token) return null;

  const context = await buildSessionReplayAgentContext({
    recordingId,
    token,
    origin: requestUrl.origin,
    includeTimeline: false,
  }).catch(() => null);
  if (!context) return null;

  return `<script type="application/agent-native+json" id="analytics-session-replay-agent-context">${safeJsonForHtml(
    context,
  )}</script>`;
}

function injectAgentDiscovery(html: string, script: string): string {
  if (html.includes('id="analytics-session-replay-agent-context"')) {
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
  const script = await buildAgentDiscoveryScript(event);
  if (!script) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("Cache-Control", "private, max-age=0, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");

  return new Response(injectAgentDiscovery(html, script), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
