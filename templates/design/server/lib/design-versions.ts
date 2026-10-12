import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  CollabBaseVersionConflictError,
  applyTextToYDoc,
  applyText,
  hasCollabState,
  loadAwarenessRowsStrict,
  seedFromText,
  type PreparedYDocMutationLease,
  withPreparedYDocMutation,
} from "@agent-native/core/collab";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { captureError } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, isNull, like } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  componentDeletionGeometrySchema,
  type ComponentDeletionGeometry,
} from "../../shared/component-archive.js";
import { shouldUseLiveFileContent } from "../../shared/html-content.js";
import { getDb, schema } from "../db/index.js";
import {
  affectedRowCount,
  getDesignSourceMutationExec,
  lockPreparedSourceCollaboration,
  lockDesignFilesTable,
  readPreparedSourceText,
  SourceWorkspaceEditConflictError,
  withDesignSourceMutationTransaction,
  withSourceFileWriteLock,
} from "../source-workspace.js";
import { buildDesignSnapshot, type SnapshotFile } from "./design-snapshot.js";

const CHAT_VERSION_LOOKBACK = 100;
const MAX_INLINE_DESIGN_VERSION_BYTES = 256 * 1024;
const EDITOR_CHECKPOINT_THROTTLE_MS = 5 * 60 * 1000;

export interface DesignVersionChatContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
  actionName?: string;
  phase?: "start" | "end";
  surface?: "editor";
  caller?: "frontend" | "webmcp" | "mcp-widget-write";
}

export interface DesignVersionFile {
  id?: string;
  filename: string;
  fileType: string;
  content: string;
}

export interface ParsedDesignVersionSnapshot {
  designId: string;
  files: DesignVersionFile[];
  designData?: string;
  designTitle?: string;
  designDescription?: string | null;
  projectType?: string;
  designSystemId?: string | null;
  tweaks?: unknown;
  appliedTweaks?: unknown;
  resolvedCssVars?: unknown;
  deletionGeometry?: ComponentDeletionGeometry;
  capturedAt?: string;
  chatContext?: DesignVersionChatContext;
}

export interface DesignVersionListEntry {
  id: string;
  designId: string;
  label: string | null;
  createdAt: string | null;
  source: "chat" | "editor" | "legacy";
  fileCount: number;
  chatContext: DesignVersionChatContext | null;
  editable: boolean;
}

export type DesignVersionCheckpointSkipReason =
  | "blob-storage-unavailable"
  | "checkpoint-failed";

export interface DesignVersionCheckpointSkipped {
  skipped: true;
  reason: DesignVersionCheckpointSkipReason;
}

export type DesignVersionCheckpointResult =
  | { id: string; createdAt: string; label: string }
  | DesignVersionCheckpointSkipped
  | null;

export function checkpointSkippedResultField(
  result: DesignVersionCheckpointResult,
): { checkpoint: DesignVersionCheckpointSkipped } | Record<string, never> {
  return result && "skipped" in result ? { checkpoint: result } : {};
}

export class DesignVersionRestoreConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "DesignVersionRestoreConflictError";
  }
}

export class DesignVersionCheckpointChangedError extends Error {
  readonly statusCode = 409;
  readonly retryable = true;
  readonly errorCode = "design-version-checkpoint-changed";

  constructor() {
    super(
      "Design or its history changed while the checkpoint was being prepared. Retry the operation.",
    );
    this.name = "DesignVersionCheckpointChangedError";
  }
}

class DesignCheckpointBlobUnavailableError extends Error {
  constructor() {
    super(
      "Private blob storage is required for design checkpoints larger than 256 KiB.",
    );
    this.name = "DesignCheckpointBlobUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Design history contains an unserializable value.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function designVersionIdForIdempotencyKey(
  designId: string,
  idempotencyKey: string,
) {
  return `design-version-${createHash("sha256")
    .update(stableStringify({ designId, idempotencyKey }))
    .digest("hex")}`;
}

function nextRevisionTimestamp(previous: string | null | undefined): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  return new Date(
    Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0),
  ).toISOString();
}

function parseDesignData(designId: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Design "${designId}" has invalid data JSON.`);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return stableStringify(parsed);
  } catch {
    throw new Error(`Design "${designId}" has invalid data JSON.`);
  }
  throw new Error(`Design "${designId}" has invalid data JSON.`);
}

function parseChatContext(
  value: unknown,
): DesignVersionChatContext | undefined {
  if (!isRecord(value)) return undefined;

  const context: DesignVersionChatContext = {};
  for (const key of ["threadId", "runId", "turnId", "actionName"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      context[key] = candidate;
    }
  }
  if (value.phase === "start" || value.phase === "end") {
    context.phase = value.phase;
  }
  if (value.surface === "editor") context.surface = "editor";
  if (
    value.caller === "frontend" ||
    value.caller === "webmcp" ||
    value.caller === "mcp-widget-write"
  ) {
    context.caller = value.caller;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function isSafeFilename(filename: string): boolean {
  const segments = filename.split("/");
  return (
    filename.length > 0 &&
    filename.length <= 255 &&
    !filename.includes("\\") &&
    !filename.startsWith("/") &&
    !filename.endsWith("/") &&
    !segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) &&
    !/[\u0000-\u001f\u007f]/.test(filename)
  );
}

export function parseDesignVersionSnapshot(
  raw: string,
  expectedDesignId: string,
): ParsedDesignVersionSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Design version snapshot is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("Design version snapshot must be a JSON object.");
  }

  const rawDesignId = value.designId;
  if (
    rawDesignId !== undefined &&
    (typeof rawDesignId !== "string" || rawDesignId !== expectedDesignId)
  ) {
    throw new Error("Design version belongs to a different design.");
  }

  if (!Array.isArray(value.files)) {
    throw new Error("Design version snapshot has no file list.");
  }

  const filenames = new Set<string>();
  const fileIds = new Set<string>();
  const files: DesignVersionFile[] = [];
  for (const candidate of value.files) {
    if (!isRecord(candidate)) {
      throw new Error("Design version snapshot contains an invalid file.");
    }
    const filename = candidate.filename;
    const content = candidate.content;
    if (
      typeof filename !== "string" ||
      !isSafeFilename(filename) ||
      typeof content !== "string"
    ) {
      throw new Error("Design version snapshot contains an invalid file.");
    }
    if (filenames.has(filename)) {
      throw new Error(`Design version contains duplicate file "${filename}".`);
    }
    filenames.add(filename);

    const id =
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : undefined;
    if (id && fileIds.has(id)) {
      throw new Error("Design version contains duplicate file ids.");
    }
    if (id) fileIds.add(id);

    const fileType =
      typeof candidate.fileType === "string" && candidate.fileType.trim()
        ? candidate.fileType
        : "html";
    files.push({ id, filename, fileType, content });
  }

  const parsed: ParsedDesignVersionSnapshot = {
    designId: expectedDesignId,
    files,
  };

  if (value.designData !== undefined) {
    parsed.designData = parseDesignData(expectedDesignId, value.designData);
  }
  if (value.designTitle !== undefined) {
    if (typeof value.designTitle !== "string") {
      throw new Error("Design version snapshot has an invalid title.");
    }
    parsed.designTitle = value.designTitle;
  }
  if (value.designDescription !== undefined) {
    if (
      value.designDescription !== null &&
      typeof value.designDescription !== "string"
    ) {
      throw new Error("Design version snapshot has an invalid description.");
    }
    parsed.designDescription = value.designDescription;
  }
  if (value.projectType !== undefined) {
    if (typeof value.projectType !== "string") {
      throw new Error("Design version snapshot has an invalid project type.");
    }
    parsed.projectType = value.projectType;
  }
  if (value.designSystemId !== undefined) {
    if (
      value.designSystemId !== null &&
      typeof value.designSystemId !== "string"
    ) {
      throw new Error("Design version snapshot has an invalid design system.");
    }
    parsed.designSystemId = value.designSystemId;
  }
  if (value.tweaks !== undefined) parsed.tweaks = value.tweaks;
  if (value.appliedTweaks !== undefined)
    parsed.appliedTweaks = value.appliedTweaks;
  if (value.resolvedCssVars !== undefined)
    parsed.resolvedCssVars = value.resolvedCssVars;
  if (value.deletionGeometry !== undefined) {
    const deletionGeometry = componentDeletionGeometrySchema.safeParse(
      value.deletionGeometry,
    );
    if (!deletionGeometry.success) {
      throw new Error(
        "Design version snapshot has invalid component deletion geometry.",
      );
    }
    parsed.deletionGeometry = deletionGeometry.data;
  }
  if (typeof value.capturedAt === "string")
    parsed.capturedAt = value.capturedAt;
  parsed.chatContext = parseChatContext(value.chatContext);
  return parsed;
}

function parseStoredChatContext(
  raw: string | null,
): DesignVersionChatContext | undefined {
  if (raw === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Design version chat metadata is not valid JSON.");
  }
  const context = parseChatContext(value);
  if (!context) throw new Error("Design version chat metadata is invalid.");
  return context;
}

function isPrivateBlobHandle(value: unknown): value is PrivateBlobHandle {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    value.opaque === true &&
    typeof value.encrypted === "boolean"
  );
}

export async function readDesignVersionSnapshot(
  raw: string,
  expectedDesignId: string,
): Promise<ParsedDesignVersionSnapshot> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Design version snapshot is not valid JSON.");
  }
  if (!isRecord(value) || value.snapshotKind !== "design-history-blob") {
    return parseDesignVersionSnapshot(raw, expectedDesignId);
  }
  if (value.designId !== expectedDesignId) {
    throw new Error("Design version belongs to a different design.");
  }
  if (!isPrivateBlobHandle(value.blob)) {
    throw new Error("Design version blob reference is invalid.");
  }
  const blob = await readPrivateBlob(value.blob);
  return parseDesignVersionSnapshot(
    Buffer.from(blob.data).toString("utf8"),
    expectedDesignId,
  );
}

function chatContextKey(
  context: DesignVersionChatContext | null | undefined,
): string | null {
  if (!context || context.surface === "editor") return null;
  if (context.phase === "start" && context.threadId) {
    return `${context.threadId}:start`;
  }
  const scope = context.threadId ?? "";
  const turn = context.turnId ?? context.runId ?? "";
  return turn ? `${scope}:${turn}:${context.phase ?? ""}` : null;
}

function actionChatContext(
  context: ActionRunContext,
): DesignVersionChatContext | null {
  if (context.caller !== "tool") return null;
  if (!context.threadId && !context.runId && !context.turnId) return null;
  return {
    ...(context.threadId ? { threadId: context.threadId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.actionName ? { actionName: context.actionName } : {}),
  };
}

function editorActionContext(
  context: ActionRunContext,
): DesignVersionChatContext | null {
  if (
    context.caller !== "frontend" &&
    context.caller !== "webmcp" &&
    context.caller !== "mcp-widget-write"
  ) {
    return null;
  }
  return {
    surface: "editor",
    caller: context.caller,
    ...(context.actionName ? { actionName: context.actionName } : {}),
  };
}

function isThrottledEditorCheckpointCaller(
  caller: string | undefined,
): boolean {
  return caller === "frontend" || caller === "mcp-widget-write";
}

function versionTime(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nextUpdatedAt(current: string | null, now: Date): string {
  const currentMs = current ? Date.parse(current) : Number.NaN;
  const nextMs = Number.isFinite(currentMs)
    ? Math.max(currentMs + 1, now.getTime())
    : now.getTime();
  return new Date(nextMs).toISOString();
}

function designFileRevisionWhere(file: {
  id: string;
  designId: string;
  content: string;
  updatedAt: string | null;
}) {
  return and(
    eq(schema.designFiles.id, file.id),
    eq(schema.designFiles.designId, file.designId),
    eq(schema.designFiles.content, file.content),
    file.updatedAt === null
      ? isNull(schema.designFiles.updatedAt)
      : eq(schema.designFiles.updatedAt, file.updatedAt),
  );
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function parseAwarenessUserEmail(raw: string): string | null {
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new DesignVersionRestoreConflictError(
      "Design history cannot verify collaboration state right now. Refresh and try again.",
    );
  }
  if (!isRecord(state) || !isRecord(state.user)) return null;
  return normalizeEmail(state.user.email);
}

async function assertNoForeignCollaborators(
  fileIds: string[],
  currentEmail: string | null,
): Promise<void> {
  let rows: Awaited<ReturnType<typeof loadAwarenessRowsStrict>>[];
  try {
    rows = await Promise.all(
      fileIds.map((fileId) => loadAwarenessRowsStrict(fileId)),
    );
  } catch {
    throw new DesignVersionRestoreConflictError(
      "Design history cannot verify collaboration state right now. Refresh and try again.",
    );
  }

  for (const row of rows.flat()) {
    if (row.clientId === AGENT_CLIENT_ID) continue;
    const email = parseAwarenessUserEmail(row.state);
    if (!email || !currentEmail || email !== currentEmail) {
      throw new DesignVersionRestoreConflictError(
        "Design history cannot be restored while another collaborator is active. Ask them to leave the design and try again.",
      );
    }
  }
}

function assertNoUnpersistedCollaborativeEdits(
  storedFiles: ReadonlyArray<{ id: string; content: string }>,
  liveSnapshot: Awaited<ReturnType<typeof buildDesignSnapshot>>,
): void {
  const storedById = new Map(storedFiles.map((file) => [file.id, file]));
  for (const liveFile of liveSnapshot.files) {
    if (liveFile.source !== "collab") continue;
    const storedFile = storedById.get(liveFile.id);
    if (!storedFile || storedFile.content !== liveFile.content) {
      throw new DesignVersionRestoreConflictError(
        "Design history cannot overwrite unsaved collaborative edits. Save or refresh the design and try again.",
      );
    }
  }
}

type DesignDatabase = Pick<ReturnType<typeof getDb>, "select" | "insert">;
type LatestDesignVersion = {
  id: string;
  snapshot: string;
  createdAt: string | null;
  label: string | null;
  chatContext: string | null;
};
type DesignVersionSourceCapture = {
  designOwnerEmail?: string;
  designData: string;
  designTitle: string;
  designDescription: string | null;
  projectType: string;
  designSystemId: string | null;
  liveSnapshot: Awaited<ReturnType<typeof buildDesignSnapshot>>;
  currentStateJson: string;
  stateHash: string;
  sourceFingerprint: string;
  persistedSourceFingerprint: string;
  latest?: LatestDesignVersion;
  collaborationVersions: ReadonlyMap<string, number>;
};
type DesignVersionSourceRows = {
  design: Record<string, unknown>;
  files: SnapshotFile[];
  storedFiles: SnapshotFile[];
  latest?: LatestDesignVersion;
  collaborationVersions: ReadonlyMap<string, number>;
};

export interface PreparedDesignVersionCheckpoint {
  designId: string;
  options: {
    label: string;
    chatContext?: DesignVersionChatContext;
    deletionGeometry?: ComponentDeletionGeometry;
    preferStoredFileContent?: boolean;
    idempotencyKey?: string;
  };
  capture: DesignVersionSourceCapture;
  existingVersion?: LatestDesignVersion;
  id: string;
  createdAt: string;
  storedSnapshot: string | null;
  uploadedBlob: PrivateBlobHandle | null;
  duplicateBlob: PrivateBlobHandle | null;
  persistenceStarted: boolean;
}

const designVersionLocks = new Map<string, Promise<unknown>>();

const editorCheckpointRecentSkips = new Map<
  string,
  { at: number; reason: DesignVersionCheckpointSkipReason }
>();

export function __clearEditorCheckpointSkipsForTests(): void {
  editorCheckpointRecentSkips.clear();
}

async function latestStateMatches(
  raw: string,
  designId: string,
  stateHash: string,
  currentStateJson: string,
): Promise<boolean> {
  try {
    const stored: unknown = JSON.parse(raw);
    if (isRecord(stored) && typeof stored.stateHash === "string") {
      return stored.stateHash === stateHash;
    }
    const previous = await readDesignVersionSnapshot(raw, designId);
    const previousState = {
      designData: previous.designData,
      designTitle: previous.designTitle,
      designDescription: previous.designDescription,
      projectType: previous.projectType,
      designSystemId: previous.designSystemId,
      files: previous.files,
      tweaks: previous.tweaks,
      appliedTweaks: previous.appliedTweaks,
      resolvedCssVars: previous.resolvedCssVars,
      deletionGeometry: previous.deletionGeometry,
    };
    return stableStringify(previousState) === currentStateJson;
    // coercion-ok: unreadable history cannot suppress a new autosave.
  } catch {
    // An unreadable checkpoint cannot establish equality; preserve autosave.
    return false;
  }
}

export interface PreparedDesignVersionSourceFiles {
  readonly fileIds: readonly string[];
  readonly leases: ReadonlyMap<string, PreparedYDocMutationLease>;
}

async function withPreparedDesignVersionSourceFilesWithAccess<T>(
  designId: string,
  work: (prepared: PreparedDesignVersionSourceFiles) => Promise<T>,
  additionalLockFileIds: readonly string[],
  accessLevel: "editor" | "viewer",
): Promise<T> {
  await assertAccess("design", designId, accessLevel);
  const rows = await getDb()
    .select({ id: schema.designFiles.id })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));
  const fileIds = rows.map((row) => row.id);
  if (fileIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new DesignVersionCheckpointChangedError();
  }
  fileIds.sort(compareDesignFileIds);

  const sourceFileIds = new Set(fileIds);
  const lockFileIds = [...new Set([...fileIds, ...additionalLockFileIds])].sort(
    compareDesignFileIds,
  );
  const leases = new Map<string, PreparedYDocMutationLease>();
  const acquire = async (index: number): Promise<T> => {
    if (index >= lockFileIds.length) return work({ fileIds, leases });
    const fileId = lockFileIds[index]!;
    return withSourceFileWriteLock(fileId, async () => {
      if (!sourceFileIds.has(fileId)) return acquire(index + 1);
      return withPreparedYDocMutation(fileId, undefined, async (lease) => {
        leases.set(fileId, lease);
        try {
          return await acquire(index + 1);
        } finally {
          leases.delete(fileId);
        }
      });
    });
  };
  return acquire(0);
}

export function withPreparedDesignVersionSourceFiles<T>(
  designId: string,
  work: (prepared: PreparedDesignVersionSourceFiles) => Promise<T>,
  additionalLockFileIds: readonly string[] = [],
): Promise<T> {
  return withPreparedDesignVersionSourceFilesWithAccess(
    designId,
    work,
    additionalLockFileIds,
    "editor",
  );
}

async function withPreparedDesignVersionSourceFilesForCreativeContextCapture<T>(
  designId: string,
  work: (prepared: PreparedDesignVersionSourceFiles) => Promise<T>,
): Promise<T> {
  return withPreparedDesignVersionSourceFilesWithAccess(
    designId,
    work,
    [],
    "viewer",
  );
}

async function readDesignVersionSourceRows(
  designId: string,
  options: {
    deletionGeometry?: ComponentDeletionGeometry;
    preferStoredFileContent?: boolean;
  },
  prepared: PreparedDesignVersionSourceFiles,
): Promise<DesignVersionSourceRows> {
  const db = getDb();
  const [design] = await db
    .select()
    .from(schema.designs)
    .where(
      and(
        eq(schema.designs.id, designId),
        accessFilter(schema.designs, schema.designShares),
      ),
    )
    .limit(1);
  if (!design) throw new Error(`Design "${designId}" not found.`);

  const fileRows = await db
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId));
  const sortedRows = [...fileRows].sort((left, right) =>
    compareDesignFileIds(left.id, right.id),
  );
  const currentFileIds = sortedRows.map((file) => file.id);
  if (
    currentFileIds.length !== prepared.fileIds.length ||
    currentFileIds.some((id, index) => id !== prepared.fileIds[index])
  ) {
    throw new DesignVersionCheckpointChangedError();
  }

  const collaborationVersions = new Map<string, number>();
  const files: SnapshotFile[] = [];
  const storedFiles: SnapshotFile[] = [];
  for (const file of sortedRows) {
    const lease = prepared.leases.get(file.id);
    if (!lease) {
      throw new DesignVersionCheckpointChangedError();
    }
    if (lease.baseVersion === null || !(await hasCollabState(file.id))) {
      throw new DesignVersionSourceCollaborationNeedsSeedError();
    }

    const liveContent = readPreparedSourceText(lease);
    storedFiles.push({
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
      content: file.content,
      source: "stored",
    });
    const useLiveContent =
      !options.preferStoredFileContent &&
      shouldUseLiveFileContent({
        liveContent,
        storedContent: file.content,
        fileType: file.fileType,
      });
    files.push({
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
      content: useLiveContent ? liveContent : file.content,
      source: useLiveContent ? "collab" : "stored",
    });
    collaborationVersions.set(file.id, lease.baseVersion);
  }

  const [latest] = await db
    .select({
      id: schema.designVersions.id,
      snapshot: schema.designVersions.snapshot,
      createdAt: schema.designVersions.createdAt,
      label: schema.designVersions.label,
      chatContext: schema.designVersions.chatContext,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.designId, designId))
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      desc(schema.designVersions.createdAt),
      desc(schema.designVersions.id),
    )
    .limit(1);

  return { design, files, storedFiles, latest, collaborationVersions };
}

function sourceFingerprintForRows(
  designId: string,
  options: { deletionGeometry?: ComponentDeletionGeometry },
  rows: Pick<DesignVersionSourceRows, "design" | "files">,
): string {
  const designData = parseDesignData(designId, rows.design.data);
  const designTitle =
    typeof rows.design.title === "string" ? rows.design.title : "";
  const designDescription =
    typeof rows.design.description === "string" ||
    rows.design.description === null
      ? rows.design.description
      : null;
  const projectType =
    typeof rows.design.projectType === "string"
      ? rows.design.projectType
      : "prototype";
  const designSystemId =
    typeof rows.design.designSystemId === "string" ||
    rows.design.designSystemId === null
      ? rows.design.designSystemId
      : null;
  const ownerEmail =
    typeof rows.design.ownerEmail === "string"
      ? rows.design.ownerEmail
      : undefined;
  return createHash("sha256")
    .update(
      stableStringify({
        designData,
        designTitle,
        designDescription,
        projectType,
        designSystemId,
        files: rows.files.map(
          ({ id, filename, fileType, content, source }) => ({
            id,
            filename,
            fileType,
            contentHash: createHash("sha256").update(content).digest("hex"),
            source,
          }),
        ),
        deletionGeometry: options.deletionGeometry,
        ownerEmail: ownerEmail ?? null,
      }),
    )
    .digest("hex");
}

function persistedSourceFingerprintForRows(
  designId: string,
  options: { deletionGeometry?: ComponentDeletionGeometry },
  rows: Pick<DesignVersionSourceRows, "design" | "storedFiles">,
): string {
  return sourceFingerprintForRows(designId, options, {
    ...rows,
    files: rows.storedFiles,
  });
}

async function buildDesignVersionSourceCapture(
  designId: string,
  options: {
    deletionGeometry?: ComponentDeletionGeometry;
    preferStoredFileContent?: boolean;
  },
  rows: DesignVersionSourceRows,
): Promise<DesignVersionSourceCapture> {
  const designData = parseDesignData(designId, rows.design.data);
  const liveSnapshot = await buildDesignSnapshot(designId, designData, {
    preparedFiles: rows.files,
  });
  const designTitle =
    typeof rows.design.title === "string" ? rows.design.title : "";
  const designDescription =
    typeof rows.design.description === "string" ||
    rows.design.description === null
      ? rows.design.description
      : null;
  const projectType =
    typeof rows.design.projectType === "string"
      ? rows.design.projectType
      : "prototype";
  const designSystemId =
    typeof rows.design.designSystemId === "string" ||
    rows.design.designSystemId === null
      ? rows.design.designSystemId
      : null;
  const currentState = {
    designData,
    designTitle,
    designDescription,
    projectType,
    designSystemId,
    files: liveSnapshot.files.map(({ id, filename, fileType, content }) => ({
      id,
      filename,
      fileType,
      content,
    })),
    tweaks: liveSnapshot.tweaks,
    appliedTweaks: liveSnapshot.appliedTweaks,
    resolvedCssVars: liveSnapshot.resolvedCssVars,
    deletionGeometry: options.deletionGeometry,
  };
  const currentStateJson = stableStringify(currentState);
  const stateHash = createHash("sha256").update(currentStateJson).digest("hex");
  const ownerEmail =
    typeof rows.design.ownerEmail === "string"
      ? rows.design.ownerEmail
      : undefined;

  return {
    designOwnerEmail: ownerEmail,
    designData,
    designTitle,
    designDescription,
    projectType,
    designSystemId,
    liveSnapshot,
    currentStateJson,
    stateHash,
    sourceFingerprint: sourceFingerprintForRows(designId, options, rows),
    persistedSourceFingerprint: persistedSourceFingerprintForRows(
      designId,
      options,
      rows,
    ),
    latest: rows.latest,
    collaborationVersions: rows.collaborationVersions,
  };
}

function latestVersionMatches(
  left?: LatestDesignVersion,
  right?: LatestDesignVersion,
) {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.snapshot === right.snapshot &&
    left.createdAt === right.createdAt &&
    left.label === right.label &&
    left.chatContext === right.chatContext
  );
}

function latestVersionStateHashCheck(
  latest: LatestDesignVersion,
  stateHash: string,
): { status: "valid"; matches: boolean } | { status: "unreadable" } {
  try {
    const stored: unknown = JSON.parse(latest.snapshot);
    return {
      status: "valid",
      matches: isRecord(stored) && stored.stateHash === stateHash,
    };
  } catch {
    return { status: "unreadable" };
  }
}

function latestVersionChatContextCheck(
  latest: LatestDesignVersion,
  context?: DesignVersionChatContext,
): "match" | "mismatch" | "unreadable" {
  const currentKey = chatContextKey(context);
  if (!currentKey) return "match";
  try {
    return chatContextKey(parseStoredChatContext(latest.chatContext)) ===
      currentKey
      ? "match"
      : "mismatch";
  } catch {
    return "unreadable";
  }
}

function versionFromLatest(
  latest: LatestDesignVersion,
  fallbackLabel: string,
): { id: string; createdAt: string; label: string } {
  return {
    id: latest.id,
    createdAt: latest.createdAt ?? nextRevisionTimestamp(latest.createdAt),
    label: latest.label ?? fallbackLabel,
  };
}

function compareDesignFileIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class DesignVersionSourceCollaborationNeedsSeedError extends Error {
  constructor() {
    super("Design source collaboration state must be seeded before capture.");
    this.name = "DesignVersionSourceCollaborationNeedsSeedError";
  }
}

async function seedDesignVersionSourceCollaboration(
  designId: string,
  accessLevel: "editor" | "viewer",
): Promise<void> {
  await withPreparedDesignVersionSourceFilesWithAccess(
    designId,
    async (prepared) =>
      withDesignSourceMutationTransaction(designId, async (transaction) => {
        await assertAccess("design", designId, accessLevel);
        const fileRows = await transaction
          .select()
          .from(schema.designFiles)
          .where(eq(schema.designFiles.designId, designId))
          .for("update");
        const sortedRows = [...fileRows].sort((left, right) =>
          compareDesignFileIds(left.id, right.id),
        );
        if (
          sortedRows.length !== prepared.fileIds.length ||
          sortedRows.some((file, index) => file.id !== prepared.fileIds[index])
        ) {
          throw new DesignVersionCheckpointChangedError();
        }

        const transactionExec = getDesignSourceMutationExec(
          transaction as object,
        );
        for (const file of sortedRows) {
          const lease = prepared.leases.get(file.id);
          if (!lease) throw new DesignVersionCheckpointChangedError();

          let collaboration: Awaited<
            ReturnType<typeof lockPreparedSourceCollaboration>
          >;
          try {
            collaboration = await lockPreparedSourceCollaboration(
              transactionExec,
              file.id,
              lease,
            );
          } catch (error) {
            if (
              lease.baseVersion === null &&
              error instanceof SourceWorkspaceEditConflictError
            ) {
              throw new DesignVersionCheckpointChangedError();
            }
            throw error;
          }
          if (!collaboration.needsSeed) continue;

          const storedContent = file.content ?? "";
          applyTextToYDoc(lease.doc, "content", storedContent, "agent");
          try {
            await lease.persist(transactionExec, storedContent);
          } catch (error) {
            if (error instanceof CollabBaseVersionConflictError) {
              throw new DesignVersionCheckpointChangedError();
            }
            throw error;
          }
        }
      }),
    [],
    accessLevel,
  );
}

async function prepareDesignVersionCheckpointWithAccess(
  designId: string,
  options: PreparedDesignVersionCheckpoint["options"],
  accessContract: "editor" | "creative-context-read",
): Promise<PreparedDesignVersionCheckpoint> {
  const readRows = (prepared: PreparedDesignVersionSourceFiles) =>
    readDesignVersionSourceRows(designId, options, prepared);
  const withPreparedSourceFiles =
    accessContract === "creative-context-read"
      ? withPreparedDesignVersionSourceFilesForCreativeContextCapture
      : withPreparedDesignVersionSourceFiles;
  let rows: DesignVersionSourceRows;
  try {
    rows = await withPreparedSourceFiles(designId, readRows);
  } catch (error) {
    if (!(error instanceof DesignVersionSourceCollaborationNeedsSeedError)) {
      throw error;
    }
    await seedDesignVersionSourceCollaboration(
      designId,
      accessContract === "creative-context-read" ? "viewer" : "editor",
    );
    rows = await withPreparedSourceFiles(designId, readRows);
  }
  const capture = await buildDesignVersionSourceCapture(
    designId,
    options,
    rows,
  );
  const latest = capture.latest;
  const createdAt = nextRevisionTimestamp(latest?.createdAt);
  const deduplicated =
    latest &&
    latestVersionChatContextCheck(latest, options.chatContext) === "match" &&
    (await latestStateMatches(
      latest.snapshot,
      designId,
      capture.stateHash,
      capture.currentStateJson,
    ))
      ? latest
      : undefined;
  if (deduplicated) {
    return {
      designId,
      options,
      capture,
      existingVersion: deduplicated,
      id: deduplicated.id,
      createdAt: deduplicated.createdAt ?? createdAt,
      storedSnapshot: null,
      uploadedBlob: null,
      duplicateBlob: null,
      persistenceStarted: false,
    };
  }

  const id = options.idempotencyKey
    ? designVersionIdForIdempotencyKey(designId, options.idempotencyKey)
    : `design-version-${createHash("sha256")
        .update(
          stableStringify({
            designId,
            previousVersionId: latest?.id ?? "initial",
            chatContextKey: chatContextKey(options.chatContext),
            stateHash: capture.stateHash,
          }),
        )
        .digest("hex")}`;
  const snapshot = JSON.stringify({
    schemaVersion: 1,
    snapshotKind: "design-history",
    designId,
    designData: capture.designData,
    designTitle: capture.designTitle,
    designDescription: capture.designDescription,
    projectType: capture.projectType,
    designSystemId: capture.designSystemId,
    files: capture.liveSnapshot.files,
    tweaks: capture.liveSnapshot.tweaks,
    appliedTweaks: capture.liveSnapshot.appliedTweaks,
    resolvedCssVars: capture.liveSnapshot.resolvedCssVars,
    capturedAt: createdAt,
    stateHash: capture.stateHash,
    ...(options.chatContext ? { chatContext: options.chatContext } : {}),
    ...(options.deletionGeometry
      ? { deletionGeometry: options.deletionGeometry }
      : {}),
  });
  let uploadedBlob: PrivateBlobHandle | null = null;
  let storedSnapshot = snapshot;
  if (Buffer.byteLength(snapshot, "utf8") > MAX_INLINE_DESIGN_VERSION_BYTES) {
    const blob = await putPrivateBlob({
      data: Buffer.from(snapshot),
      filename: `${id}.design-history.json`,
      mimeType: "application/json",
      ownerEmail: capture.designOwnerEmail,
      metadata: {
        appId: "design",
        resourceType: "design-version",
        resourceId: designId,
        versionId: id,
      },
    });
    if (!blob) throw new DesignCheckpointBlobUnavailableError();
    uploadedBlob = blob;
    storedSnapshot = JSON.stringify({
      schemaVersion: 2,
      snapshotKind: "design-history-blob",
      designId,
      fileCount: capture.liveSnapshot.files.length,
      capturedAt: createdAt,
      stateHash: capture.stateHash,
      ...(options.chatContext ? { chatContext: options.chatContext } : {}),
      ...(options.deletionGeometry
        ? { deletionGeometry: options.deletionGeometry }
        : {}),
      blob,
    });
  }

  return {
    designId,
    options,
    capture,
    id,
    createdAt,
    storedSnapshot,
    uploadedBlob,
    duplicateBlob: null,
    persistenceStarted: false,
  };
}

export async function prepareDesignVersionCheckpoint(
  designId: string,
  options: PreparedDesignVersionCheckpoint["options"],
): Promise<PreparedDesignVersionCheckpoint> {
  return prepareDesignVersionCheckpointWithAccess(designId, options, "editor");
}

async function prepareDesignVersionCheckpointForCreativeContextCapture(
  designId: string,
  options: PreparedDesignVersionCheckpoint["options"],
): Promise<PreparedDesignVersionCheckpoint> {
  return prepareDesignVersionCheckpointWithAccess(
    designId,
    options,
    "creative-context-read",
  );
}

async function readPreparedCheckpointSourceInTransaction(
  designId: string,
  options: PreparedDesignVersionCheckpoint["options"],
  preparedFiles: PreparedDesignVersionSourceFiles,
  capture: DesignVersionSourceCapture,
  database: DesignDatabase,
): Promise<{
  design: Record<string, unknown>;
  storedFiles: SnapshotFile[];
  latest?: LatestDesignVersion;
}> {
  const [design] = await database
    .select()
    .from(schema.designs)
    .where(
      and(
        eq(schema.designs.id, designId),
        accessFilter(schema.designs, schema.designShares),
      ),
    )
    .for("update")
    .limit(1);
  if (!design) throw new Error(`Design "${designId}" not found.`);

  const fileRows = await database
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, designId))
    .orderBy(schema.designFiles.id)
    .for("update");
  const storedFiles: SnapshotFile[] = fileRows
    .map((file) => ({
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
      content: file.content,
      source: "stored" as const,
    }))
    .sort((left, right) => compareDesignFileIds(left.id, right.id));
  if (
    storedFiles.length !== preparedFiles.fileIds.length ||
    storedFiles.some(
      (file, index) => file.id !== preparedFiles.fileIds[index],
    ) ||
    storedFiles.length !== capture.collaborationVersions.size
  ) {
    throw new DesignVersionCheckpointChangedError();
  }

  const txExec = getDesignSourceMutationExec(database as object);
  for (const fileId of preparedFiles.fileIds) {
    const lease = preparedFiles.leases.get(fileId);
    const expectedVersion = capture.collaborationVersions.get(fileId);
    if (
      !lease ||
      expectedVersion === undefined ||
      lease.baseVersion !== expectedVersion
    ) {
      throw new DesignVersionCheckpointChangedError();
    }
    const collaboration = await lockPreparedSourceCollaboration(
      txExec,
      fileId,
      lease,
    );
    if (collaboration.needsSeed) {
      throw new DesignVersionCheckpointChangedError();
    }
  }

  const [latest] = await database
    .select({
      id: schema.designVersions.id,
      snapshot: schema.designVersions.snapshot,
      createdAt: schema.designVersions.createdAt,
      label: schema.designVersions.label,
      chatContext: schema.designVersions.chatContext,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.designId, designId))
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      desc(schema.designVersions.createdAt),
      desc(schema.designVersions.id),
    )
    .limit(1);

  const currentFingerprint = persistedSourceFingerprintForRows(
    designId,
    options,
    { design, storedFiles },
  );
  if (currentFingerprint !== capture.persistedSourceFingerprint) {
    throw new DesignVersionCheckpointChangedError();
  }
  return { design, storedFiles, latest };
}

export async function persistPreparedDesignVersionCheckpoint(
  preparedCheckpoint: PreparedDesignVersionCheckpoint,
  preparedFiles: PreparedDesignVersionSourceFiles,
  database: DesignDatabase,
): Promise<{ id: string; createdAt: string; label: string }> {
  const { designId, options, capture, id, createdAt } = preparedCheckpoint;
  const current = await readPreparedCheckpointSourceInTransaction(
    designId,
    options,
    preparedFiles,
    capture,
    database,
  );

  const latest = current.latest;
  if (preparedCheckpoint.existingVersion) {
    if (!latestVersionMatches(capture.latest, latest)) {
      throw new DesignVersionCheckpointChangedError();
    }
    return versionFromLatest(preparedCheckpoint.existingVersion, options.label);
  }
  const existingById = await database
    .select({
      id: schema.designVersions.id,
      snapshot: schema.designVersions.snapshot,
      createdAt: schema.designVersions.createdAt,
      label: schema.designVersions.label,
      chatContext: schema.designVersions.chatContext,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.id, id))
    .limit(1);
  const existing = existingById[0];
  if (existing) {
    const contextMatches =
      latestVersionChatContextCheck(existing, options.chatContext) === "match";
    const stateMatches = latestVersionStateHashCheck(
      existing,
      capture.stateHash,
    );
    if (
      !contextMatches ||
      stateMatches.status !== "valid" ||
      !stateMatches.matches
    ) {
      throw new DesignVersionCheckpointChangedError();
    }
    preparedCheckpoint.duplicateBlob = preparedCheckpoint.uploadedBlob;
    return versionFromLatest(existing, options.label);
  }

  if (!latestVersionMatches(capture.latest, latest)) {
    const stateHashCheck = latest
      ? latestVersionStateHashCheck(latest, capture.stateHash)
      : { status: "unreadable" as const };
    if (
      latest &&
      latestVersionChatContextCheck(latest, options.chatContext) === "match" &&
      stateHashCheck.status === "valid" &&
      stateHashCheck.matches
    ) {
      preparedCheckpoint.duplicateBlob = preparedCheckpoint.uploadedBlob;
      return versionFromLatest(latest, options.label);
    }
    throw new DesignVersionCheckpointChangedError();
  }

  if (!preparedCheckpoint.storedSnapshot) {
    throw new DesignVersionCheckpointChangedError();
  }

  preparedCheckpoint.persistenceStarted = true;
  const [inserted] = await database
    .insert(schema.designVersions)
    .values({
      id,
      designId,
      label: options.label,
      snapshot: preparedCheckpoint.storedSnapshot,
      chatContext: options.chatContext
        ? JSON.stringify(options.chatContext)
        : null,
      fileCount: capture.liveSnapshot.files.length,
      createdAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.designVersions.id });
  const [stored] = await database
    .select({
      id: schema.designVersions.id,
      createdAt: schema.designVersions.createdAt,
      label: schema.designVersions.label,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.id, id))
    .limit(1);
  if (!stored) throw new Error("Design version was not persisted.");
  if (!inserted)
    preparedCheckpoint.duplicateBlob = preparedCheckpoint.uploadedBlob;
  return {
    id: stored.id,
    createdAt: stored.createdAt ?? createdAt,
    label: stored.label ?? options.label,
  };
}

export async function cleanupPreparedDesignVersionCheckpoint(
  preparedCheckpoint: PreparedDesignVersionCheckpoint,
  committed: boolean,
  definitiveRollback = false,
): Promise<void> {
  const blob = committed
    ? (preparedCheckpoint.duplicateBlob ??
      (!preparedCheckpoint.persistenceStarted
        ? preparedCheckpoint.uploadedBlob
        : null))
    : preparedCheckpoint.persistenceStarted && !definitiveRollback
      ? null
      : preparedCheckpoint.uploadedBlob;
  if (!blob) return;
  try {
    const cleanup = await deletePrivateBlob(blob);
    if (!cleanup.deleted) {
      console.warn("[design-version] staged blob cleanup was not confirmed");
    }
  } catch {
    console.warn("[design-version] staged blob cleanup failed");
  }
}

async function captureDesignVersion(
  designId: string,
  options: PreparedDesignVersionCheckpoint["options"],
  accessContract: "editor" | "creative-context-read" = "editor",
): Promise<{ id: string; createdAt: string; label: string }> {
  const isCreativeContextRead = accessContract === "creative-context-read";
  const preparedCheckpoint = isCreativeContextRead
    ? await prepareDesignVersionCheckpointForCreativeContextCapture(
        designId,
        options,
      )
    : await prepareDesignVersionCheckpoint(designId, options);
  const withPreparedSourceFiles = isCreativeContextRead
    ? withPreparedDesignVersionSourceFilesForCreativeContextCapture
    : withPreparedDesignVersionSourceFiles;
  const requiredAccess = isCreativeContextRead ? "viewer" : "editor";
  const transactionOutcome = {
    callbackCompleted: false,
    rollbackConfirmed: false,
  };
  try {
    const result = await withPreparedSourceFiles(designId, (preparedFiles) =>
      withDesignSourceMutationTransaction(
        designId,
        async (tx) => {
          await assertAccess("design", designId, requiredAccess);
          return persistPreparedDesignVersionCheckpoint(
            preparedCheckpoint,
            preparedFiles,
            tx,
          );
        },
        transactionOutcome,
      ),
    );
    await cleanupPreparedDesignVersionCheckpoint(preparedCheckpoint, true);
    return result;
  } catch (error) {
    await cleanupPreparedDesignVersionCheckpoint(
      preparedCheckpoint,
      false,
      transactionOutcome.rollbackConfirmed,
    );
    throw error;
  }
}

export async function prepareDesignVersionBeforeAgentEditInVersionLock(
  designId: string,
  context?: ActionRunContext,
): Promise<PreparedDesignVersionCheckpoint | null> {
  if (!context) return null;
  const chatContext = actionChatContext(context);
  const editorContext = editorActionContext(context);
  if (!chatContext && !editorContext) return null;

  let options: PreparedDesignVersionCheckpoint["options"];
  if (editorContext) {
    options = {
      label: context.actionName
        ? `Before editor edit: ${context.actionName}`
        : "Before editor edit",
      chatContext: editorContext,
    };
  } else if (chatContext) {
    const key = chatContextKey(chatContext);
    if (!key) return null;
    const rows = await getDb()
      .select({ chatContext: schema.designVersions.chatContext })
      .from(schema.designVersions)
      .where(eq(schema.designVersions.designId, designId))
      .orderBy(
        asc(isNull(schema.designVersions.createdAt)),
        desc(schema.designVersions.createdAt),
        desc(schema.designVersions.id),
      )
      .limit(CHAT_VERSION_LOOKBACK);
    for (const row of rows) {
      try {
        if (chatContextKey(parseStoredChatContext(row.chatContext)) === key) {
          return null;
        }
      } catch {
        continue;
      }
    }
    options = {
      label: context.actionName
        ? `Before chat edit: ${context.actionName}`
        : "Before chat edit",
      chatContext,
    };
  } else {
    return null;
  }

  return prepareDesignVersionCheckpoint(designId, options);
}

export async function withDesignVersionLock<T>(
  designId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = designVersionLocks.get(designId) ?? Promise.resolve();
  const next = previous.then(work, work);
  designVersionLocks.set(designId, next);
  const cleanup = () => {
    if (designVersionLocks.get(designId) === next) {
      designVersionLocks.delete(designId);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

export async function createDesignVersionSnapshot(
  designId: string,
  options: {
    label: string;
    chatContext?: DesignVersionChatContext;
    deletionGeometry?: ComponentDeletionGeometry;
  },
) {
  return withDesignVersionLock(designId, async () => {
    return captureDesignVersion(designId, options);
  });
}

export async function createDesignVersionSnapshotWithSourceMutationLock(
  designId: string,
  options: {
    label: string;
    chatContext?: DesignVersionChatContext;
    deletionGeometry?: ComponentDeletionGeometry;
  },
) {
  return withDesignVersionLock(designId, async () => {
    return captureDesignVersion(designId, options);
  });
}

/**
 * Creative Context reads historically allowed any Design viewer to submit a
 * snapshot. Keep that narrow capture path viewer-authorized while rechecking
 * access with the source locked before its version row is written.
 */
export async function createDesignVersionSnapshotForCreativeContextCapture(
  designId: string,
  options: {
    label: string;
    chatContext?: DesignVersionChatContext;
    deletionGeometry?: ComponentDeletionGeometry;
  },
) {
  return withDesignVersionLock(designId, async () => {
    return captureDesignVersion(designId, options, "creative-context-read");
  });
}

export async function createDesignChatBeginningSnapshot(
  designId: string,
  run: { threadId: string; runId: string },
) {
  return withDesignVersionLock(designId, async () => {
    const rows = await getDb()
      .select({ id: schema.designVersions.id })
      .from(schema.designVersions)
      .where(
        and(
          eq(schema.designVersions.designId, designId),
          eq(
            schema.designVersions.id,
            designVersionIdForIdempotencyKey(
              designId,
              `chat-start:${run.threadId}`,
            ),
          ),
        ),
      )
      .limit(1);
    if (rows.length) return null;
    return captureDesignVersion(designId, {
      label: "Before chat",
      chatContext: { ...run, phase: "start" },
      idempotencyKey: `chat-start:${run.threadId}`,
    });
  });
}

function checkpointSkipReason(
  error: unknown,
): DesignVersionCheckpointSkipReason {
  return error instanceof DesignCheckpointBlobUnavailableError
    ? "blob-storage-unavailable"
    : "checkpoint-failed";
}

async function snapshotDesignBeforeAgentEditInLock(
  designId: string,
  context: ActionRunContext,
  database?: DesignDatabase,
  editorCheckpointMode: "auxiliary" | "required" = "auxiliary",
  allowCheckpointFailureSkip = false,
): Promise<DesignVersionCheckpointResult> {
  const chatContext = actionChatContext(context);
  const editorContext = editorActionContext(context);
  if (!chatContext && !editorContext) return null;

  await assertAccess("design", designId, "editor");
  if (editorContext) {
    if (editorCheckpointMode === "required") {
      return await captureDesignVersion(designId, {
        label: context.actionName
          ? `Before editor edit: ${context.actionName}`
          : "Before editor edit",
        chatContext: editorContext,
      });
    }
    if (isThrottledEditorCheckpointCaller(context.caller)) {
      const [latestVersion] = await (database ?? getDb())
        .select({
          id: schema.designVersions.id,
          createdAt: schema.designVersions.createdAt,
          label: schema.designVersions.label,
          chatContext: schema.designVersions.chatContext,
        })
        .from(schema.designVersions)
        .where(eq(schema.designVersions.designId, designId))
        .orderBy(
          asc(isNull(schema.designVersions.createdAt)),
          desc(schema.designVersions.createdAt),
          desc(schema.designVersions.id),
        )
        .limit(1);
      if (latestVersion) {
        let latestChatContext: DesignVersionChatContext | undefined;
        try {
          latestChatContext = parseStoredChatContext(latestVersion.chatContext);
        } catch {
          latestChatContext = undefined;
        }
        const latestIsThrottledEditorCheckpoint =
          latestChatContext?.surface === "editor" &&
          isThrottledEditorCheckpointCaller(latestChatContext.caller);
        const latestAgeMs = Date.now() - versionTime(latestVersion.createdAt);
        if (
          latestIsThrottledEditorCheckpoint &&
          latestAgeMs < EDITOR_CHECKPOINT_THROTTLE_MS
        ) {
          return {
            id: latestVersion.id,
            createdAt: latestVersion.createdAt ?? new Date().toISOString(),
            label: latestVersion.label ?? "Before editor edit",
          };
        }
      }
      if (allowCheckpointFailureSkip) {
        const recentSkip = editorCheckpointRecentSkips.get(designId);
        if (
          recentSkip &&
          Date.now() - recentSkip.at < EDITOR_CHECKPOINT_THROTTLE_MS
        ) {
          return { skipped: true, reason: recentSkip.reason };
        }
      }
    }
    try {
      const captured = await captureDesignVersion(designId, {
        label: context.actionName
          ? `Before editor edit: ${context.actionName}`
          : "Before editor edit",
        chatContext: editorContext,
      });
      editorCheckpointRecentSkips.delete(designId);
      return captured;
    } catch (error) {
      const reason = checkpointSkipReason(error);
      captureError(error, {
        tags: { source: "design-versions", checkpoint: "editor" },
        extra: { designId, actionName: context.actionName },
      });
      if (!allowCheckpointFailureSkip) throw error;
      if (isThrottledEditorCheckpointCaller(context.caller)) {
        editorCheckpointRecentSkips.set(designId, { at: Date.now(), reason });
      }
      return { skipped: true, reason };
    }
  }
  if (!chatContext) return null;
  const key = chatContextKey(chatContext);
  if (!key) return null;

  const rows = await (database ?? getDb())
    .select({
      id: schema.designVersions.id,
      createdAt: schema.designVersions.createdAt,
      label: schema.designVersions.label,
      chatContext: schema.designVersions.chatContext,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.designId, designId))
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      desc(schema.designVersions.createdAt),
      desc(schema.designVersions.id),
    )
    .limit(CHAT_VERSION_LOOKBACK);

  let existing: { id: string; createdAt: string; label: string } | undefined;
  for (const row of rows) {
    let rowChatContext: DesignVersionChatContext | undefined;
    try {
      rowChatContext = parseStoredChatContext(row.chatContext);
    } catch {
      continue;
    }
    if (chatContextKey(rowChatContext) !== key) continue;
    const candidate = {
      id: row.id,
      createdAt: row.createdAt ?? new Date().toISOString(),
      label: row.label ?? "Before chat edit",
    };
    if (
      !existing ||
      versionTime(candidate.createdAt) < versionTime(existing.createdAt)
    ) {
      existing = candidate;
    }
  }
  if (existing) return existing;

  return captureDesignVersion(designId, {
    label: context.actionName
      ? `Before chat edit: ${context.actionName}`
      : "Before chat edit",
    chatContext,
  });
}

export async function snapshotDesignBeforeAgentEdit(
  designId: string,
  context?: ActionRunContext,
  options?: {
    allowCheckpointFailureSkip?: boolean;
  },
): Promise<DesignVersionCheckpointResult> {
  if (!context) return null;
  return withDesignVersionLock(designId, () =>
    snapshotDesignBeforeAgentEditInLock(
      designId,
      context,
      undefined,
      "auxiliary",
      options?.allowCheckpointFailureSkip ?? false,
    ),
  );
}

export async function snapshotDesignBeforeAgentEditInVersionLock(
  designId: string,
  context?: ActionRunContext,
  database?: DesignDatabase,
): Promise<DesignVersionCheckpointResult> {
  if (!context) return null;
  return snapshotDesignBeforeAgentEditInLock(
    designId,
    context,
    database,
    "required",
  );
}

export async function listDesignVersions(
  designId: string,
  limit: number,
  threadId?: string,
): Promise<{
  designId: string;
  count: number;
  invalidCount: number;
  versions: DesignVersionListEntry[];
}> {
  await assertAccess("design", designId, "viewer");
  const db = getDb();
  const rows = await db
    .select({
      id: schema.designVersions.id,
      label: schema.designVersions.label,
      createdAt: schema.designVersions.createdAt,
      chatContext: schema.designVersions.chatContext,
      fileCount: schema.designVersions.fileCount,
    })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.designId, designId))
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      desc(schema.designVersions.createdAt),
      desc(schema.designVersions.id),
    )
    .limit(limit);
  const beginningRows = await db
    .select({
      id: schema.designVersions.id,
      label: schema.designVersions.label,
      createdAt: schema.designVersions.createdAt,
      chatContext: schema.designVersions.chatContext,
      fileCount: schema.designVersions.fileCount,
    })
    .from(schema.designVersions)
    .where(
      threadId
        ? and(
            eq(schema.designVersions.designId, designId),
            eq(
              schema.designVersions.id,
              designVersionIdForIdempotencyKey(
                designId,
                `chat-start:${threadId}`,
              ),
            ),
          )
        : and(
            eq(schema.designVersions.designId, designId),
            like(schema.designVersions.chatContext, '%"phase":"start"%'),
          ),
    )
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      asc(schema.designVersions.createdAt),
    )
    .limit(threadId ? 1 : limit);
  const rowsById = new Map(
    [...rows, ...beginningRows].map((row) => [row.id, row]),
  );

  const regular: DesignVersionListEntry[] = [];
  const chat = new Map<string, DesignVersionListEntry>();
  const activeStartEntries: DesignVersionListEntry[] = [];
  let invalidCount = 0;
  for (const row of rowsById.values()) {
    let chatContext: DesignVersionChatContext | undefined;
    try {
      chatContext = parseStoredChatContext(row.chatContext);
    } catch {
      invalidCount += 1;
      continue;
    }
    const entry: DesignVersionListEntry = {
      id: row.id,
      designId,
      label: row.label,
      createdAt: row.createdAt,
      source:
        chatContext?.surface === "editor"
          ? "editor"
          : chatContext
            ? "chat"
            : "legacy",
      fileCount: row.fileCount ?? 0,
      chatContext: chatContext ?? null,
      editable: Boolean(chatContext),
    };
    const key = chatContextKey(chatContext);
    if (!key) {
      regular.push(entry);
      continue;
    }
    if (
      threadId &&
      chatContext?.threadId === threadId &&
      chatContext.phase === "start"
    ) {
      activeStartEntries.push(entry);
      continue;
    }
    const previous = chat.get(key);
    const replacePrevious =
      !previous ||
      (chatContext?.phase === "end"
        ? versionTime(entry.createdAt) > versionTime(previous.createdAt)
        : versionTime(entry.createdAt) < versionTime(previous.createdAt));
    if (replacePrevious) chat.set(key, entry);
  }

  const versions = [...regular, ...chat.values(), ...activeStartEntries].sort(
    (left, right) => versionTime(right.createdAt) - versionTime(left.createdAt),
  );
  const limitedVersions = versions.slice(0, limit);
  const activeStart = threadId
    ? versions.find(
        (version) =>
          version.chatContext?.threadId === threadId &&
          version.chatContext.phase === "start",
      )
    : undefined;
  if (activeStart && !limitedVersions.includes(activeStart)) {
    limitedVersions[limitedVersions.length - 1] = activeStart;
    limitedVersions.sort(
      (left, right) =>
        versionTime(right.createdAt) - versionTime(left.createdAt),
    );
  }
  return {
    designId,
    count: limitedVersions.length,
    invalidCount,
    versions: limitedVersions,
  };
}

interface RestoreFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
}

export async function restoreDesignVersion(args: {
  designId: string;
  versionId: string;
  context?: ActionRunContext;
}): Promise<{
  id: string;
  restoredVersionId: string;
  beforeRestoreVersionId: string;
  restoredFileCount: number;
  removedFileCount: number;
  updatedAt: string;
  collaborationReconcilePending: string[];
}> {
  return withDesignVersionLock(args.designId, async () => {
    await assertAccess("design", args.designId, "editor");
    const db = getDb();
    const [version] = await db
      .select({
        id: schema.designVersions.id,
        snapshot: schema.designVersions.snapshot,
      })
      .from(schema.designVersions)
      .where(
        and(
          eq(schema.designVersions.id, args.versionId),
          eq(schema.designVersions.designId, args.designId),
        ),
      )
      .limit(1);
    if (!version) {
      throw new Error(`Design version not found: ${args.versionId}`);
    }

    let target: ParsedDesignVersionSnapshot;
    try {
      target = await readDesignVersionSnapshot(version.snapshot, args.designId);
    } catch (error) {
      throw new Error(
        `Design version ${args.versionId} cannot be restored: ${error instanceof Error ? error.message : "invalid snapshot"}`,
      );
    }

    if (target.designSystemId) {
      await assertAccess("design-system", target.designSystemId, "viewer");
    }

    const currentFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, args.designId));
    const currentEmail = normalizeEmail(
      args.context?.userEmail ?? getRequestUserEmail(),
    );
    const awarenessFileIds = [
      ...currentFiles.map((file) => file.id),
      ...target.files.flatMap((file) => (file.id ? [file.id] : [])),
    ];
    await assertNoForeignCollaborators(awarenessFileIds, currentEmail);

    const preparedCheckpoint = await prepareDesignVersionCheckpoint(
      args.designId,
      { label: "Before restore" },
    );
    const transactionOutcome = {
      callbackCompleted: false,
      rollbackConfirmed: false,
    };
    let result: {
      beforeRestoreVersionId: string;
      restore: {
        updatedAt: string;
        files: RestoreFile[];
        deletedFileIds: string[];
      };
    };
    try {
      result = await withPreparedDesignVersionSourceFiles(
        args.designId,
        async (preparedFiles) =>
          withDesignSourceMutationTransaction(
            args.designId,
            async (tx) => {
              await assertAccess("design", args.designId, "editor");
              await lockDesignFilesTable(tx);
              const lockedFiles = await tx
                .select()
                .from(schema.designFiles)
                .where(eq(schema.designFiles.designId, args.designId));
              await assertNoForeignCollaborators(
                [
                  ...lockedFiles.map((file) => file.id),
                  ...target.files.flatMap((file) => (file.id ? [file.id] : [])),
                ],
                currentEmail,
              );

              const [currentDesign] = await tx
                .select()
                .from(schema.designs)
                .where(eq(schema.designs.id, args.designId))
                .limit(1);
              if (!currentDesign) {
                throw new Error(`Design "${args.designId}" not found.`);
              }
              await assertNoUnpersistedCollaborativeEdits(
                lockedFiles,
                preparedCheckpoint.capture.liveSnapshot,
              );
              const before = await persistPreparedDesignVersionCheckpoint(
                preparedCheckpoint,
                preparedFiles,
                tx,
              );
              const now = new Date();
              const updatedAt = nextUpdatedAt(
                currentDesign.updatedAt ?? null,
                now,
              );
              const currentById = new Map(
                lockedFiles.map((file) => [file.id, file]),
              );
              const currentByFilename = new Map(
                lockedFiles.map((file) => [file.filename, file]),
              );
              const claimedIds = new Set<string>();
              const restoreFiles: RestoreFile[] = [];

              for (const targetFile of target.files) {
                const byId = targetFile.id
                  ? currentById.get(targetFile.id)
                  : undefined;
                const byFilename = currentByFilename.get(targetFile.filename);
                if (byId && byFilename && byId.id !== byFilename.id) {
                  throw new DesignVersionRestoreConflictError(
                    `Design version has conflicting identity for "${targetFile.filename}".`,
                  );
                }
                const existing = byId ?? byFilename;
                let id = existing?.id ?? targetFile.id ?? nanoid();
                if (claimedIds.has(id)) {
                  throw new DesignVersionRestoreConflictError(
                    "Design version maps more than one file to the same row.",
                  );
                }
                if (!existing && targetFile.id) {
                  const [collision] = await tx
                    .select({ designId: schema.designFiles.designId })
                    .from(schema.designFiles)
                    .where(eq(schema.designFiles.id, targetFile.id))
                    .limit(1);
                  if (collision && collision.designId !== args.designId) {
                    id = nanoid();
                  }
                }
                claimedIds.add(id);
                const restored = {
                  id,
                  filename: targetFile.filename,
                  fileType: targetFile.fileType,
                  content: targetFile.content,
                };
                restoreFiles.push(restored);

                if (existing) {
                  const updateResult = await tx
                    .update(schema.designFiles)
                    .set({
                      filename: restored.filename,
                      fileType: restored.fileType,
                      content: restored.content,
                      contentOperationSource: null,
                      contentOperationRevision: null,
                      contentOperationResultHash: null,
                      updatedAt,
                    })
                    .where(designFileRevisionWhere(existing));
                  const affected = affectedRowCount(updateResult);
                  if (affected === 0) {
                    throw new DesignVersionRestoreConflictError(
                      "A design file changed while history was being restored. Refresh and try again.",
                    );
                  }
                  if (affected === undefined) {
                    const [confirmed] = await tx
                      .select({
                        filename: schema.designFiles.filename,
                        fileType: schema.designFiles.fileType,
                        content: schema.designFiles.content,
                        updatedAt: schema.designFiles.updatedAt,
                      })
                      .from(schema.designFiles)
                      .where(eq(schema.designFiles.id, existing.id))
                      .limit(1);
                    if (
                      !confirmed ||
                      confirmed.filename !== restored.filename ||
                      confirmed.fileType !== restored.fileType ||
                      confirmed.content !== restored.content ||
                      confirmed.updatedAt !== updatedAt
                    ) {
                      throw new DesignVersionRestoreConflictError(
                        "A design file changed while history was being restored. Refresh and try again.",
                      );
                    }
                  }
                } else {
                  await tx.insert(schema.designFiles).values({
                    id: restored.id,
                    designId: args.designId,
                    filename: restored.filename,
                    fileType: restored.fileType,
                    content: restored.content,
                    contentOperationSource: null,
                    contentOperationRevision: null,
                    contentOperationResultHash: null,
                    createdAt: updatedAt,
                    updatedAt,
                  });
                }
              }

              for (const currentFile of lockedFiles) {
                if (claimedIds.has(currentFile.id)) continue;
                const deleteResult = await tx
                  .delete(schema.designFiles)
                  .where(designFileRevisionWhere(currentFile));
                const affected = affectedRowCount(deleteResult);
                if (affected === 0) {
                  throw new DesignVersionRestoreConflictError(
                    "A design file changed while history was being restored. Refresh and try again.",
                  );
                }
                if (affected === undefined) {
                  const [confirmed] = await tx
                    .select({ id: schema.designFiles.id })
                    .from(schema.designFiles)
                    .where(eq(schema.designFiles.id, currentFile.id))
                    .limit(1);
                  if (confirmed) {
                    throw new DesignVersionRestoreConflictError(
                      "A design file changed while history was being restored. Refresh and try again.",
                    );
                  }
                }
              }

              const designUpdates: Record<string, unknown> = { updatedAt };
              if (target.designData !== undefined) {
                designUpdates.data = target.designData;
                designUpdates.dataOperationRevisions = "{}";
              }
              if (target.designTitle !== undefined) {
                designUpdates.title = target.designTitle;
              }
              if (target.designDescription !== undefined) {
                designUpdates.description = target.designDescription;
              }
              if (target.projectType !== undefined) {
                designUpdates.projectType = target.projectType;
              }
              if (target.designSystemId !== undefined) {
                designUpdates.designSystemId = target.designSystemId;
              }

              const designRevision = currentDesign.updatedAt;
              await tx
                .update(schema.designs)
                .set(designUpdates)
                .where(
                  and(
                    eq(schema.designs.id, args.designId),
                    designRevision === null || designRevision === undefined
                      ? isNull(schema.designs.updatedAt)
                      : eq(schema.designs.updatedAt, designRevision),
                  ),
                );
              const [confirmed] = await tx
                .select({ updatedAt: schema.designs.updatedAt })
                .from(schema.designs)
                .where(eq(schema.designs.id, args.designId))
                .limit(1);
              if (!confirmed || confirmed.updatedAt !== updatedAt) {
                throw new DesignVersionRestoreConflictError(
                  "Design changed while history was being restored. Refresh and try again.",
                );
              }

              return {
                beforeRestoreVersionId: before.id,
                restore: {
                  updatedAt,
                  files: restoreFiles,
                  deletedFileIds: lockedFiles
                    .filter((file) => !claimedIds.has(file.id))
                    .map((file) => file.id),
                },
              };
            },
            transactionOutcome,
          ),
        target.files.flatMap((file) => (file.id ? [file.id] : [])),
      );
      await cleanupPreparedDesignVersionCheckpoint(preparedCheckpoint, true);
    } catch (error) {
      await cleanupPreparedDesignVersionCheckpoint(
        preparedCheckpoint,
        false,
        transactionOutcome.rollbackConfirmed,
      );
      throw error;
    }

    const pending: string[] = [];
    await Promise.all([
      ...result.restore.files.map(async (file) => {
        try {
          if (await hasCollabState(file.id)) {
            await applyText(file.id, file.content, "content", "restore");
          } else {
            await seedFromText(file.id, file.content);
          }
        } catch {
          pending.push(file.id);
        }
      }),
      ...result.restore.deletedFileIds.map(async (fileId) => {
        try {
          if (await hasCollabState(fileId)) {
            await applyText(fileId, "", "content", "restore");
          }
        } catch {
          pending.push(fileId);
        }
      }),
    ]);

    if (pending.length > 0) {
      throw new DesignVersionRestoreConflictError(
        "Design was restored in SQL, but collaboration sync is still pending. Refresh and try again before editing.",
      );
    }

    await writeAppState("refresh-signal", {
      ts: result.restore.updatedAt,
      source: "restore-design-version",
    });

    return {
      id: args.designId,
      restoredVersionId: args.versionId,
      beforeRestoreVersionId: result.beforeRestoreVersionId,
      restoredFileCount: result.restore.files.length,
      removedFileCount: result.restore.deletedFileIds.length,
      updatedAt: result.restore.updatedAt,
      collaborationReconcilePending: [...new Set(pending)],
    };
  });
}
