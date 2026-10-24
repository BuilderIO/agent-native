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
import { readBoundedResponseBytes } from "@agent-native/core/ingestion";
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
  CLIP_UPLOAD_ERRORS,
  CONTENT_CLIP_AUDIENCE_PATH,
  CONTENT_CLIP_CLAIMS,
  CONTENT_CLIP_COMMENT_AUTHOR_CHARS,
  CONTENT_CLIP_COMMENT_PREVIEW_CHARS,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
  CONTENT_CLIP_NOT_CONFIGURED,
  CONTENT_CLIP_PUBLIC_READER,
  CONTENT_CLIP_SCOPES,
  type ClipPlaybackErrorCode,
  type ClipUploadErrorCode,
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

// The longest thread start Clips sends: its cut fields with every character
// escaped to six bytes (`\u0001`), an id at the 128 characters Clips takes
// for one, and room for the keys and timestamp.
const MAX_COMMENT_THREAD_BYTES =
  6 *
    (CONTENT_CLIP_COMMENT_PREVIEW_CHARS +
      2 * CONTENT_CLIP_COMMENT_AUTHOR_CHARS) +
  128 +
  256;

/**
 * The most Content reads of each answer: the longest one the contract allows,
 * with margin. A playback answer is a title Clips cuts to
 * `CONTENT_CLIP_RECORDING_TITLE_CHARS`, two URLs and a few short fields.
 */
export const CLIPS_ANSWER_MAX_BYTES = {
  playback: 64 * 1024,
  comments:
    CONTENT_CLIP_MAX_COMMENT_THREADS * MAX_COMMENT_THREAD_BYTES + 64 * 1024,
} as const;

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

/** The scopes a reader's token may carry; only an editor's may upload. */
type ClipReaderScope = Exclude<
  ContentClipScope,
  typeof CONTENT_CLIP_SCOPES.upload
>;

export function scopeForReader(reader: ClipReader): ClipReaderScope {
  return reader.kind === "public"
    ? CONTENT_CLIP_SCOPES.publicRead
    : CONTENT_CLIP_SCOPES.read;
}

export type ClipUploader = Extract<ClipReader, { kind: "signed-in" }>;

type ClipTokenFor =
  | {
      reader: ClipReader;
      scope: ClipReaderScope;
      recordingId: string;
    }
  | {
      reader: ClipUploader;
      scope: typeof CONTENT_CLIP_SCOPES.upload;
      /** The uploader's address as Content's edge saw it, when it did. */
      clientIp?: string | null;
    };

/** The only place Content signs a Clips token. */
export async function mintContentClipToken(
  input: ClipTokenFor & {
    documentId: string;
    clipsAppUrl: string;
    secret: string;
  },
): Promise<string> {
  const { reader } = input;
  const subject =
    reader.kind === "public"
      ? CONTENT_CLIP_PUBLIC_READER
      : reader.email.trim().toLowerCase();
  const name =
    reader.kind === "signed-in" ? reader.name?.trim() || undefined : undefined;
  // An upload token names no recording: Clips makes one for it.
  const target =
    input.scope === CONTENT_CLIP_SCOPES.upload
      ? input.clientIp
        ? { [CONTENT_CLIP_CLAIMS.clientIp]: input.clientIp }
        : {}
      : { [CONTENT_CLIP_CLAIMS.recordingId]: input.recordingId };
  // No org domain and no preferGlobalSecret: either would let core sign with
  // a secret other apps hold.
  return signA2AToken(subject, undefined, input.secret, {
    expiresIn: "1m",
    audience: `${canonicalA2AAudience(input.clipsAppUrl)}/${CONTENT_CLIP_AUDIENCE_PATH}`,
    extraClaims: {
      scope: input.scope,
      [CONTENT_CLIP_CLAIMS.documentId]: input.documentId,
      ...target,
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

async function readJson(
  response: Response,
  maxBytes: number,
): Promise<ClipsBody> {
  try {
    const bytes = await readBoundedResponseBytes(response, maxBytes);
    return {
      readable: true,
      value: JSON.parse(new TextDecoder().decode(bytes)),
    };
  } catch (error) {
    console.warn(
      "[content-clips] Clips answered with a body Content can't read",
      {
        status: response.status,
        maxBytes,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { readable: false };
  }
}

type ClipsAnswer =
  | { reachable: true; status: number; body: ClipsBody }
  | { reachable: false };

async function fetchClips(input: {
  url: string;
  token: string;
  maxBytes: number;
  /** Sent as JSON with a POST; a GET when absent. */
  json?: unknown;
}): Promise<ClipsAnswer> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.json === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/json",
        ...(input.json === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(input.json === undefined ? {} : { body: JSON.stringify(input.json) }),
      redirect: "manual",
      signal: AbortSignal.timeout(CLIPS_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn("[content-clips] Clips request failed", {
      path: new URL(input.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reachable: false };
  }
  return {
    reachable: true,
    status: response.status,
    body: await readJson(response, input.maxBytes),
  };
}

function codeOf(body: ClipsBody): unknown {
  return body.readable && body.value && typeof body.value === "object"
    ? (body.value as { code?: unknown }).code
    : undefined;
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
  const answer = await fetchClips({
    url: `${clipsAppUrl}/api/content-clips/${encodeURIComponent(input.recordingId)}/${input.resource}${search}`,
    token,
    maxBytes: CLIPS_ANSWER_MAX_BYTES[input.resource],
  });
  if (!answer.reachable) {
    return { ok: false, code: CLIP_PLAYBACK_ERRORS.unreachable };
  }
  if (answer.status !== 200) {
    return { ok: false, code: failureFor(answer.status, codeOf(answer.body)) };
  }
  if (!answer.body.readable) {
    return { ok: false, code: CLIP_PLAYBACK_ERRORS.unreachable };
  }
  return { ok: true, body: answer.body.value };
}

/** An upload answer is a storage state or a ticket: a few short fields. */
const CLIPS_UPLOAD_ANSWER_MAX_BYTES = 16 * 1024;

/**
 * The statuses an upload answer may have: 200, or a start Clips refused for
 * storage (409) or size (413). Any other is a failure.
 */
const UPLOAD_ANSWER_STATUSES: ReadonlySet<number> = new Set([200, 409, 413]);

export type ClipsUploadAnswer =
  | { ok: true; status: number; body: unknown }
  | { ok: false; code: ClipUploadErrorCode };

export interface ClipUploadStart {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  blockId: string;
}

/**
 * Asks Clips, for an editor whose edit access to the page the caller has
 * already checked, where their uploads would go, or to start one. The video
 * itself never passes through Content.
 */
export async function requestClipsUpload(input: {
  uploader: ClipUploader;
  documentId: string;
  clientIp: string | null;
  start?: ClipUploadStart;
}): Promise<ClipsUploadAnswer> {
  const clipsAppUrl = resolveClipsAppUrl();
  const secret = readPeerSecret();
  if (!clipsAppUrl || !secret) {
    return { ok: false, code: CLIP_UPLOAD_ERRORS.notConfigured };
  }

  const token = await mintContentClipToken({
    reader: input.uploader,
    scope: CONTENT_CLIP_SCOPES.upload,
    documentId: input.documentId,
    clientIp: input.clientIp,
    clipsAppUrl,
    secret,
  });

  const answer = await fetchClips({
    url: `${clipsAppUrl}/api/content-clips/${input.start ? "uploads" : "upload-status"}`,
    token,
    maxBytes: CLIPS_UPLOAD_ANSWER_MAX_BYTES,
    json: input.start,
  });
  if (!answer.reachable) {
    return { ok: false, code: CLIP_UPLOAD_ERRORS.unreachable };
  }
  switch (answer.status) {
    case 401:
      return { ok: false, code: CLIP_UPLOAD_ERRORS.unauthorized };
    case 429:
      return { ok: false, code: CLIP_UPLOAD_ERRORS.rateLimited };
    case 503:
      if (codeOf(answer.body) === CONTENT_CLIP_NOT_CONFIGURED) {
        return { ok: false, code: CLIP_UPLOAD_ERRORS.notConfigured };
      }
  }
  if (!UPLOAD_ANSWER_STATUSES.has(answer.status) || !answer.body.readable) {
    return { ok: false, code: CLIP_UPLOAD_ERRORS.unreachable };
  }
  return { ok: true, status: answer.status, body: answer.body.value };
}
