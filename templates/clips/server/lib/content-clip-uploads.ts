/**
 * Uploads from an Agent-Native Content document. Content vouches, with an
 * upload-scoped token, for an editor of one document; Clips makes a private
 * recording owned by that editor, binds it to the document as an upload, and
 * hands back a ticketed chunk URL the editor's browser posts the file to, and
 * a cancel URL it calls when the page gives the upload up. Content's server
 * never carries the video. The contract is in
 * `shared/content-clip-contract.ts`.
 */
import { isActionContractError } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getAppConfig,
  getAppProductionUrl,
  readBodyWithSizeLimit,
  runWithRequestContext,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq } from "drizzle-orm";
import {
  getQuery,
  getRequestHeader,
  getRouterParam,
  HTTPError,
  type H3Event,
} from "h3";
import { z } from "zod";

import {
  CONTENT_CLIP_CANCEL_OUTCOME,
  CONTENT_CLIP_CLAIMS,
  CONTENT_CLIP_SCOPES,
  CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS,
  CONTENT_CLIP_UPLOAD_MIME_TYPES,
  CONTENT_CLIP_UPLOAD_REFUSED,
  type ContentClipCancelAnswer,
  type ContentClipStorage,
} from "../../shared/content-clip-contract.js";
import { getDb, schema } from "../db/index.js";
import { handleAbortRecordingUpload } from "../routes/api/uploads/[recordingId]/abort.post.js";
import { handleRecordingChunk } from "../routes/api/uploads/[recordingId]/chunk.post.js";
import {
  PRIVATE_HEADERS,
  verifyContentPeerToken,
  type VerifiedContentPeer,
} from "./content-clip-peer.js";
import { isActiveUploadBinding } from "./content-uploads.js";
import { startRecordingUpload } from "./recording-upload-start.js";
import {
  requireUploadTicketOwnerForToken,
  verifyRecordingUploadTicket,
} from "./recording-upload-ticket.js";
import { nanoid, ownerEmailMatches } from "./recordings.js";
import { getClipsVideoStorageStatus } from "./video-storage.js";

const MAX_START_BODY_BYTES = 4 * 1024;
const MAX_CLIENT_IP_CHARS = 64;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface Uploader {
  peer: VerifiedContentPeer;
  email: string;
  name: string | null;
  /** Content's edge address for the uploader, for free storage's network cap. */
  requestHeaders: Headers;
}

interface UploaderAccount {
  userId: string;
  orgId: string;
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      ...PRIVATE_HEADERS,
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function refused(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error: code, code, ...extra }, status);
}

async function verifyUploader(event: H3Event): Promise<Uploader | Response> {
  const peer = await verifyContentPeerToken(event, [
    CONTENT_CLIP_SCOPES.upload,
  ]);
  if (peer instanceof Response) return peer;
  // An upload names no Clip: Clips makes it.
  if (CONTENT_CLIP_CLAIMS.recordingId in peer.claims || !peer.viewerEmail) {
    return json({ error: "Unauthorized" }, 401);
  }
  const clientIp = peer.claims[CONTENT_CLIP_CLAIMS.clientIp];
  const requestHeaders = new Headers();
  if (
    typeof clientIp === "string" &&
    clientIp.length <= MAX_CLIENT_IP_CHARS &&
    !/[\s\p{Cc}]/u.test(clientIp)
  ) {
    requestHeaders.set("x-nf-client-connection-ip", clientIp);
  }
  return {
    peer,
    email: peer.viewerEmail,
    name: peer.viewerName,
    requestHeaders,
  };
}

/**
 * The editor's Clips account and workspace, or null when either is missing.
 * Clips never makes either one here: the editor signs up in Clips, which
 * makes their workspace the first time they open it.
 */
async function readUploaderAccount(
  email: string,
): Promise<UploaderAccount | null> {
  const { rows } = await getDbExec().execute({
    sql: 'SELECT id FROM "user" WHERE lower(email) = ? LIMIT 1',
    args: [email.toLowerCase()],
  });
  const userId = (rows[0] as { id?: unknown } | undefined)?.id;
  if (typeof userId !== "string" || !userId) return null;
  const orgId = await resolveOrgIdForEmail(email);
  return orgId ? { userId, orgId } : null;
}

async function runAsUploader<T>(
  uploader: Uploader,
  account: UploaderAccount,
  fn: () => Promise<T>,
): Promise<T> {
  return await runWithRequestContext(
    {
      userEmail: uploader.email,
      userName: uploader.name ?? undefined,
      orgId: account.orgId,
      authUserId: account.userId,
    },
    fn,
  );
}

type StorageStatus = Awaited<ReturnType<typeof getClipsVideoStorageStatus>>;

/** What `create-recording` would do with a new upload, as Content shows it. */
export function contentClipStorageFor(
  status: StorageStatus,
): ContentClipStorage {
  if (status.mode === "own") {
    return {
      state: "ready",
      provider: status.activeProvider?.id === "builder" ? "builder" : "custom",
    };
  }
  // A local development Clips buffers chunks in SQL before any free clip.
  if (status.localSqlChunkScratchAvailable) {
    return { state: "ready", provider: "local" };
  }
  if (status.mode === "hosted") {
    return {
      state: "free",
      remaining: status.hostedRemaining,
      limit: status.hostedLimit,
      maxClipBytes: status.maxClipBytes,
    };
  }
  if (status.denyReason === "exhausted") {
    return { state: "used_up", limit: status.hostedLimit };
  }
  return { state: "none", reason: status.denyReason };
}

async function readStorage(
  uploader: Uploader,
  account: UploaderAccount,
): Promise<ContentClipStorage> {
  return contentClipStorageFor(
    await getClipsVideoStorageStatus({
      email: uploader.email,
      userId: account.userId,
      requestHeaders: uploader.requestHeaders,
    }),
  );
}

export async function handleContentClipUploadStatus(
  event: H3Event,
): Promise<Response> {
  const uploader = await verifyUploader(event);
  if (uploader instanceof Response) return uploader;
  const account = await readUploaderAccount(uploader.email);
  if (!account) return json({ storage: { state: "account_required" } });
  const storage = await runAsUploader(uploader, account, () =>
    readStorage(uploader, account),
  );
  return json({ storage });
}

const uploadStartSchema = z
  .object({
    fileName: z.string().trim().min(1).max(CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS),
    sizeBytes: z.number().int().positive(),
    mimeType: z.enum(CONTENT_CLIP_UPLOAD_MIME_TYPES),
    blockId: z.string().regex(BLOCK_ID),
  })
  .strict();

/** The file's name without its extension, which Clips titles the Clip with. */
function titleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
  return (title || fileName).replace(/[\p{Cc}]/gu, " ");
}

function uploadUrlFor(
  recordingId: string,
  route: "content-chunk" | "content-cancel",
  query: URLSearchParams,
): string {
  const base = withConfiguredAppBasePath(getAppProductionUrl());
  return `${base}/api/uploads/${encodeURIComponent(recordingId)}/${route}?${query}`;
}

const invalidStart = () => json({ error: "Invalid upload request" }, 400);

async function readUploadStart(
  event: H3Event,
): Promise<z.infer<typeof uploadStartSchema> | Response> {
  let body: unknown;
  try {
    body = await readBodyWithSizeLimit(event, MAX_START_BODY_BYTES);
  } catch (error) {
    if ((error as { statusCode?: unknown }).statusCode === 413) {
      return json({ error: "Upload request too large" }, 413);
    }
    if (error instanceof SyntaxError) return invalidStart();
    throw error;
  }
  const parsed = uploadStartSchema.safeParse(body);
  return parsed.success ? parsed.data : invalidStart();
}

async function deleteBinding(id: string): Promise<void> {
  await getDb()
    .delete(schema.recordingContentBindings)
    .where(eq(schema.recordingContentBindings.id, id))
    .catch((error: unknown) => {
      console.warn("[content-clip-uploads] binding cleanup failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/** An upload start Clips refused for a reason Content shows, or null. */
async function refusedStart(
  error: unknown,
  readCurrentStorage: () => Promise<ContentClipStorage>,
): Promise<Response | null> {
  if (error instanceof HTTPError && error.status === 429) {
    return refused(429, CONTENT_CLIP_UPLOAD_REFUSED.tooMany);
  }
  if (!isActionContractError(error)) return null;
  if (error.errorCode === "upload_too_large") {
    return refused(413, CONTENT_CLIP_UPLOAD_REFUSED.tooLarge, {
      maxBytes: error.details?.maxUploadBytes,
    });
  }
  // Storage went away, or the last free clip went, between the check and
  // the reservation.
  if (error.statusCode === 402 || error.statusCode === 403) {
    return refused(409, CONTENT_CLIP_UPLOAD_REFUSED.storageRequired, {
      storage: await readCurrentStorage(),
    });
  }
  return null;
}

export async function handleContentClipUploadStart(
  event: H3Event,
): Promise<Response> {
  const uploader = await verifyUploader(event);
  if (uploader instanceof Response) return uploader;
  const start = await readUploadStart(event);
  if (start instanceof Response) return start;

  const account = await readUploaderAccount(uploader.email);
  if (!account) {
    return refused(409, CONTENT_CLIP_UPLOAD_REFUSED.storageRequired, {
      storage: { state: "account_required" },
    });
  }

  return runAsUploader(uploader, account, async () => {
    const storage = await readStorage(uploader, account);
    if (storage.state !== "ready" && storage.state !== "free") {
      return refused(409, CONTENT_CLIP_UPLOAD_REFUSED.storageRequired, {
        storage,
      });
    }
    const maxBytes =
      storage.state === "free" ? storage.maxClipBytes : MAX_UPLOAD_BYTES;
    if (start.sizeBytes > maxBytes) {
      return refused(413, CONTENT_CLIP_UPLOAD_REFUSED.tooLarge, { maxBytes });
    }

    // The binding comes first, so the recording is never without the
    // document that may show it.
    const recordingId = nanoid();
    const bindingId = nanoid(16);
    const now = new Date().toISOString();
    await getDb().insert(schema.recordingContentBindings).values({
      id: bindingId,
      recordingId,
      contentApp: uploader.peer.contentApp,
      documentId: uploader.peer.documentId,
      blockId: start.blockId,
      origin: "upload",
      state: "active",
      stateChangedAt: now,
      createdBy: uploader.email,
      createdAt: now,
      updatedAt: now,
    });

    let upload: Awaited<ReturnType<typeof startRecordingUpload>>;
    try {
      upload = await startRecordingUpload(
        {
          recordingId,
          title: titleFromFileName(start.fileName),
          visibility: "private",
          mimeType: start.mimeType,
          sizeBytes: start.sizeBytes,
          recordingSource: "file_upload",
        },
        {
          caller: "a2a",
          networkProtocol: "a2a",
          userEmail: uploader.email,
          orgId: account.orgId,
          requestHeaders: uploader.requestHeaders,
        },
      );
    } catch (error) {
      await deleteBinding(bindingId);
      const response = await refusedStart(error, () =>
        readStorage(uploader, account),
      );
      if (response) return response;
      throw error;
    }

    upload.chunkQuery.set("ticket", upload.ticket);
    return json({
      recordingId,
      chunkUrl: uploadUrlFor(recordingId, "content-chunk", upload.chunkQuery),
      cancelUrl: uploadUrlFor(
        recordingId,
        "content-cancel",
        new URLSearchParams({ ticket: upload.ticket }),
      ),
      chunkSizeBytes: upload.chunkSizeBytes,
      totalChunks: upload.totalChunks,
      expiresAt: upload.expiresAt,
    });
  });
}

function hostnameOf(url: string | undefined): string | undefined {
  return url && URL.canParse(url) ? new URL(url).hostname : undefined;
}

/**
 * The one Content origin whose pages may post a document's upload chunks:
 * the deployment's built-in Content, on Clips' own lane. Never a directory
 * entry, and never the request's own `Origin`.
 */
export function pairedContentOrigin(): string | null {
  const content = getBuiltinAgents("clips").find((app) => app.id === "content");
  if (!content?.url || !URL.canParse(content.url)) return null;
  const url = resolveLaneEndpoint(
    content.url,
    hostnameOf(getAppConfig().app.url),
  );
  return URL.canParse(url) ? new URL(url).origin : null;
}

const CORS_HEADER_NAMES = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
];

/** The binding to the Content page a recording was uploaded from, if it was. */
async function uploadBinding(
  recordingId: string,
): Promise<{ origin: string; state: string } | null> {
  const bindings = schema.recordingContentBindings;
  const [binding] = await getDb()
    .select({ origin: bindings.origin, state: bindings.state })
    .from(bindings)
    .where(
      and(eq(bindings.recordingId, recordingId), eq(bindings.origin, "upload")),
    )
    .limit(1);
  return binding ?? null;
}

function firstQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return typeof value === "string" && value ? value : null;
}

const CONTENT_UPLOAD_PATH = /\/api\/uploads\/[^/]+\/content-(chunk|cancel)$/;

/**
 * The chunk and cancel routes' answer to a preflight. The auth guard would
 * answer it with the app-wide CORS policy, which can allow other origins and
 * credentials, so the middleware asks here first. Content's requests never
 * need one; a preflight gets the same policy they do.
 */
export function answerContentChunkPreflight(
  event: H3Event,
): Response | undefined {
  if (
    event.req.method !== "OPTIONS" ||
    !CONTENT_UPLOAD_PATH.test(event.url.pathname)
  ) {
    return undefined;
  }
  const origin = getRequestHeader(event, "origin");
  if (!origin || origin !== pairedContentOrigin()) {
    return new Response(null, { status: 403, headers: { vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      vary: "Origin",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST",
    },
  });
}

/**
 * The CORS answer to a request from the editor's browser: the paired
 * Content's origin alone, never credentials, whatever the auth guard set.
 */
function contentUploadCors(event: H3Event): Record<string, string> | Response {
  const responseHeaders = event.res.headers;
  for (const name of CORS_HEADER_NAMES) responseHeaders.delete(name);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    responseHeaders.set(name, value);
  }
  const origin = getRequestHeader(event, "origin");
  const cors: Record<string, string> = { vary: "Origin" };
  responseHeaders.set("vary", "Origin");
  if (origin) {
    if (origin !== pairedContentOrigin()) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }
    cors["access-control-allow-origin"] = origin;
    responseHeaders.set("access-control-allow-origin", origin);
  }
  return cors;
}

/**
 * One chunk of a document's upload, posted by the editor's browser from the
 * paired Content. The ticket in the URL is the only authority: the request
 * carries no cookie, and the answer never allows credentials. Content sends
 * it as a CORS simple request, so it needs no preflight.
 */
export async function handleContentClipChunk(event: H3Event): Promise<unknown> {
  const cors = contentUploadCors(event);
  if (cors instanceof Response) return cors;

  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) return json({ error: "Not found" }, 404, cors);
  try {
    const owner = await requireUploadTicketOwnerForToken(
      recordingId,
      firstQueryValue(getQuery(event).ticket),
    );
    const binding = await uploadBinding(recordingId);
    if (!binding) {
      return json({ error: "Invalid or expired upload ticket" }, 401, cors);
    }
    if (!isActiveUploadBinding(binding)) {
      return json({ error: "This upload's page is in Trash" }, 409, cors);
    }
    return await handleRecordingChunk(event, owner);
  } catch (error) {
    if (!HTTPError.isError(error)) throw error;
    return json(
      { error: error.message, ...(error.data ? { data: error.data } : {}) },
      error.status,
      cors,
    );
  }
}

/**
 * Gives up a document's upload at once, from the editor's browser, when the
 * page can no longer use it: its block is gone, the editor lost edit access,
 * or the file stopped sending. Clips' own abort fails the recording and
 * releases its free clip, as the lease reaper would an hour later. The ticket
 * is the only authority, as for a chunk, and a repeat answers the same.
 */
export async function handleContentClipCancel(
  event: H3Event,
): Promise<unknown> {
  const cors = contentUploadCors(event);
  if (cors instanceof Response) return cors;

  const recordingId = getRouterParam(event, "recordingId");
  const token = firstQueryValue(getQuery(event).ticket);
  const verified =
    recordingId && token
      ? await verifyRecordingUploadTicket(recordingId, token)
      : null;
  // A page in Trash can still give its upload up: cancelling only frees it.
  if (!recordingId || !verified || !(await uploadBinding(recordingId))) {
    return json({ error: "Invalid or expired upload ticket" }, 401, cors);
  }
  const readRecording = async () => {
    const [row] = await getDb()
      .select({
        status: schema.recordings.status,
        organizationId: schema.recordings.organizationId,
        uploadAttemptId: schema.recordings.uploadAttemptId,
        uploadGenerationId: schema.recordings.uploadGenerationId,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, verified.ownerEmail),
        ),
      );
    return row ?? null;
  };
  const recording = await readRecording();
  if (!recording) return json({ error: "Not found" }, 404, cors);
  const settled = cancelAnswer(recordingId, recording.status, cors);
  if (settled) return settled;

  const result = (await handleAbortRecordingUpload(event, {
    recordingId,
    ownerEmail: verified.ownerEmail,
    orgId: recording.organizationId,
    authUserId:
      typeof verified.ticket.authUserId === "string"
        ? verified.ticket.authUserId
        : undefined,
    body: {
      failureCode: "upload_aborted",
      reason: "The Content page gave up this upload.",
      attemptId: recording.uploadAttemptId ?? undefined,
      uploadGenerationId: recording.uploadGenerationId ?? undefined,
    },
  })) as Record<string, unknown>;
  // The abort answers ok without failing the recording when Clips got the
  // whole file first, so only the recording's status says what happened.
  const after = await readRecording();
  if (!after) return json({ error: "Not found" }, 404, cors);
  const answer = cancelAnswer(recordingId, after.status, cors);
  if (answer) return answer;
  if (result.ok === true) {
    return json({ error: "Clips didn't cancel this upload" }, 409, cors);
  }
  return json(result, event.res.status ?? 409, cors);
}

/** What a cancel did, once the recording has left `uploading`. */
function cancelAnswer(
  recordingId: string,
  status: string,
  cors: Record<string, string>,
): Response | null {
  if (status === "failed") {
    const cancelled: ContentClipCancelAnswer = {
      outcome: CONTENT_CLIP_CANCEL_OUTCOME.cancelled,
      recordingId,
    };
    return json(cancelled, 200, cors);
  }
  if (status === "processing" || status === "ready") {
    const finished: ContentClipCancelAnswer = {
      outcome: CONTENT_CLIP_CANCEL_OUTCOME.alreadyFinished,
      recordingId,
      status,
    };
    return json(
      { error: "This upload is already finished", ...finished },
      409,
      cors,
    );
  }
  return null;
}
