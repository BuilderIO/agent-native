import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";
import { getOrgContext } from "@agent-native/core/org";
import {
  captureRouteError,
  getForwardedRequestOrigin,
  getForwardedRequestURL,
  getSession,
  runWithRequestContext,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import {
  AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  parseDataUrl,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getCookie,
  getQuery,
  getRouterParam,
  setCookie,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../../db/index.js";
import { contextClipIdForFootage } from "../../../lib/context-footage.js";
import {
  isHeldForRedaction,
  REDACTION_HOLD_MESSAGE,
} from "../../../lib/pending-redactions.js";
import { isRecordingExpiredForViewer } from "../../../lib/recording-page-access.js";
import { getOrganizationRoleForEmail } from "../../../lib/recordings.js";
import {
  fetchS3ObjectByUrl,
  isUrlInS3Storage,
} from "../../../lib/s3-upload-provider.js";
import {
  getRecordingAccessTokenResourceId,
  verifySharePassword,
} from "../../../lib/share-password.js";

const FETCH_TIMEOUT_MS = 30_000;
const PROTECTED_MEDIA_ACCESS_TTL_SECONDS = 6 * 60 * 60;
const PROTECTED_MEDIA_COOKIE_PREFIX = "clips_media_";
const SAFE_RASTER_IMAGE_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-icon",
]);

type ThumbnailRecording = {
  id: string;
  editsJson?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  baseImageUrl?: string | null;
  expiresAt?: string | null;
  organizationId?: string | null;
  ownerEmail?: string | null;
  password?: string | null;
  sharePasswordVersion?: string | null;
  trashedAt?: string | null;
  updatedAt?: string | null;
  failureCode?: string | null;
  storageMode?: "own" | "hosted" | null;
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
  const requestUrl = getForwardedRequestURL(event);
  return (
    requestUrl.protocol === "https:" ||
    process.env.APP_URL?.startsWith("https://") === true
  );
}

function renewProtectedMediaCookie(
  event: H3Event,
  recordingId: string,
  password: string | null | undefined,
  sharePasswordVersion: string | null | undefined,
  scopeId: string = recordingId,
): void {
  const token = signShortLivedToken({
    resourceId: getRecordingAccessTokenResourceId(
      scopeId,
      password,
      sharePasswordVersion,
    ),
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
  const parsed = parseDataUrl(sourceUrl);
  if (!parsed) return null;
  const mimeType = parsed.mediaType;
  if (!SAFE_RASTER_IMAGE_TYPES.has(mimeType)) return null;
  try {
    const bytes = parsed.isBase64
      ? decodeBase64(parsed.data)
      : new TextEncoder().encode(decodeURIComponent(parsed.data));
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

function defaultSocialImageResponse(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
      "Cache-Control": "private, max-age=0, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** `work`'s result, or null if `deadline` passes before it starts or settles. */
async function settleBy<T>(
  work: () => Promise<T>,
  deadline: number,
): Promise<T | null> {
  if (Date.now() >= deadline) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadline - Date.now());
      }),
    ]);
    // The timer can fire late, so the clock, not the race, says what was late.
    return Date.now() < deadline ? result : null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchThumbnail(
  sourceUrl: string,
  deadline = Date.now() + FETCH_TIMEOUT_MS,
): Promise<Response> {
  let currentUrl = sourceUrl;
  const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;

  for (let redirects = 0; redirects <= 4; redirects++) {
    // A DNS lookup cannot be cancelled, so the check gets only the budget
    // left; a host it could not clear in time is refused, not fetched.
    const blocked = await settleBy(
      () => isBlockedExtensionUrlWithDns(currentUrl),
      deadline,
    );
    if (blocked === null) {
      throw new Error("Thumbnail fetch ran out of time before the host check");
    }
    if (blocked) return imageResponse(null, "text/plain", 403);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadline - Date.now());
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
        upstream.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() ?? "";
      if (!SAFE_RASTER_IMAGE_TYPES.has(contentType)) {
        await upstream.body?.cancel().catch(() => {});
        return imageResponse(
          null,
          "text/plain; charset=utf-8",
          upstream.ok ? 415 : upstream.status,
        );
      }
      return imageResponse(upstream.body, contentType, upstream.status);
    }

    const location = upstream.headers.get("location");
    await upstream.body?.cancel().catch(() => {});
    if (!location) return imageResponse(null, "text/plain", upstream.status);
    currentUrl = new URL(location, currentUrl).href;
  }

  return imageResponse(null, "text/plain", 508);
}

async function fetchHostedThumbnail(
  sourceUrl: string,
  recordingId: string,
): Promise<Response> {
  const upstream = await fetchS3ObjectByUrl(sourceUrl, {
    recordingId,
    storageMode: "hosted",
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!upstream) return imageResponse(null, "text/plain", 404);
  return bucketImageResponse(upstream);
}

/**
 * Reads a thumbnail from the owner's own bucket with the bucket's credentials,
 * so it loads even when the bucket sits on a private address the public fetch
 * refuses. The credentials are the owner's workspace secrets, so they resolve
 * under the owner, not the viewer. Null means the bucket did not serve it.
 */
async function fetchOwnBucketThumbnail(
  sourceUrl: string,
  recordingId: string,
  recording: ThumbnailRecording,
): Promise<Response | null> {
  let upstream: Response | null;
  try {
    upstream = await runWithRequestContext(
      {
        userEmail: recording.ownerEmail ?? undefined,
        orgId: recording.organizationId ?? undefined,
      },
      () =>
        fetchS3ObjectByUrl(sourceUrl, {
          recordingId,
          storageMode: "own",
          timeoutMs: FETCH_TIMEOUT_MS,
        }),
    );
  } catch (error) {
    // A bucket that is down or misconfigured still leaves the public URL.
    captureRouteError(error, {
      route: "api/thumbnail",
      extra: { recordingId },
    });
    return null;
  }
  if (!upstream?.ok) {
    // A 5xx is the bucket failing, not a file it lacks, and the public
    // fallback's answer would hide it.
    if (upstream && upstream.status >= 500) {
      captureStorageStatus(upstream.status, recordingId);
    }
    await upstream?.body?.cancel().catch(() => {});
    return null;
  }
  return bucketImageResponse(upstream);
}

function captureStorageStatus(status: number, recordingId: string): void {
  captureRouteError(
    new Error(`Storage provider returned ${status} for thumbnail`),
    {
      route: "api/thumbnail",
      tags: { upstreamStatus: String(status) },
      extra: { recordingId },
    },
  );
}

async function bucketImageResponse(upstream: Response): Promise<Response> {
  const contentType =
    upstream.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (!upstream.ok || !SAFE_RASTER_IMAGE_TYPES.has(contentType)) {
    await upstream.body?.cancel().catch(() => {});
    return imageResponse(
      null,
      "text/plain; charset=utf-8",
      upstream.ok ? 415 : upstream.status,
    );
  }
  return imageResponse(upstream.body, contentType, upstream.status);
}

async function loadRecording(recordingId: string, event: H3Event) {
  // Earlier-screen-time footage is served under its Clip's access, expiry,
  // redaction, Trash, and password rules, never its own row's.
  const clipId = await contextClipIdForFootage(recordingId);
  const gateId = clipId ?? recordingId;
  const access = await resolveAccess("recording", gateId);
  let gate = (access?.resource as ThumbnailRecording | undefined) ?? null;
  const role = access?.role ?? null;
  const session = await getSession(event).catch(() => null);

  if (!gate) {
    const [row] = await getDb()
      .select({
        id: schema.recordings.id,
        editsJson: schema.recordings.editsJson,
        thumbnailUrl: schema.recordings.thumbnailUrl,
        animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
        baseImageUrl: schema.recordings.baseImageUrl,
        storageMode: schema.recordings.storageMode,
        expiresAt: schema.recordings.expiresAt,
        organizationId: schema.recordings.organizationId,
        ownerEmail: schema.recordings.ownerEmail,
        password: schema.recordings.password,
        sharePasswordVersion: schema.recordings.sharePasswordVersion,
        trashedAt: schema.recordings.trashedAt,
        updatedAt: schema.recordings.updatedAt,
        failureCode: schema.recordings.failureCode,
        visibility: schema.recordings.visibility,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, gateId))
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

    gate = row;
  }

  if (!clipId) return { recording: gate, role, gateId } as const;

  if (gate.trashedAt && role !== "owner") {
    return { error: "Not found", status: 404 } as const;
  }
  const [footage] = await getDb()
    .select({
      thumbnailUrl: schema.recordings.thumbnailUrl,
      animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
      storageMode: schema.recordings.storageMode,
      trashedAt: schema.recordings.trashedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!footage || footage.trashedAt) {
    return { error: "Not found", status: 404 } as const;
  }

  return {
    recording: {
      ...gate,
      id: recordingId,
      thumbnailUrl: footage.thumbnailUrl,
      animatedThumbnailUrl: footage.animatedThumbnailUrl,
      baseImageUrl: null,
      // Its files sit where the footage was stored; only the access and the
      // owner credentials come from the Clip.
      storageMode: footage.storageMode,
    },
    role,
    gateId,
  } as const;
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
      if (recording.failureCode === "taken_down") {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      if (
        isRecordingExpiredForViewer({
          expiresAt: recording.expiresAt,
          viewerIsOwner: loaded.role === "owner",
        })
      ) {
        setResponseStatus(event, 410);
        return { error: "Recording has expired" };
      }

      if (isHeldForRedaction(recording.editsJson, loaded.role)) {
        setResponseStatus(event, 409);
        return { error: REDACTION_HOLD_MESSAGE };
      }

      const query = getQuery(event) as {
        password?: unknown;
        t?: unknown;
        animated?: unknown;
        base?: unknown;
      };

      // The base image is editing material: the screenshot without its
      // movable marks. Only people who can edit the recording get it, and it
      // is never what a share link serves.
      const wantsBase = query.base === "1";
      if (wantsBase) {
        const role = loaded.role;
        const canEdit =
          role === "owner" || role === "admin" || role === "editor";
        if (!canEdit || !recording.baseImageUrl) {
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }
      }
      if (recording.password && loaded.role !== "owner") {
        const queryToken = typeof query.t === "string" ? query.t : "";
        const cookieToken = getCookie(event, cookieName(recordingId)) ?? "";
        const scopedRecordingId = getRecordingAccessTokenResourceId(
          loaded.gateId,
          recording.password,
          recording.sharePasswordVersion,
        );
        const password =
          typeof query.password === "string" ? query.password : "";
        const allowed =
          (queryToken &&
            verifyShortLivedToken(queryToken, scopedRecordingId).ok) ||
          (cookieToken &&
            verifyShortLivedToken(cookieToken, scopedRecordingId).ok) ||
          (password && verifySharePassword(password, recording.password));
        if (!allowed) {
          setResponseStatus(event, 401);
          return { error: "Password required", passwordRequired: true };
        }
        renewProtectedMediaCookie(
          event,
          recordingId,
          recording.password,
          recording.sharePasswordVersion,
          loaded.gateId,
        );
      }

      const sourceUrl = wantsBase
        ? recording.baseImageUrl
        : query.animated === "1"
          ? recording.animatedThumbnailUrl || recording.thumbnailUrl
          : recording.thumbnailUrl || recording.animatedThumbnailUrl;
      if (!sourceUrl) return defaultSocialImageResponse();

      if (sourceUrl.startsWith("data:")) {
        return dataUrlResponse(sourceUrl) ?? defaultSocialImageResponse();
      }
      if (isRecursiveThumbnailUrl(sourceUrl, recordingId)) {
        return defaultSocialImageResponse();
      }

      let resolvedSourceUrl = sourceUrl;
      if (sourceUrl.startsWith("/")) {
        resolvedSourceUrl = new URL(sourceUrl, getForwardedRequestOrigin(event))
          .href;
      }

      try {
        let response: Response;
        if (recording.storageMode === "hosted") {
          // Imported thumbnails (e.g. Loom's) live outside the bucket, so only
          // URLs inside it take the recording-bound private fetch.
          const isHostedObject =
            (await isUrlInS3Storage(resolvedSourceUrl, {
              storageMode: "hosted",
            })) !== false;
          response = isHostedObject
            ? await fetchHostedThumbnail(resolvedSourceUrl, recordingId)
            : await fetchThumbnail(resolvedSourceUrl);
        } else {
          // Both reads share one budget: a bucket that hangs would otherwise
          // make the public fallback wait out a second timeout.
          const deadline = Date.now() + FETCH_TIMEOUT_MS;
          response =
            (await fetchOwnBucketThumbnail(
              resolvedSourceUrl,
              recordingId,
              recording,
            )) ?? (await fetchThumbnail(resolvedSourceUrl, deadline));
        }
        if (response.status >= 500) {
          captureStorageStatus(response.status, recordingId);
        }
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        return response.ok &&
          contentType &&
          SAFE_RASTER_IMAGE_TYPES.has(contentType)
          ? response
          : defaultSocialImageResponse();
      } catch (error) {
        captureRouteError(error, {
          route: "api/thumbnail",
          extra: { recordingId },
        });
        return defaultSocialImageResponse();
      }
    },
  );
});
