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
import { and, eq, isNull } from "drizzle-orm";
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
  CONTENT_CLIP_CHUNK_FINISHING,
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
import {
  claimFinalChunk,
  readUploadPhase,
  recordFinalChunkOutcome,
  releaseFinalChunk,
  type UploadStanding,
} from "./final-chunk-claim.js";
import {
  reissueRecordingUpload,
  startRecordingUpload,
  type RecordingUploadStart,
} from "./recording-upload-start.js";
import {
  RESERVATION_GRACE_MS,
  requireUploadTicketOwnerForToken,
  verifyRecordingUploadTicket,
  type RecordingUploadTicketOwner,
} from "./recording-upload-ticket.js";
import { nanoid, ownerEmailMatches } from "./recordings.js";
import { getClipsVideoStorageStatus } from "./video-storage.js";

const MAX_START_BODY_BYTES = 4 * 1024;
const MAX_CLIENT_IP_CHARS = 64;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UPLOAD_KEY = /^[A-Za-z0-9_-]{16,64}$/;

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
    /** One per file the editor picks: a repeated start reaches its upload. */
    uploadKey: z.string().regex(UPLOAD_KEY),
  })
  .strict();

type UploadStart = z.infer<typeof uploadStartSchema>;

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
): Promise<UploadStart | Response> {
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

/**
 * Marks a binding whose start failed without saying it left nothing. If it
 * left no recording, the next repeat starts it again under the same recording
 * id; a recording it left answers for itself.
 */
async function markStartFailed(id: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .update(schema.recordingContentBindings)
    .set({ uploadStartFailedAt: now, updatedAt: now })
    .where(eq(schema.recordingContentBindings.id, id))
    .catch((error: unknown) => {
      // Unmarked, the binding is taken over once it is stale instead.
      console.warn("[content-clip-uploads] failed start not marked", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * An upload start Clips refused for a reason Content shows, or null. Each
 * is raised before a recording or a free clip is made.
 */
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

function startAnswer(upload: RecordingUploadStart): Response {
  upload.chunkQuery.set("ticket", upload.ticket);
  return json({
    recordingId: upload.recordingId,
    chunkUrl: uploadUrlFor(
      upload.recordingId,
      "content-chunk",
      upload.chunkQuery,
    ),
    cancelUrl: uploadUrlFor(
      upload.recordingId,
      "content-cancel",
      new URLSearchParams({ ticket: upload.ticket }),
    ),
    chunkSizeBytes: upload.chunkSizeBytes,
    totalChunks: upload.totalChunks,
    expiresAt: upload.expiresAt,
  });
}

const keyUsed = () => refused(409, CONTENT_CLIP_UPLOAD_REFUSED.keyUsed);
const uploadStarting = () =>
  refused(409, CONTENT_CLIP_UPLOAD_REFUSED.uploadStarting);

/** A start's binding, which its recording is made for. */
interface BoundStart {
  id: string;
  recordingId: string;
}

/** A bound start with no recording, which failed or stalled. */
interface StalledStart extends BoundStart {
  updatedAt: string;
  uploadStartFailedAt: string | null;
}

/**
 * The answer to a start Content repeated for a file it already started: that
 * upload, never a second recording. A start that failed or stalled before
 * its recording comes back for this one to take over. Null when the key is
 * new.
 */
async function repeatedStart(
  uploader: Uploader,
  start: UploadStart,
): Promise<Response | StalledStart | null> {
  const bindings = schema.recordingContentBindings;
  const [binding] = await getDb()
    .select({
      id: bindings.id,
      recordingId: bindings.recordingId,
      blockId: bindings.blockId,
      uploadMimeType: bindings.uploadMimeType,
      uploadSizeBytes: bindings.uploadSizeBytes,
      uploadStartFailedAt: bindings.uploadStartFailedAt,
      updatedAt: bindings.updatedAt,
    })
    .from(bindings)
    .where(
      and(
        eq(bindings.contentApp, uploader.peer.contentApp),
        eq(bindings.documentId, uploader.peer.documentId),
        eq(bindings.createdBy, uploader.email),
        eq(bindings.uploadKey, start.uploadKey),
      ),
    );
  if (!binding) return null;
  if (
    binding.blockId !== start.blockId ||
    binding.uploadMimeType !== start.mimeType ||
    binding.uploadSizeBytes !== start.sizeBytes
  ) {
    return keyUsed();
  }
  const standing = await readUploadPhase(binding.recordingId, uploader.email);
  if (!standing) {
    // The latest start bound the key and is making its recording, unless it
    // failed or stalled.
    return binding.uploadStartFailedAt !== null ||
      Date.now() - Date.parse(binding.updatedAt) >= RESERVATION_GRACE_MS
      ? binding
      : uploadStarting();
  }
  if (standing.phase === "finishing" || standing.phase === "finished") {
    return refused(409, CONTENT_CLIP_UPLOAD_REFUSED.alreadyFinished, {
      recordingId: binding.recordingId,
      status: standing.status === "ready" ? "ready" : "processing",
    });
  }
  // An upload that ended stays ended, a marked start's included: the file
  // starts again under a new key.
  if (standing.phase !== "uploading") return keyUsed();
  return startAnswer(
    await reissueRecordingUpload({
      recordingId: binding.recordingId,
      mimeType: binding.uploadMimeType,
      sizeBytes: binding.uploadSizeBytes,
    }),
  );
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
    // Before the storage check: the first start may have taken the last free
    // clip, and a start taken over may hold the one it goes on with.
    const repeated = await repeatedStart(uploader, start);
    if (repeated instanceof Response) return repeated;
    const bound = repeated
      ? await takeOverStart(repeated)
      : await bindNewStart(uploader, account, start);
    if (bound instanceof Response) return bound;

    let upload: Awaited<ReturnType<typeof startRecordingUpload>>;
    try {
      upload = await startRecordingUpload(
        {
          recordingId: bound.recordingId,
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
      const response = await refusedStart(error, () =>
        readStorage(uploader, account),
      );
      // Any other failure may have left a recording or a free clip under
      // this id, so the binding stays for a repeat to start it again.
      const leftNothing =
        response !== null ||
        (isActionContractError(error) &&
          error.details?.cleanupConfirmed === true);
      await (leftNothing ? deleteBinding(bound.id) : markStartFailed(bound.id));
      if (response) return response;
      throw error;
    }

    return startAnswer(upload);
  });
}

/**
 * Checks where a new start's file would go, then binds its key before the
 * recording is made, so the recording is never without the document that
 * may show it.
 */
async function bindNewStart(
  uploader: Uploader,
  account: UploaderAccount,
  start: UploadStart,
): Promise<BoundStart | Response> {
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

  const recordingId = nanoid();
  const bindingId = nanoid(16);
  const now = new Date().toISOString();
  const bindings = schema.recordingContentBindings;
  const [bound] = await getDb()
    .insert(bindings)
    .values({
      id: bindingId,
      recordingId,
      contentApp: uploader.peer.contentApp,
      documentId: uploader.peer.documentId,
      blockId: start.blockId,
      origin: "upload",
      state: "active",
      stateChangedAt: now,
      createdBy: uploader.email,
      uploadKey: start.uploadKey,
      uploadMimeType: start.mimeType,
      uploadSizeBytes: start.sizeBytes,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        bindings.contentApp,
        bindings.documentId,
        bindings.createdBy,
        bindings.uploadKey,
      ],
    })
    .returning({ id: bindings.id });
  if (bound) return { id: bound.id, recordingId };
  // A start with the same key bound first, since the lookup above.
  const repeated = await repeatedStart(uploader, start);
  if (repeated instanceof Response) return repeated;
  return repeated ? await takeOverStart(repeated) : keyUsed();
}

/**
 * Takes over a start that failed or stalled, for this one to make its
 * recording under the same id. Clips reserves a free clip per recording id,
 * so a retake never holds a second. Of repeats that read the same binding,
 * one takes it; the rest are told it is starting.
 */
async function takeOverStart(
  stalled: StalledStart,
): Promise<BoundStart | Response> {
  const bindings = schema.recordingContentBindings;
  const [taken] = await getDb()
    .update(bindings)
    .set({ uploadStartFailedAt: null, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(bindings.id, stalled.id),
        eq(bindings.updatedAt, stalled.updatedAt),
        stalled.uploadStartFailedAt === null
          ? isNull(bindings.uploadStartFailedAt)
          : eq(bindings.uploadStartFailedAt, stalled.uploadStartFailedAt),
      ),
    )
    .returning({ id: bindings.id });
  return taken
    ? { id: stalled.id, recordingId: stalled.recordingId }
    : uploadStarting();
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
  const { isFinal } = getQuery(event);
  const final = isFinal === "1" || isFinal === "true";
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
    if (final) return await takeFinalChunk(event, owner, cors);
    return await handleRecordingChunk(event, owner);
  } catch (error) {
    if (!HTTPError.isError(error)) throw error;
    // The ticket's own refusal of an upload Clips is making the Clip of.
    const status = (error.data as { status?: unknown } | undefined)?.status;
    if (
      final &&
      error.status === 409 &&
      (status === "processing" || status === "ready")
    ) {
      return json(finishedChunk(recordingId, status), 200, cors);
    }
    return json(
      { error: error.message, ...(error.data ? { data: error.data } : {}) },
      error.status,
      cors,
    );
  }
}

/** What a final chunk sent again after Clips took the first one answers. */
function finishedChunk(recordingId: string, status: "processing" | "ready") {
  return { ok: true, finalized: true, id: recordingId, status };
}

/**
 * The final chunk, claimed before Clips takes its bytes: a cancel or another
 * send of it that comes while the claim holds is asked to try again, and a
 * cancel that came before it refuses the chunk. A chunk Clips accepts
 * records where the upload went before the claim comes off; one that fails
 * leaves it uploading. A final chunk sent again after that answers with the
 * first one's success, and Clips takes nothing more.
 */
async function takeFinalChunk(
  event: H3Event,
  owner: RecordingUploadTicketOwner,
  cors: Record<string, string>,
): Promise<unknown> {
  const asOwner = <T>(run: () => Promise<T>) =>
    runWithRequestContext(
      {
        userEmail: owner.ownerEmail,
        orgId: owner.orgId,
        authUserId: owner.authUserId,
      },
      run,
    );
  const { recordingId } = owner;
  const taken = await asOwner(() =>
    claimFinalChunk(recordingId, owner.ownerEmail),
  );
  if (!taken || ("phase" in taken && taken.phase === "ended")) {
    return json({ error: "This upload was cancelled" }, 409, cors);
  }
  if ("phase" in taken) {
    if (taken.phase === "finishing") {
      return json(
        {
          error: "This upload is finishing. Try again.",
          outcome: CONTENT_CLIP_CHUNK_FINISHING,
          recordingId,
        },
        409,
        cors,
      );
    }
    if (taken.phase === "parked") {
      return json(
        {
          ok: true,
          finalized: false,
          waitingForStorage: true,
          status: "waiting_storage",
          id: recordingId,
        },
        202,
        cors,
      );
    }
    return json(
      finishedChunk(
        recordingId,
        taken.status === "ready" ? "ready" : "processing",
      ),
      200,
      cors,
    );
  }
  const { claim } = taken;
  try {
    const answer = (await handleRecordingChunk(event, owner)) as {
      ok?: unknown;
      waitingForStorage?: unknown;
    } | null;
    if (answer?.ok === true) {
      await asOwner(() =>
        recordFinalChunkOutcome(
          owner.recordingId,
          answer.waitingForStorage === true ? "parked" : "finished",
        ),
      );
    }
    return answer;
  } finally {
    await asOwner(() => releaseFinalChunk(owner.recordingId, claim));
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
  return giveUp(
    event,
    recordingId,
    verified.ownerEmail,
    typeof verified.ticket.authUserId === "string"
      ? verified.ticket.authUserId
      : undefined,
    cors,
  );
}

/**
 * Fails the upload through Clips' own abort while it is uploading or parked.
 * Its phase, read before and after, is the answer, never the abort's `ok`.
 */
async function giveUp(
  event: H3Event,
  recordingId: string,
  ownerEmail: string,
  authUserId: string | undefined,
  cors: Record<string, string>,
): Promise<Response> {
  const [recording] = await getDb()
    .select({
      organizationId: schema.recordings.organizationId,
      uploadAttemptId: schema.recordings.uploadAttemptId,
      uploadGenerationId: schema.recordings.uploadGenerationId,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  if (!recording) return json({ error: "Not found" }, 404, cors);
  const readPhase = () =>
    runWithRequestContext(
      {
        userEmail: ownerEmail,
        orgId: recording.organizationId ?? undefined,
        authUserId,
      },
      () => readUploadPhase(recordingId, ownerEmail),
    );
  const settled = cancelAnswer(recordingId, await readPhase(), cors);
  if (settled) return settled;

  const result = (await handleAbortRecordingUpload(event, {
    recordingId,
    ownerEmail,
    orgId: recording.organizationId,
    authUserId,
    onlyWhileUploading: true,
    body: {
      failureCode: "upload_aborted",
      reason: "The Content page gave up this upload.",
      attemptId: recording.uploadAttemptId ?? undefined,
      uploadGenerationId: recording.uploadGenerationId ?? undefined,
    },
  })) as Record<string, unknown>;
  const answer = cancelAnswer(recordingId, await readPhase(), cors);
  if (answer) return answer;
  if (result.ok === true) {
    return json({ error: "Clips didn't cancel this upload" }, 409, cors);
  }
  return json(result, event.res.status ?? 409, cors);
}

/** What a cancel did, once the upload is past `uploading` and `parked`. */
function cancelAnswer(
  recordingId: string,
  standing: UploadStanding | null,
  cors: Record<string, string>,
): Response | null {
  if (!standing) return json({ error: "Not found" }, 404, cors);
  const { phase, status } = standing;
  if (phase === "ended") {
    const cancelled: ContentClipCancelAnswer = {
      outcome: CONTENT_CLIP_CANCEL_OUTCOME.cancelled,
      recordingId,
    };
    return json(cancelled, 200, cors);
  }
  if (phase === "finishing") {
    const finishing: ContentClipCancelAnswer = {
      outcome: CONTENT_CLIP_CANCEL_OUTCOME.finishing,
      recordingId,
    };
    return json(
      { error: "This upload is finishing. Try again.", ...finishing },
      409,
      cors,
    );
  }
  if (phase === "finished") {
    const finished: ContentClipCancelAnswer = {
      outcome: CONTENT_CLIP_CANCEL_OUTCOME.alreadyFinished,
      recordingId,
      status: status === "ready" ? "ready" : "processing",
    };
    return json(
      { error: "This upload is already finished", ...finished },
      409,
      cors,
    );
  }
  return null;
}
