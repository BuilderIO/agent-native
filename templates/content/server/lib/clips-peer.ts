/**
 * Content's side of a Clip played in a page: where Clips is, the secret only
 * Content and Clips hold, and the one function that mints the token Content
 * vouches for a reader with. The contract is `shared/clips-peer-contract.ts`.
 */
import {
  canonicalA2AAudience,
  getGlobalA2ASecret,
  signA2AToken,
} from "@agent-native/core/a2a";
import { AppConfigurationError } from "@agent-native/core/app-config";
import {
  getAppConfig,
  resolveContentClipsPeerSecret,
} from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import {
  resolveEnvironmentTargets,
  resolveLaneEndpoint,
} from "@agent-native/core/shared/environment-lanes";

import {
  CLIP_PLAYBACK_ERRORS,
  CONTENT_CLIP_AUDIENCE_PATH,
  CONTENT_CLIP_CLAIMS,
  CONTENT_CLIP_NOT_CONFIGURED,
  CONTENT_CLIP_PUBLIC_READER,
  CONTENT_CLIP_SCOPES,
  type ClipPlaybackErrorCode,
  type ContentClipScope,
} from "../../shared/clips-peer-contract.js";

/** Who Content vouches for. A public reader is never named to Clips. */
export type ClipReader =
  | { kind: "signed-in"; email: string; name?: string | null }
  | { kind: "public" };

export type ClipsResult =
  | { ok: true; body: unknown }
  | { ok: false; code: ClipPlaybackErrorCode };

const CLIPS_REQUEST_TIMEOUT_MS = 10_000;

function hostnameOf(url: string | undefined): string | undefined {
  return url && URL.canParse(url) ? new URL(url).hostname : undefined;
}

/**
 * The Clips this Content talks to: the deployment's built-in Clips (local
 * Clips in the monorepo, the catalog URL or `builtinAgents.urls` when
 * hosted), on Content's own lane. Never a user's or organization's directory
 * entry: the token is signed for whatever URL this returns.
 */
export function resolveClipsAppUrl(): string | null {
  const clips = getBuiltinAgents("content").find((app) => app.id === "clips");
  if (!clips?.url || !URL.canParse(clips.url)) return null;
  return resolveLaneEndpoint(
    clips.url,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

/**
 * The Clips app URLs a pasted link may name. Beta and production Clips share
 * one database, so a link copied from either lane names the same Clip.
 */
export function clipsLinkOrigins(): string[] {
  const appUrl = resolveClipsAppUrl();
  if (!appUrl) return [];
  const url = new URL(appUrl);
  const lanes = resolveEnvironmentTargets(url.hostname);
  const origins = [appUrl];
  for (const host of lanes ? [lanes.betaHost, lanes.productionHost] : []) {
    const lane = new URL(appUrl);
    lane.hostname = host;
    origins.push(lane.toString().replace(/\/+$/, ""));
  }
  return [...new Set(origins)];
}

function readPeerSecret(): string | null {
  try {
    return resolveContentClipsPeerSecret(
      getAppConfig().clips,
      getGlobalA2ASecret(),
    );
  } catch (error) {
    if (!(error instanceof AppConfigurationError)) throw error;
    console.error(
      "[content-clips] peer secret configuration is invalid",
      error,
    );
    return null;
  }
}

export function scopeForReader(reader: ClipReader): ContentClipScope {
  return reader.kind === "public"
    ? CONTENT_CLIP_SCOPES.publicRead
    : CONTENT_CLIP_SCOPES.read;
}

/** The only place Content signs a Clips token. */
export async function mintContentClipToken(input: {
  reader: ClipReader;
  scope: ContentClipScope;
  documentId: string;
  recordingId: string;
  clipsAppUrl: string;
  secret: string;
}): Promise<string> {
  const { reader } = input;
  const subject =
    reader.kind === "public"
      ? CONTENT_CLIP_PUBLIC_READER
      : reader.email.trim().toLowerCase();
  const name =
    reader.kind === "signed-in" ? reader.name?.trim() || undefined : undefined;
  // No org domain and no preferGlobalSecret: either would let core sign with
  // a secret other apps hold.
  return signA2AToken(subject, undefined, input.secret, {
    expiresIn: "1m",
    audience: `${canonicalA2AAudience(input.clipsAppUrl)}/${CONTENT_CLIP_AUDIENCE_PATH}`,
    extraClaims: {
      scope: input.scope,
      [CONTENT_CLIP_CLAIMS.documentId]: input.documentId,
      [CONTENT_CLIP_CLAIMS.recordingId]: input.recordingId,
      ...(name ? { [CONTENT_CLIP_CLAIMS.viewerName]: name } : {}),
    },
  });
}

function failureFor(status: number, code: unknown): ClipPlaybackErrorCode {
  switch (status) {
    case 401:
      return CLIP_PLAYBACK_ERRORS.unauthorized;
    case 403:
      if (code === "password_required") {
        return CLIP_PLAYBACK_ERRORS.passwordRequired;
      }
      if (code === "comments_disabled") {
        return CLIP_PLAYBACK_ERRORS.commentsDisabled;
      }
      return CLIP_PLAYBACK_ERRORS.forbidden;
    case 404:
      return CLIP_PLAYBACK_ERRORS.notFound;
    case 409:
      return code === "redaction_pending"
        ? CLIP_PLAYBACK_ERRORS.redactionPending
        : CLIP_PLAYBACK_ERRORS.unreachable;
    case 410:
      return CLIP_PLAYBACK_ERRORS.expired;
    case 429:
      return CLIP_PLAYBACK_ERRORS.rateLimited;
    case 503:
      return code === CONTENT_CLIP_NOT_CONFIGURED
        ? CLIP_PLAYBACK_ERRORS.notConfigured
        : CLIP_PLAYBACK_ERRORS.unreachable;
    default:
      return CLIP_PLAYBACK_ERRORS.unreachable;
  }
}

type ClipsBody = { readable: true; value: unknown } | { readable: false };

async function readJson(response: Response): Promise<ClipsBody> {
  try {
    return { readable: true, value: await response.json() };
  } catch (error) {
    console.warn("[content-clips] Clips answered with a body that isn't JSON", {
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return { readable: false };
  }
}

/**
 * Asks Clips about one Clip on behalf of a reader whose access to the page
 * the caller has already checked.
 */
export async function requestClips(input: {
  reader: ClipReader;
  documentId: string;
  recordingId: string;
  resource: "playback" | "comments";
  query?: Record<string, string>;
}): Promise<ClipsResult> {
  const clipsAppUrl = resolveClipsAppUrl();
  const secret = readPeerSecret();
  if (!clipsAppUrl || !secret) {
    return { ok: false, code: CLIP_PLAYBACK_ERRORS.notConfigured };
  }

  const token = await mintContentClipToken({
    reader: input.reader,
    scope: scopeForReader(input.reader),
    documentId: input.documentId,
    recordingId: input.recordingId,
    clipsAppUrl,
    secret,
  });

  const search = input.query ? `?${new URLSearchParams(input.query)}` : "";
  let response: Response;
  try {
    response = await fetch(
      `${clipsAppUrl}/api/content-clips/${encodeURIComponent(input.recordingId)}/${input.resource}${search}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(CLIPS_REQUEST_TIMEOUT_MS),
      },
    );
  } catch (error) {
    console.warn("[content-clips] Clips request failed", {
      resource: input.resource,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: CLIP_PLAYBACK_ERRORS.unreachable };
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    const code =
      body.readable && body.value && typeof body.value === "object"
        ? (body.value as { code?: unknown }).code
        : undefined;
    return { ok: false, code: failureFor(response.status, code) };
  }
  if (!body.readable) {
    return { ok: false, code: CLIP_PLAYBACK_ERRORS.unreachable };
  }
  return { ok: true, body: body.value };
}
