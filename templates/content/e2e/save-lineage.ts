import { createHash } from "node:crypto";

export const MAX_SAVE_LINEAGE_ENTRIES = 64;
const RESERVED_READBACK_ENTRIES = 8;

const MAX_CONTENT_CHARS = 500_000;
const MAX_ID_CHARS = 200;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const BODY_REVISION = /^body:(0|[1-9]\d*):(sha256:[a-f0-9]{64})$/;

export type CapturedValue<T> =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "valid"; value: T };

export interface CapturedRevision {
  revision: number;
  contentHash: string;
}

export type SaveLineageCheckpointName =
  | "deadline"
  | "before-refresh"
  | "refresh"
  | "before-close"
  | "reopened-alone";

export interface UpdateDocumentRequestLineage {
  kind: "update-document";
  order: number;
  atMs: number;
  bodyState: "absent" | "invalid" | "valid";
  documentIdHash: CapturedValue<string>;
  browserSaveAttemptIdHash: CapturedValue<string>;
  editorSessionIdHash: CapturedValue<string>;
  historySessionIdHash: CapturedValue<string>;
  editorEditGeneration: CapturedValue<number>;
  contentSha256: CapturedValue<string>;
  authoredBaseContentSha256: CapturedValue<string>;
  authoredCandidateContentSha256: CapturedValue<string>;
  editorSnapshotContentSha256: CapturedValue<string>;
  baseRevision: CapturedValue<CapturedRevision>;
  authoredBaseRevision: CapturedValue<CapturedRevision>;
  response?: UpdateDocumentResponseLineage;
  requestFailure?: { order: number; atMs: number };
}

export interface UpdateDocumentResponseLineage {
  order: number;
  atMs: number;
  status: number;
  bodyState: "pending" | "absent" | "invalid" | "valid";
  documentIdHash?: CapturedValue<string>;
  contentSha256?: CapturedValue<string>;
  declaredContentHash?: CapturedValue<string>;
  bodyRevision?: CapturedValue<number>;
  revision?: CapturedValue<CapturedRevision>;
  editorSessionIdHash?: CapturedValue<string>;
  editGeneration?: CapturedValue<number>;
  discardedGeneration?: CapturedValue<number>;
  attemptIdHash?: CapturedValue<string>;
  attemptResult?: CapturedValue<"applied" | "replayed">;
  attemptRevision?: CapturedValue<CapturedRevision>;
  bodyIntentOutcome?: CapturedValue<"applied" | "displaced-preserved">;
  correlatedRequestGeneration?: CapturedValue<number>;
}

export interface SaveReadbackLineage {
  kind: "readback";
  order: number;
  atMs: number;
  checkpoint: SaveLineageCheckpointName;
  documentIdHash: CapturedValue<string>;
  contentSha256: CapturedValue<string>;
  declaredContentHash: CapturedValue<string>;
  bodyRevision: CapturedValue<number>;
  revision: CapturedValue<CapturedRevision>;
  savesInFlight: number;
  pendingRequestOrders: number[];
}

export type SaveLineageEvent =
  | UpdateDocumentRequestLineage
  | SaveReadbackLineage;

export interface SaveLineageBucket {
  saveLineage: SaveLineageEvent[];
  saveLineageDropped: number;
}

type JsonObject = Record<string, unknown>;
type PayloadState = "absent" | "invalid" | "valid";

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stringHash(value: unknown, maxChars: number): CapturedValue<string> {
  if (typeof value !== "string" || value.length > maxChars)
    return { state: "invalid" };
  return { state: "valid", value: hash(value) };
}

function identityHash(value: unknown): CapturedValue<string> {
  if (typeof value !== "string" || value.length === 0)
    return { state: "invalid" };
  return stringHash(value, MAX_ID_CHARS);
}

function contentHash(value: unknown): CapturedValue<string> {
  return stringHash(value, MAX_CONTENT_CHARS);
}

function declaredHash(value: unknown): CapturedValue<string> {
  return typeof value === "string" && CONTENT_HASH.test(value)
    ? { state: "valid", value }
    : { state: "invalid" };
}

function numberValue(value: unknown): CapturedValue<number> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { state: "valid", value }
    : { state: "invalid" };
}

function revisionValue(value: unknown): CapturedValue<CapturedRevision> {
  if (typeof value !== "string") return { state: "invalid" };
  const match = BODY_REVISION.exec(value);
  if (!match) return { state: "invalid" };
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) return { state: "invalid" };
  return {
    state: "valid",
    value: { revision, contentHash: match[2]! },
  };
}

function field<T>(
  object: JsonObject | undefined,
  state: PayloadState,
  key: string,
  project: (value: unknown) => CapturedValue<T>,
): CapturedValue<T> {
  if (state === "absent") return { state: "absent" };
  if (state === "invalid" || !object) return { state: "invalid" };
  if (!Object.hasOwn(object, key)) return { state: "absent" };
  return project(object[key]);
}

function parseRequestBody(rawBody: string | null): {
  state: PayloadState;
  object?: JsonObject;
} {
  if (rawBody === null || rawBody.length === 0) return { state: "absent" };
  try {
    const value: unknown = JSON.parse(rawBody);
    return isJsonObject(value)
      ? { state: "valid", object: value }
      : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

function hashContentField(
  object: JsonObject | undefined,
  state: PayloadState,
  key: string,
): CapturedValue<string> {
  return field(object, state, key, contentHash);
}

function hashIdentityField(
  object: JsonObject | undefined,
  state: PayloadState,
  key: string,
): CapturedValue<string> {
  return field(object, state, key, identityHash);
}

function parseJsonResponse(
  bodyState: PayloadState,
  body: unknown,
): {
  state: PayloadState;
  object?: JsonObject;
} {
  if (bodyState !== "valid") return { state: bodyState };
  return isJsonObject(body)
    ? { state: "valid", object: body }
    : { state: "invalid" };
}

function nestedObject(
  object: JsonObject | undefined,
  state: PayloadState,
  key: string,
): { state: PayloadState; object?: JsonObject } {
  if (state !== "valid" || !object) return { state };
  if (!Object.hasOwn(object, key)) return { state: "absent" };
  return isJsonObject(object[key])
    ? { state: "valid", object: object[key] }
    : { state: "invalid" };
}

function correlateRequestGeneration(
  request: UpdateDocumentRequestLineage,
  status: number,
  responseAttemptId: CapturedValue<string>,
  attemptResult: CapturedValue<"applied" | "replayed">,
  responseState: PayloadState,
): CapturedValue<number> {
  const generation = request.editorEditGeneration;
  if (generation.state === "absent") return { state: "absent" };
  if (generation.state === "invalid") return { state: "invalid" };
  if (request.browserSaveAttemptIdHash.state === "absent")
    return { state: "absent" };
  if (request.browserSaveAttemptIdHash.state === "invalid")
    return { state: "invalid" };
  if (responseState === "absent") return { state: "absent" };
  if (
    responseAttemptId.state !== "valid" ||
    attemptResult.state !== "valid" ||
    status < 200 ||
    status >= 300
  )
    return responseAttemptId.state === "absent" &&
      attemptResult.state === "absent"
      ? { state: "absent" }
      : { state: "invalid" };
  return responseAttemptId.value === request.browserSaveAttemptIdHash.value
    ? { state: "valid", value: generation.value }
    : { state: "invalid" };
}

export class SaveLineageCapture {
  private nextOrder = 0;
  private retainedEntries = 0;
  private retainedRequests = 0;
  private lastAtMs = 0;
  private readonly startedAt: number;

  constructor(
    private readonly options: {
      limit?: number;
      now?: () => number;
    } = {},
  ) {
    this.startedAt = this.now();
  }

  captureRequest(
    bucket: SaveLineageBucket,
    rawBody: string | null,
  ): UpdateDocumentRequestLineage | undefined {
    const stamp = this.stamp();
    if (!this.retain(bucket, "request")) return undefined;
    const parsed = parseRequestBody(rawBody);
    const { object, state } = parsed;
    const entry: UpdateDocumentRequestLineage = {
      kind: "update-document",
      order: stamp.order,
      atMs: stamp.atMs,
      bodyState: state,
      documentIdHash: hashIdentityField(object, state, "id"),
      browserSaveAttemptIdHash: hashIdentityField(
        object,
        state,
        "browserSaveAttemptId",
      ),
      editorSessionIdHash: hashIdentityField(object, state, "editorSessionId"),
      historySessionIdHash: hashIdentityField(
        object,
        state,
        "historySessionId",
      ),
      editorEditGeneration: field(
        object,
        state,
        "editorEditGeneration",
        numberValue,
      ),
      contentSha256: hashContentField(object, state, "content"),
      authoredBaseContentSha256: hashContentField(
        object,
        state,
        "authoredBaseContent",
      ),
      authoredCandidateContentSha256: hashContentField(
        object,
        state,
        "authoredCandidateContent",
      ),
      editorSnapshotContentSha256: hashContentField(
        object,
        state,
        "editorSnapshotContent",
      ),
      baseRevision: field(object, state, "baseRevision", revisionValue),
      authoredBaseRevision: field(
        object,
        state,
        "authoredBaseRevision",
        revisionValue,
      ),
    };
    bucket.saveLineage.push(entry);
    return entry;
  }

  beginResponse(
    request: UpdateDocumentRequestLineage,
    status: number,
  ): UpdateDocumentResponseLineage {
    const stamp = this.stamp();
    const response: UpdateDocumentResponseLineage = {
      order: stamp.order,
      atMs: stamp.atMs,
      status,
      bodyState: "pending",
    };
    request.response = response;
    return response;
  }

  finishResponse(
    request: UpdateDocumentRequestLineage,
    response: UpdateDocumentResponseLineage,
    bodyState: PayloadState,
    rawBody: unknown,
  ): void {
    const parsed = parseJsonResponse(bodyState, rawBody);
    const { object, state } = parsed;
    const document = nestedObject(object, state, "document");
    const documentObject =
      document.state === "valid" ? document.object : object;
    const documentState =
      state === "valid"
        ? document.state === "absent"
          ? "valid"
          : document.state
        : state;
    const attempt = nestedObject(object, state, "browserSaveAttempt");
    const intent = nestedObject(object, state, "bodyIntentOutcome");
    const attemptResult = field<"applied" | "replayed">(
      attempt.object,
      attempt.state,
      "result",
      (value): CapturedValue<"applied" | "replayed"> =>
        value === "applied" || value === "replayed"
          ? { state: "valid", value }
          : { state: "invalid" },
    );
    const attemptIdHash = hashIdentityField(
      attempt.object,
      attempt.state,
      "attemptId",
    );

    response.bodyState = state;
    response.documentIdHash = hashIdentityField(
      documentObject,
      documentState,
      "id",
    );
    response.contentSha256 = hashContentField(
      documentObject,
      documentState,
      "content",
    );
    response.declaredContentHash = field(
      documentObject,
      documentState,
      "contentHash",
      declaredHash,
    );
    response.bodyRevision = field(
      documentObject,
      documentState,
      "bodyRevision",
      numberValue,
    );
    response.revision = field(
      documentObject,
      documentState,
      "revision",
      revisionValue,
    );
    response.editorSessionIdHash = hashIdentityField(
      object,
      state,
      "editorSessionId",
    );
    response.editGeneration = field(
      object,
      state,
      "editGeneration",
      numberValue,
    );
    response.discardedGeneration = field(
      object,
      state,
      "discardedGeneration",
      numberValue,
    );
    response.attemptIdHash = attemptIdHash;
    response.attemptResult = attemptResult;
    response.attemptRevision = field(
      attempt.object,
      attempt.state,
      "revision",
      revisionValue,
    );
    response.bodyIntentOutcome = field<"applied" | "displaced-preserved">(
      intent.object,
      intent.state,
      "status",
      (value): CapturedValue<"applied" | "displaced-preserved"> =>
        value === "applied" || value === "displaced-preserved"
          ? { state: "valid", value }
          : { state: "invalid" },
    );
    response.correlatedRequestGeneration = correlateRequestGeneration(
      request,
      response.status,
      attemptIdHash,
      attemptResult,
      state,
    );
  }

  failRequest(request: UpdateDocumentRequestLineage): void {
    const stamp = this.stamp();
    request.requestFailure = { order: stamp.order, atMs: stamp.atMs };
  }

  captureReadback(
    bucket: SaveLineageBucket,
    input: {
      checkpoint: SaveLineageCheckpointName;
      documentId: unknown;
      content: unknown;
      contentHash: unknown;
      bodyRevision: unknown;
      revision: unknown;
      savesInFlight: number;
      pendingRequestOrders: number[];
    },
  ): SaveReadbackLineage | undefined {
    const stamp = this.stamp();
    const previousIndex = bucket.saveLineage.findIndex(
      (entry) =>
        entry.kind === "readback" && entry.checkpoint === input.checkpoint,
    );
    if (previousIndex < 0 && !this.retain(bucket, "readback")) return undefined;
    const event: SaveReadbackLineage = {
      kind: "readback",
      order: stamp.order,
      atMs: stamp.atMs,
      checkpoint: input.checkpoint,
      documentIdHash: identityHash(input.documentId),
      contentSha256: contentHash(input.content),
      declaredContentHash: declaredHash(input.contentHash),
      bodyRevision: numberValue(input.bodyRevision),
      revision: revisionValue(input.revision),
      savesInFlight: Number.isSafeInteger(input.savesInFlight)
        ? Math.max(0, input.savesInFlight)
        : 0,
      pendingRequestOrders: input.pendingRequestOrders
        .filter((order) => Number.isSafeInteger(order) && order > 0)
        .slice(0, MAX_SAVE_LINEAGE_ENTRIES),
    };
    if (previousIndex < 0) bucket.saveLineage.push(event);
    else bucket.saveLineage[previousIndex] = event;
    return event;
  }

  private retain(
    bucket: SaveLineageBucket,
    kind: "request" | "readback",
  ): boolean {
    const limit = Math.min(
      MAX_SAVE_LINEAGE_ENTRIES,
      Math.max(1, this.options.limit ?? MAX_SAVE_LINEAGE_ENTRIES),
    );
    const readbackReserve = Math.min(
      RESERVED_READBACK_ENTRIES,
      Math.max(1, Math.floor(limit / 8)),
    );
    const requestLimit = Math.max(0, limit - readbackReserve);
    if (
      this.retainedEntries >= limit ||
      (kind === "request" && this.retainedRequests >= requestLimit)
    ) {
      bucket.saveLineageDropped++;
      return false;
    }
    this.retainedEntries++;
    if (kind === "request") this.retainedRequests++;
    return true;
  }

  private stamp(): { order: number; atMs: number } {
    const atMs = Math.max(
      this.lastAtMs,
      Math.floor(this.now() - this.startedAt),
    );
    this.lastAtMs = atMs;
    return { order: ++this.nextOrder, atMs };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
