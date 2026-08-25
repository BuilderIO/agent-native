import { verifyScopedAgentAccessToken } from "@agent-native/core/server";
import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";
import {
  injectDocumentMarkup,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from "h3";

import {
  buildAgentApiUrls,
  buildAgentDiscoveryPayload,
  CLIP_AGENT_ACCESS_TOKEN_PREFIX,
  CLIPS_AGENT_ACCESS_PARAM,
} from "../../shared/agent-context.js";
import { getDb, schema } from "../db/index.js";
import {
  MEDIA_CAPTURE_PERMISSIONS_POLICY,
  withMediaCapturePermissions,
} from "../lib/media-permissions.js";
import {
  getServerAppBasePath,
  queryString,
} from "../lib/public-agent-context.js";
import { isRecordingExpired } from "../lib/recording-page-access.js";

const ssrHandler = createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);

function stripAppBasePath(pathname: string): string {
  const basePath = getServerAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length) || "/"
    : pathname;
}

function clipIdFromPath(pathname: string): string | null {
  const match = stripAppBasePath(pathname).match(/^\/(?:share|r)\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '\"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

async function buildClipAgentDiscovery(event: H3Event): Promise<{
  markup: string;
  noReferrer: boolean;
} | null> {
  const requestUrl = getRequestURL(event);
  const recordingId = clipIdFromPath(requestUrl.pathname);
  if (!recordingId) return null;

  const [recording] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      status: schema.recordings.status,
      visibility: schema.recordings.visibility,
      password: schema.recordings.password,
      expiresAt: schema.recordings.expiresAt,
      archivedAt: schema.recordings.archivedAt,
      trashedAt: schema.recordings.trashedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);

  if (
    !recording ||
    recording.archivedAt ||
    recording.trashedAt ||
    isRecordingExpired(recording.expiresAt)
  ) {
    return null;
  }

  const query = getQuery(event);
  const suppliedToken =
    queryString(query[CLIPS_AGENT_ACCESS_PARAM]) || queryString(query.t);
  const tokenGrantsAgentAccess = suppliedToken
    ? verifyScopedAgentAccessToken(suppliedToken, {
        resourceKind: CLIP_AGENT_ACCESS_TOKEN_PREFIX,
        resourceId: recording.id,
      }).ok
    : false;
  const anonymousAccess =
    recording.visibility === "public" && !recording.password;
  if (!anonymousAccess && !tokenGrantsAgentAccess) return null;

  const token = tokenGrantsAgentAccess ? suppliedToken : undefined;
  const agentContextUrl = buildAgentApiUrls(recording.id, {
    origin: requestUrl.origin,
    basePath: getServerAppBasePath(),
    token,
  }).contextUrl;
  const discovery = buildAgentDiscoveryPayload({
    recordingId: recording.id,
    title: recording.title,
    status: recording.status,
    agentContextUrl,
  });
  const contextHref = escapeHtmlAttribute(agentContextUrl);

  return {
    markup: `<link rel="alternate" type="application/json" href="${contextHref}" title="Agent-readable clip context"><script type="application/agent-native+json" id="clips-agent-context">${safeJsonForHtml(discovery)}</script>`,
    noReferrer: tokenGrantsAgentAccess,
  };
}

function injectClipAgentDiscovery(html: string, markup: string): string {
  const scriptId = 'id="clips-agent-context"';
  const scriptMarkup = html.includes(scriptId)
    ? ""
    : markup.slice(markup.indexOf("<script"));
  const linkMarkup = markup.slice(0, markup.indexOf("<script"));
  const injection = `${html.includes(linkMarkup) ? "" : linkMarkup}${scriptMarkup}`;
  return injectDocumentMarkup(html, injection, { target: "head" });
}

function withClipsResponseHeaders(
  event: H3Event,
  response: Response,
): Response {
  setResponseHeader(
    event,
    "Permissions-Policy",
    MEDIA_CAPTURE_PERMISSIONS_POLICY,
  );
  return withMediaCapturePermissions(response);
}

export default defineEventHandler(async (event) => {
  const response = (await ssrHandler(event)) as Response;
  const discovery = await buildClipAgentDiscovery(event);
  if (!discovery || !response.ok)
    return withClipsResponseHeaders(event, response);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return withClipsResponseHeaders(event, response);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (discovery.noReferrer) {
    headers.set("Referrer-Policy", "no-referrer");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");
  }

  const html = await response.text();
  const discoveredResponse = new Response(
    injectClipAgentDiscovery(html, discovery.markup),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
  return withClipsResponseHeaders(event, discoveredResponse);
});
