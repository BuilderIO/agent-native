/**
 * Serve a recording thumbnail from the same origin as the public player.
 *
 * Thumbnail providers may return expiring or hotlink-protected URLs. Public
 * share pages already proxy video through `/api/video/:recordingId`; using the
 * same contract here keeps embeds and crawler previews reliable.
 */

import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";
import { getOrgContext } from "@agent-native/core/org";
import {
  captureRouteError,
  getSession,
  runWithRequestContext,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getCookie,
  getQuery,
  getRequestURL,
  getRouterParam,
  setCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../db/index.js";
import { getOrganizationRoleForEmail } from "../../../lib/recordings.js";
import { verifySharePassword } from "../../../lib/share-password.js";

const FETCH_TIMEOUT_MS = 30_000;
const PROTECTED_MEDIA_ACCESS_TTL_SECONDS = 6 * 60 * 60;
const PROTECTED_MEDIA_COOKIE_PREFIX = "clips_media_";

type ThumbnailRecording = {
  id: string;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  expiresAt?: string | null;
  organizationId?: string | null;
  password?: string | null;
  visibility?: string | null;
};

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

function cookieName(recordingId: string): string {
  return `${PROTECTED_MEDIA_COOKIE_PREFIX}${recordingId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function cookiePath(recordingId: string): string {
  return appPath(`/api/thumbnail/${encodeURIComponent(recordingId)}`);
}

function isHttpsRequest(event: H3Event): boolean {
  const requestUrl = getRequestURL(event);
  return (
    requestUrl.protocol === "https:" ||
    process.env.APP_URL?.startsWith("https://") === true
  );
}

function renewProtectedMediaCookie(event: H3Event, recordingId: string): void {
  const token = signShortLivedToken({
    resourceId: recordingId,
    ttlSeconds: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
  const secure = isHttpsRequest(event);
  setCookie(event, cookieName(recordingId), token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    ...(secure ? { partitioned: true } : {}),
    path: cookiePath(recordingId),
    maxAge: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
}

function isRecursiveThumbnailUrl(value: string, recordingId: string): boolean {
  try {
    const parsed = new URL(value, "http://local.test");
    const expected = `/api/thumbnail/${encodeURIComponent(recordingId)}`;
    return parsed.pathname === expected || parsed.pathname.endsWith(expected);
  } catch {
    return false;
  }
}

function dataUrlResponse(sourceUrl: string): Response | null {
  const match = sourceUrl.match(/^data:(image\/[\w.+-]+)(;base64)?,(.*)$/s);
  if (!match) return null;

  const [, mimeType, encoding, payload] = match;
  try {
    const bytes = encoding
      ? decodeBase64(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
    return imageResponse(bytes, mimeType);
  } catch {
    return null;
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function imageResponse(
  body: BodyInit | null,
  mimeType: string,
  status = 200,
): Response {
  const headers = new Headers({
    "Content-Type": mimeType,
    "Cache-Control": "private, max-age=0, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(body, { status, headers });
}

async function fetchThumbnail(sourceUrl: string): Promise<Response> {
  let currentUrl = sourceUrl;
  const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;

  for (let redirects = 0; redirects <= 4; redirects++) {
    if (await isBlockedExtensionUrlWithDns(currentUrl)) {
      return imageResponse(null, "text/plain", 403);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      const fetchOptions: RequestInit & { dispatcher?: unknown } = {
        redirect: "manual",
        signal: controller.signal,
      };
      if (dispatcher) fetchOptions.dispatcher = dispatcher;
      upstream = await fetch(currentUrl, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }

    if (upstream.status < 300 || upstream.status >= 400) {
      const contentType =
        upstream.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg";
      return imageResponse(upstream.body, contentType, upstream.status);
    }

    const location = upstream.headers.get("location");
    if (!location) return imageResponse(null, "text/plain", upstream.status);
    currentUrl = new URL(location, currentUrl).href;
  }

  return imageResponse(null, "text/plain", 508);
}

async function loadRecording(recordingId: string, event: H3Event) {
  const access = await resolveAccess("recording", recordingId);
  let recording = (access?.resource as ThumbnailRecording | undefined) ?? null;
  const role = access?.role ?? null;
  const session = await getSession(event).catch(() => null);

  if (!recording) {
    const [row] = await getDb()
      .select({
        id: schema.recordings.id,
        thumbnailUrl: schema.recordings.thumbnailUrl,
        animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
        expiresAt: schema.recordings.expiresAt,
        organizationId: schema.recordings.organizationId,
        password: schema.recordings.password,
        visibility: schema.recordings.visibility,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId))
      .limit(1);

    if (!row) return { error: "Not found", status: 404 } as const;

    let viewerIsOrgMember = false;
    if (session?.email && row.visibility === "org" && row.organizationId) {
      const orgRole = await getOrganizationRoleForEmail(
        row.organizationId,
        session.email,
      ).catch(() => null);
      viewerIsOrgMember = Boolean(orgRole);
    }
    if (row.visibility !== "public" && !viewerIsOrgMember) {
      return { error: "Not found", status: 404 } as const;
    }

    recording = row;
  }

  return { recording, role } as const;
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const session = await getSession(event).catch(() => null);
  const orgCtx = await getOrgContext(event).catch(() => null);

  return runWithRequestContext(
    { userEmail: session?.email, orgId: orgCtx?.orgId ?? session?.orgId },
    async () => {
      const loaded = await loadRecording(recordingId, event);
      if ("error" in loaded) {
        setResponseStatus(event, loaded.status);
        return { error: loaded.error };
      }

      const { recording } = loaded;
      if (recording.expiresAt) {
        const expires = new Date(recording.expiresAt).getTime();
        if (Number.isFinite(expires) && expires < Date.now()) {
          setResponseStatus(event, 410);
          return { error: "Recording has expired" };
        }
      }

      const query = getQuery(event) as {
        password?: unknown;
        t?: unknown;
      };
      if (recording.password && loaded.role !== "owner") {
        const queryToken = typeof query.t === "string" ? query.t : "";
        const cookieToken = getCookie(event, cookieName(recordingId)) ?? "";
        const password =
          typeof query.password === "string" ? query.password : "";
        const allowed =
          (queryToken && verifyShortLivedToken(queryToken, recordingId).ok) ||
          (cookieToken && verifyShortLivedToken(cookieToken, recordingId).ok) ||
          (password && verifySharePassword(password, recording.password));
        if (!allowed) {
          setResponseStatus(event, 401);
          return { error: "Password required", passwordRequired: true };
        }
        renewProtectedMediaCookie(event, recordingId);
      }

      const sourceUrl =
        recording.thumbnailUrl || recording.animatedThumbnailUrl;
      if (!sourceUrl) {
        setResponseStatus(event, 404);
        return { error: "Thumbnail not found" };
      }

      const inline = dataUrlResponse(sourceUrl);
      if (inline) return inline;
      if (isRecursiveThumbnailUrl(sourceUrl, recordingId)) {
        setResponseStatus(event, 404);
        return { error: "Thumbnail not found" };
      }

      let resolvedSourceUrl = sourceUrl;
      if (sourceUrl.startsWith("/")) {
        resolvedSourceUrl = new URL(sourceUrl, getRequestURL(event).origin)
          .href;
      }

      try {
        const response = await fetchThumbnail(resolvedSourceUrl);
        if (response.status >= 500) {
          captureRouteError(
            new Error(
              `Storage provider returned ${response.status} for thumbnail`,
            ),
            {
              route: "api/thumbnail",
              tags: { upstreamStatus: String(response.status) },
              extra: { recordingId },
            },
          );
          setResponseStatus(event, 502);
          return { error: "The recording thumbnail could not be loaded." };
        }
        return response;
      } catch (error) {
        captureRouteError(error, {
          route: "api/thumbnail",
          extra: { recordingId },
        });
        setResponseStatus(event, 502);
        return { error: "The recording thumbnail could not be loaded." };
      }
    },
  );
});
