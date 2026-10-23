import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import { getQuery, type H3Event } from "h3";

import {
  CONTENT_CLIP_GRANT_EXPIRED,
  CONTENT_CLIP_PLAYBACK_GRANT_SECONDS,
} from "../../shared/content-clip-contract.js";
import {
  contentDocGrantFor,
  readContentBinding,
} from "./content-clip-bindings.js";
import {
  runWithContentDocGrant,
  type ContentDocGrant,
} from "./content-doc-grant.js";

// A Content page plays the video and poster straight from Clips, so their
// URLs carry who Content vouched for. The grant names the reader, never a
// role: each media request re-runs every gate, so trashing the binding or the
// Clip stops a URL that was already handed out.
const GRANT_PARAM = "content_grant";
const BINDING_PARAM = "content_binding";

export type ContentPlaybackAccess =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "expired" }
  | {
      status: "granted";
      viewerEmail: string | null;
      orgId: string | undefined;
      docGrant: ContentDocGrant | null;
    };

/**
 * The workspace a vouched reader acts in, the one their own Clips session
 * would pick, so a Clip shared with that workspace still opens for them.
 */
export async function contentReaderOrgId(
  viewerEmail: string | null,
): Promise<string | undefined> {
  if (!viewerEmail) return undefined;
  return (await resolveOrgIdForEmail(viewerEmail)) ?? undefined;
}

function grantResourceId(recordingId: string, bindingId: string | null) {
  return JSON.stringify(["content-clip-playback", recordingId, bindingId]);
}

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return typeof value === "string" ? value : "";
}

export function signContentPlaybackGrant(input: {
  recordingId: string;
  bindingId: string | null;
  viewerEmail: string | null;
}): { params: Record<string, string>; expiresAt: string } {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const token = signShortLivedToken({
    resourceId: grantResourceId(input.recordingId, input.bindingId),
    viewerEmail: input.viewerEmail ?? undefined,
    ttlSeconds: CONTENT_CLIP_PLAYBACK_GRANT_SECONDS,
  });
  return {
    params: {
      [GRANT_PARAM]: token,
      ...(input.bindingId ? { [BINDING_PARAM]: input.bindingId } : {}),
    },
    expiresAt: new Date(
      (issuedAtSeconds + CONTENT_CLIP_PLAYBACK_GRANT_SECONDS) * 1000,
    ).toISOString(),
  };
}

export function withContentPlaybackGrant(
  url: string,
  params: Record<string, string>,
): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.href;
}

/**
 * Reads a media request's Content grant. A grant that is present but does not
 * verify for this recording is `invalid`, never `absent`, so a tampered URL
 * cannot fall back to the browser's own Clips session. A genuine grant that
 * ran out is `expired`, which Content's player answers by asking again.
 */
export async function readContentPlaybackGrant(
  event: H3Event,
  recordingId: string,
): Promise<ContentPlaybackAccess> {
  const query = getQuery(event);
  if (query[GRANT_PARAM] === undefined && query[BINDING_PARAM] === undefined) {
    return { status: "absent" };
  }
  const token = firstQueryValue(query[GRANT_PARAM]);
  const bindingId = firstQueryValue(query[BINDING_PARAM]) || null;
  if (!token) return { status: "invalid" };
  const verified = verifyShortLivedToken(
    token,
    grantResourceId(recordingId, bindingId),
  );
  if (!verified.ok) {
    return verified.reason === "expired"
      ? { status: "expired" }
      : { status: "invalid" };
  }
  const viewerEmail = verified.viewerEmail?.trim().toLowerCase() || null;
  const orgId = await contentReaderOrgId(viewerEmail);
  if (!bindingId) {
    return { status: "granted", viewerEmail, orgId, docGrant: null };
  }

  const binding = await readContentBinding(bindingId);
  if (binding && binding.recordingId !== recordingId) {
    return { status: "invalid" };
  }
  return {
    status: "granted",
    viewerEmail,
    orgId,
    docGrant: binding ? contentDocGrantFor(binding, viewerEmail) : null,
  };
}

/** The response a media route sends when the grant does not let it serve. */
export function refusedContentPlayback(
  access: ContentPlaybackAccess,
): { status: number; body: { error: string; code?: string } } | null {
  if (access.status === "invalid") {
    return { status: 404, body: { error: "Not found" } };
  }
  if (access.status === "expired") {
    return {
      status: 403,
      body: {
        error: "Playback grant expired",
        code: CONTENT_CLIP_GRANT_EXPIRED,
      },
    };
  }
  return null;
}

export function runWithContentPlayback<T>(
  access: ContentPlaybackAccess,
  fn: () => T,
): T {
  return access.status === "granted" && access.docGrant
    ? runWithContentDocGrant(access.docGrant, fn)
    : fn();
}
