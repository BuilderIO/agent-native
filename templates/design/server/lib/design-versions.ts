import { createHash } from "node:crypto";

import {
  withoutWriteObservation,
  type ActionRunContext,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  applyText,
  hasCollabState,
  loadAwarenessRowsStrict,
  seedFromText,
  type PreparedYDocMutationLease,
  withPreparedYDocMutation,
} from "@agent-native/core/collab";
import {
  deletePrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { captureError } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  notLike,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  componentDeletionGeometrySchema,
  type ComponentDeletionGeometry,
} from "../../shared/component-archive.js";
import { shouldUseLiveFileContent } from "../../shared/html-content.js";
import { getDb, schema } from "../db/index.js";
import {
  affectedRowCount,
  lockDesignFilesTable,
  withDesignSourceMutationTransaction,
  withSourceFileWriteLock,
} from "../source-workspace.js";
import { withServerOwnedTweakSelectionsRevisionJson } from "./design-data-mutation.js";
import {
  firstRow,
  visualEditCapabilityDesignScope,
} from "./visual-edit-capability.js";

const CHAT_VERSION_LOOKBACK = 100;
const EDITOR_CHECKPOINT_THROTTLE_MS = 5 * 60 * 1000;
const DESIGN_VERSION_RETAINED_CHECKPOINTS = 100;
const DESIGN_VERSION_PRUNE_BATCH = 25;
const MANIFEST_INSERT_CHUNK = 500;
const DESIGN_HISTORY_MANIFEST_KIND = "design-history-manifest";
const FILE_ENTRY = "file";
const DESIGN_STATE_ENTRY = "design";
export const COMPONENT_DELETE_CHECKPOINT_LABEL = "Before component delete";

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
  createdAt?: string;
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

export type DesignVersionCheckpointResult = {
  id: string;
  createdAt: string;
  label: string;
} | null;

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
  return parseDesignVersionSnapshotValue(value, expectedDesignId);
}

function parseDesignVersionSnapshotValue(
  value: unknown,
  expectedDesignId: string,
): ParsedDesignVersionSnapshot {
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
    files.push({
      id,
      filename,
      fileType,
      content,
      ...(typeof candidate.createdAt === "string"
        ? { createdAt: candidate.createdAt }
        : {}),
    });
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
  if (isRecord(value) && value.snapshotKind === DESIGN_HISTORY_MANIFEST_KIND) {
    return readDesignVersionManifest(value, expectedDesignId);
  }
  if (!isRecord(value) || value.snapshotKind !== "design-history-blob") {
    return parseDesignVersionSnapshotValue(value, expectedDesignId);
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

function manifestVersionId(
  value: Record<string, unknown>,
  expectedDesignId: string,
): string {
  if (value.designId !== expectedDesignId) {
    throw new Error("Design version belongs to a different design.");
  }
  if (typeof value.versionId !== "string" || !value.versionId) {
    throw new Error("Design version manifest reference is invalid.");
  }
  return value.versionId;
}

function sortSnapshotFiles(files: DesignVersionFile[]): DesignVersionFile[] {
  return files.sort((a, b) => {
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.filename.localeCompare(b.filename);
  });
}

async function readDesignVersionManifest(
  value: Record<string, unknown>,
  expectedDesignId: string,
): Promise<ParsedDesignVersionSnapshot> {
  const versionId = manifestVersionId(value, expectedDesignId);
  const db = getDb();
  const entryCount = firstRow(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.designVersionFiles)
      .where(
        and(
          eq(schema.designVersionFiles.versionId, versionId),
          eq(schema.designVersionFiles.designId, expectedDesignId),
        ),
      ),
  );
  const rows = await db
    .select({
      entryKind: schema.designVersionFiles.entryKind,
      fileId: schema.designVersionFiles.fileId,
      filename: schema.designVersionFiles.filename,
      fileType: schema.designVersionFiles.fileType,
      fileCreatedAt: schema.designVersionFiles.fileCreatedAt,
      body: schema.designContents.body,
    })
    .from(schema.designVersionFiles)
    .innerJoin(
      schema.designContents,
      and(
        eq(schema.designContents.designId, schema.designVersionFiles.designId),
        eq(schema.designContents.hash, schema.designVersionFiles.contentHash),
      ),
    )
    .where(
      and(
        eq(schema.designVersionFiles.versionId, versionId),
        eq(schema.designVersionFiles.designId, expectedDesignId),
      ),
    );
  if (
    rows.length !== Number(entryCount?.count ?? -1) ||
    rows.length !== Number(value.fileCount) + 1
  ) {
    throw new Error("Design version content is missing.");
  }

  const designState = rows.find((row) => row.entryKind === DESIGN_STATE_ENTRY);
  if (!designState) {
    throw new Error("Design version content is missing.");
  }
  let state: unknown;
  try {
    state = JSON.parse(designState.body);
  } catch {
    throw new Error("Design version design state is not valid JSON.");
  }
  if (!isRecord(state)) {
    throw new Error("Design version design state is invalid.");
  }
  return parseDesignVersionSnapshotValue(
    {
      designId: expectedDesignId,
      designData: state.designData,
      designTitle: state.designTitle,
      designDescription: state.designDescription,
      projectType: state.projectType,
      designSystemId: state.designSystemId,
      deletionGeometry: value.deletionGeometry,
      capturedAt: value.capturedAt,
      chatContext: value.chatContext,
      files: sortSnapshotFiles(
        rows
          .filter((row) => row.entryKind === FILE_ENTRY)
          .map((row) => ({
            id: row.fileId,
            filename: row.filename,
            fileType: row.fileType,
            content: row.body,
            ...(row.fileCreatedAt ? { createdAt: row.fileCreatedAt } : {}),
          })),
      ),
    },
    expectedDesignId,
  );
}

export async function readDesignVersionFile(args: {
  designId: string;
  versionId: string;
  fileId: string;
}): Promise<{
  file?: DesignVersionFile | undefined;
  deletionGeometry?: ComponentDeletionGeometry | undefined;
} | null> {
  const db = getDb();
  const version = firstRow(
    await db
      .select({ snapshot: schema.designVersions.snapshot })
      .from(schema.designVersions)
      .where(
        and(
          eq(schema.designVersions.id, args.versionId),
          eq(schema.designVersions.designId, args.designId),
        ),
      )
      .limit(1),
  );
  if (!version) return null;

  let value: unknown;
  try {
    value = JSON.parse(version.snapshot);
  } catch {
    throw new Error("Design version snapshot is not valid JSON.");
  }
  if (!isRecord(value) || value.snapshotKind !== DESIGN_HISTORY_MANIFEST_KIND) {
    const snapshot = await readDesignVersionSnapshot(
      version.snapshot,
      args.designId,
    );
    return {
      file: snapshot.files.find((candidate) => candidate.id === args.fileId),
      deletionGeometry: snapshot.deletionGeometry,
    };
  }

  const versionId = manifestVersionId(value, args.designId);
  let deletionGeometry: ComponentDeletionGeometry | undefined;
  if (value.deletionGeometry !== undefined) {
    const parsed = componentDeletionGeometrySchema.safeParse(
      value.deletionGeometry,
    );
    if (!parsed.success) {
      throw new Error(
        "Design version snapshot has invalid component deletion geometry.",
      );
    }
    deletionGeometry = parsed.data;
  }
  const entry = firstRow(
    await db
      .select({
        filename: schema.designVersionFiles.filename,
        fileType: schema.designVersionFiles.fileType,
        fileCreatedAt: schema.designVersionFiles.fileCreatedAt,
        contentHash: schema.designVersionFiles.contentHash,
      })
      .from(schema.designVersionFiles)
      .where(
        and(
          eq(schema.designVersionFiles.versionId, versionId),
          eq(schema.designVersionFiles.designId, args.designId),
          eq(schema.designVersionFiles.entryKind, FILE_ENTRY),
          eq(schema.designVersionFiles.fileId, args.fileId),
        ),
      )
      .limit(1),
  );
  if (!entry) return { deletionGeometry };
  const content = firstRow(
    await db
      .select({ body: schema.designContents.body })
      .from(schema.designContents)
      .where(
        and(
          eq(schema.designContents.designId, args.designId),
          eq(schema.designContents.hash, entry.contentHash),
        ),
      )
      .limit(1),
  );
  if (!content) throw new Error("Design version content is missing.");
  return {
    file: {
      id: args.fileId,
      filename: entry.filename,
      fileType: entry.fileType,
      content: content.body,
      ...(entry.fileCreatedAt ? { createdAt: entry.fileCreatedAt } : {}),
    },
    deletionGeometry,
  };
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
    if (row.cleared) continue;
    if (row.clientId === AGENT_CLIENT_ID) continue;
    const email = parseAwarenessUserEmail(row.state);
    if (!email || !currentEmail || email !== currentEmail) {
      throw new DesignVersionRestoreConflictError(
        "Design history cannot be restored while another collaborator is active. Ask them to leave the design and try again.",
      );
    }
  }
}

async function assertNoUnpersistedCollaborativeEdits(
  database: DesignDatabase,
  designId: string,
): Promise<void> {
  if ((await readUnpersistedCollaborativeText(database, designId)).size > 0) {
    throw new DesignVersionRestoreConflictError(
      "Design history cannot overwrite unsaved collaborative edits. Save or refresh the design and try again.",
    );
  }
}

type DesignDatabase = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "execute"
>;
type LatestDesignVersion = {
  id: string;
  snapshot: string;
  createdAt: string | null;
  label: string | null;
  chatContext: string | null;
};

type DesignCheckpointOptions = {
  label: string;
  chatContext?: DesignVersionChatContext;
  deletionGeometry?: ComponentDeletionGeometry;
  preferStoredFileContent?: boolean;
  idempotencyKey?: string;
};

export interface PreparedDesignVersionCheckpoint {
  designId: string;
  options: DesignCheckpointOptions;
}

type DesignCheckpointEntry = {
  entryKind: typeof FILE_ENTRY | typeof DESIGN_STATE_ENTRY;
  fileId: string;
  filename: string;
  fileType: string;
  fileCreatedAt: string | null;
  contentHash: string;
  source: "stored" | "collab";
};

const designVersionLocks = new Map<string, Promise<unknown>>();

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sqlResultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | undefined)?.rows;
  if (Array.isArray(rows)) return rows as T[];
  throw new Error("Design history query returned an unexpected result.");
}

function designFileContentHashSql() {
  return sql`coalesce(f.content_hash, encode(sha256(convert_to(f.content, 'UTF8')), 'hex'))`;
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

async function readUnpersistedCollaborativeText(
  database: DesignDatabase,
  designId: string,
): Promise<Map<string, string>> {
  const collabTable = firstRow(
    sqlResultRows<{ present: boolean }>(
      await database.execute(
        sql`SELECT to_regclass('_collab_docs') IS NOT NULL AS "present"`,
      ),
    ),
  );
  if (!collabTable?.present) return new Map();
  const rows = sqlResultRows<{
    id: string;
    fileType: string;
    storedContent: string;
    liveContent: string;
  }>(
    await database.execute(sql`
      SELECT f.id AS "id", f.file_type AS "fileType",
        f.content AS "storedContent", c.text_snapshot AS "liveContent"
      FROM design_files f
      JOIN _collab_docs c ON c.doc_id = f.id
      WHERE f.design_id = ${designId}
        AND c.yjs_state <> ''
        AND c.text_snapshot <> f.content`),
  );
  const live = new Map<string, string>();
  for (const row of rows) {
    if (
      shouldUseLiveFileContent({
        liveContent: row.liveContent,
        storedContent: row.storedContent,
        fileType: row.fileType,
      })
    ) {
      live.set(row.id, row.liveContent);
    }
  }
  return live;
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

async function insertDesignContents(
  database: DesignDatabase,
  designId: string,
  bodies: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [hash, body] of bodies) {
    await database
      .insert(schema.designContents)
      .values({ designId, hash, body })
      .onConflictDoNothing();
  }
}

export async function writeDesignCheckpoint(
  database: DesignDatabase,
  designId: string,
  options: DesignCheckpointOptions,
): Promise<{ id: string; createdAt: string; label: string }> {
  const [design] = await database
    .select({
      data: schema.designs.data,
      title: schema.designs.title,
      description: schema.designs.description,
      projectType: schema.designs.projectType,
      designSystemId: schema.designs.designSystemId,
    })
    .from(schema.designs)
    .where(
      and(
        eq(schema.designs.id, designId),
        visualEditCapabilityDesignScope(
          designId,
          accessFilter(schema.designs, schema.designShares),
        ),
      ),
    )
    .for("share")
    .limit(1);
  if (!design) throw new Error(`Design "${designId}" not found.`);

  const designState = stableStringify({
    designData: parseDesignData(designId, design.data),
    designTitle: design.title,
    designDescription: design.description ?? null,
    projectType: design.projectType,
    designSystemId: design.designSystemId ?? null,
  });
  const designStateHash = sha256Hex(designState);

  const liveText = options.preferStoredFileContent
    ? new Map<string, string>()
    : await readUnpersistedCollaborativeText(database, designId);
  const fileRows = sqlResultRows<{
    id: string;
    filename: string;
    fileType: string;
    createdAt: string | null;
    hash: string;
  }>(
    await database.execute(sql`
      SELECT f.id AS "id", f.filename AS "filename", f.file_type AS "fileType",
        f.created_at AS "createdAt", ${designFileContentHashSql()} AS "hash"
      FROM design_files f
      WHERE f.design_id = ${designId}`),
  );
  const newBodies = new Map<string, string>();
  const entries: DesignCheckpointEntry[] = fileRows
    .map((row): DesignCheckpointEntry => {
      const live = liveText.get(row.id);
      const contentHash = live === undefined ? row.hash : sha256Hex(live);
      if (live !== undefined) newBodies.set(contentHash, live);
      return {
        entryKind: FILE_ENTRY,
        fileId: row.id,
        filename: row.filename,
        fileType: row.fileType,
        fileCreatedAt: row.createdAt,
        contentHash,
        source: live === undefined ? "stored" : "collab",
      };
    })
    .sort((left, right) => compareDesignFileIds(left.fileId, right.fileId));

  const stateHash = sha256Hex(
    stableStringify({
      designStateHash,
      files: entries.map(({ fileId, filename, fileType, contentHash }) => ({
        fileId,
        filename,
        fileType,
        contentHash,
      })),
      deletionGeometry: options.deletionGeometry,
    }),
  );

  const latest = firstRow(
    await database
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
      .limit(1),
  );
  if (
    latest &&
    latestVersionChatContextCheck(latest, options.chatContext) === "match" &&
    (options.label !== COMPONENT_DELETE_CHECKPOINT_LABEL ||
      latest.label === COMPONENT_DELETE_CHECKPOINT_LABEL)
  ) {
    const check = latestVersionStateHashCheck(latest, stateHash);
    if (check.status === "valid" && check.matches) {
      return versionFromLatest(latest, options.label);
    }
  }

  const id = options.idempotencyKey
    ? designVersionIdForIdempotencyKey(designId, options.idempotencyKey)
    : `design-version-${sha256Hex(
        stableStringify({
          designId,
          previousVersionId: latest?.id ?? "initial",
          chatContextKey: chatContextKey(options.chatContext),
          stateHash,
        }),
      )}`;
  const [existing] = await database
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
  if (existing) {
    const stateCheck = latestVersionStateHashCheck(existing, stateHash);
    if (
      latestVersionChatContextCheck(existing, options.chatContext) !==
        "match" ||
      stateCheck.status !== "valid" ||
      !stateCheck.matches
    ) {
      throw new DesignVersionCheckpointChangedError();
    }
    return versionFromLatest(existing, options.label);
  }

  const liveFileIds = [...liveText.keys()];
  await database.execute(sql`
    INSERT INTO design_contents (design_id, hash, body)
    SELECT DISTINCT ON (h.hash) f.design_id, h.hash, f.content
    FROM design_files f
    CROSS JOIN LATERAL (SELECT ${designFileContentHashSql()} AS hash) h
    WHERE f.design_id = ${designId}
      ${
        liveFileIds.length > 0
          ? sql`AND f.id NOT IN (${sql.join(
              liveFileIds.map((fileId) => sql`${fileId}`),
              sql`, `,
            )})`
          : sql``
      }
      AND NOT EXISTS (
        SELECT 1 FROM design_contents c
        WHERE c.design_id = f.design_id AND c.hash = h.hash
      )
    ON CONFLICT (design_id, hash) DO NOTHING`);
  newBodies.set(designStateHash, designState);
  await insertDesignContents(database, designId, newBodies);

  const createdAt = nextRevisionTimestamp(latest?.createdAt);
  const manifest: DesignCheckpointEntry[] = [
    ...entries,
    {
      entryKind: DESIGN_STATE_ENTRY,
      fileId: designId,
      filename: "",
      fileType: "",
      fileCreatedAt: null,
      contentHash: designStateHash,
      source: "stored",
    },
  ];
  await database.insert(schema.designVersions).values({
    id,
    designId,
    label: options.label,
    snapshot: JSON.stringify({
      schemaVersion: 3,
      snapshotKind: DESIGN_HISTORY_MANIFEST_KIND,
      designId,
      versionId: id,
      fileCount: entries.length,
      capturedAt: createdAt,
      stateHash,
      ...(options.chatContext ? { chatContext: options.chatContext } : {}),
      ...(options.deletionGeometry
        ? { deletionGeometry: options.deletionGeometry }
        : {}),
    }),
    chatContext: options.chatContext
      ? JSON.stringify(options.chatContext)
      : null,
    fileCount: entries.length,
    createdAt,
  });
  for (
    let offset = 0;
    offset < manifest.length;
    offset += MANIFEST_INSERT_CHUNK
  ) {
    await database
      .insert(schema.designVersionFiles)
      .values(
        manifest
          .slice(offset, offset + MANIFEST_INSERT_CHUNK)
          .map((entry) => ({ versionId: id, designId, ...entry })),
      );
  }
  return { id, createdAt, label: options.label };
}

export async function pruneDesignVersions(designId: string): Promise<{
  deletedVersionIds: string[];
}> {
  await assertAccess("design", designId, "editor");
  const db = getDb();
  const recent = await db
    .select({ id: schema.designVersions.id })
    .from(schema.designVersions)
    .where(eq(schema.designVersions.designId, designId))
    .orderBy(
      asc(isNull(schema.designVersions.createdAt)),
      desc(schema.designVersions.createdAt),
      desc(schema.designVersions.id),
    )
    .limit(DESIGN_VERSION_RETAINED_CHECKPOINTS);
  if (recent.length < DESIGN_VERSION_RETAINED_CHECKPOINTS) {
    return { deletedVersionIds: [] };
  }

  const protectedIds = new Set(recent.map((row) => row.id));
  const design = firstRow(
    await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1),
  );
  if (!design) return { deletedVersionIds: [] };
  for (const versionId of branchSnapshotVersionIds(design.data)) {
    protectedIds.add(versionId);
  }

  const result = await withDesignSourceMutationTransaction(
    designId,
    async (tx) => {
      const candidates = await tx
        .select({
          id: schema.designVersions.id,
          blobSnapshot: sql<
            string | null
          >`CASE WHEN ${schema.designVersions.snapshot} LIKE '%"snapshotKind":"design-history-blob"%' THEN ${schema.designVersions.snapshot} END`,
        })
        .from(schema.designVersions)
        .where(
          and(
            eq(schema.designVersions.designId, designId),
            notInArray(schema.designVersions.id, [...protectedIds]),
            or(
              isNull(schema.designVersions.label),
              ne(
                schema.designVersions.label,
                COMPONENT_DELETE_CHECKPOINT_LABEL,
              ),
            ),
            or(
              isNull(schema.designVersions.chatContext),
              notLike(schema.designVersions.chatContext, '%"phase":"start"%'),
            ),
          ),
        )
        .orderBy(
          desc(isNull(schema.designVersions.createdAt)),
          asc(schema.designVersions.createdAt),
          asc(schema.designVersions.id),
        )
        .limit(DESIGN_VERSION_PRUNE_BATCH);
      if (candidates.length === 0) {
        return { deletedVersionIds: [], blobs: [] as PrivateBlobHandle[] };
      }
      const versionIds = candidates.map((row) => row.id);
      const hashes = await tx
        .selectDistinct({ hash: schema.designVersionFiles.contentHash })
        .from(schema.designVersionFiles)
        .where(
          and(
            eq(schema.designVersionFiles.designId, designId),
            inArray(schema.designVersionFiles.versionId, versionIds),
          ),
        );
      await tx
        .delete(schema.designVersionFiles)
        .where(
          and(
            eq(schema.designVersionFiles.designId, designId),
            inArray(schema.designVersionFiles.versionId, versionIds),
          ),
        );
      await tx
        .delete(schema.designVersions)
        .where(
          and(
            eq(schema.designVersions.designId, designId),
            inArray(schema.designVersions.id, versionIds),
          ),
        );
      if (hashes.length > 0) {
        await tx.execute(sql`
          DELETE FROM design_contents c
          WHERE c.design_id = ${designId}
            AND c.hash IN (${sql.join(
              hashes.map((row) => sql`${row.hash}`),
              sql`, `,
            )})
            AND NOT EXISTS (
              SELECT 1 FROM design_version_files m
              WHERE m.design_id = c.design_id AND m.content_hash = c.hash
            )`);
      }
      const blobs: PrivateBlobHandle[] = [];
      for (const row of candidates) {
        if (!row.blobSnapshot) continue;
        try {
          const stored: unknown = JSON.parse(row.blobSnapshot);
          if (isRecord(stored) && isPrivateBlobHandle(stored.blob)) {
            blobs.push(stored.blob);
          }
        } catch {
          continue;
        }
      }
      return { deletedVersionIds: versionIds, blobs };
    },
  );

  for (const blob of result.blobs) {
    try {
      await deletePrivateBlob(blob);
    } catch (error) {
      captureError(error, {
        tags: { source: "design-versions", operation: "prune-blob" },
        extra: { designId },
      });
    }
  }
  return { deletedVersionIds: result.deletedVersionIds };
}

function branchSnapshotVersionIds(rawData: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    throw new Error("Design data is not valid JSON; its branches are unknown.");
  }
  if (!isRecord(data) || !Array.isArray(data.branches)) return [];
  return data.branches.flatMap((branch) =>
    isRecord(branch) && typeof branch.preSnapshotVersionId === "string"
      ? [branch.preSnapshotVersionId]
      : [],
  );
}

async function captureDesignVersion(
  designId: string,
  options: DesignCheckpointOptions,
): Promise<{ id: string; createdAt: string; label: string }> {
  const checkpoint = await withDesignSourceMutationTransaction(
    designId,
    async (tx) => {
      await assertAccess("design", designId, "editor");
      return writeDesignCheckpoint(tx, designId, options);
    },
  );
  try {
    await pruneDesignVersions(designId);
  } catch (error) {
    captureError(error, {
      tags: { source: "design-versions", operation: "prune" },
      extra: { designId },
    });
  }
  return checkpoint;
}

export async function persistPreparedDesignVersionCheckpoint(
  preparedCheckpoint: PreparedDesignVersionCheckpoint,
  database: DesignDatabase,
): Promise<{ id: string; createdAt: string; label: string }> {
  return writeDesignCheckpoint(
    database,
    preparedCheckpoint.designId,
    preparedCheckpoint.options,
  );
}

export async function prepareDesignVersionBeforeAgentEditInVersionLock(
  designId: string,
  context?: ActionRunContext,
): Promise<PreparedDesignVersionCheckpoint | null> {
  if (!context) return null;
  const chatContext = actionChatContext(context);
  const editorContext = editorActionContext(context);
  if (!chatContext && !editorContext) return null;

  if (editorContext) {
    return {
      designId,
      options: {
        label: context.actionName
          ? `Before editor edit: ${context.actionName}`
          : "Before editor edit",
        chatContext: editorContext,
      },
    };
  }
  if (!chatContext) return null;
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
  return {
    designId,
    options: {
      label: context.actionName
        ? `Before chat edit: ${context.actionName}`
        : "Before chat edit",
      chatContext,
    },
  };
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

async function snapshotDesignBeforeAgentEditInLock(
  designId: string,
  context: ActionRunContext,
  database?: DesignDatabase,
  editorCheckpointMode: "auxiliary" | "required" = "auxiliary",
): Promise<DesignVersionCheckpointResult> {
  const chatContext = actionChatContext(context);
  const editorContext = editorActionContext(context);
  if (!chatContext && !editorContext) return null;

  await assertAccess("design", designId, "editor");
  if (editorContext) {
    if (
      editorCheckpointMode === "auxiliary" &&
      isThrottledEditorCheckpointCaller(context.caller)
    ) {
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
    }
    return captureDesignVersion(designId, {
      label: context.actionName
        ? `Before editor edit: ${context.actionName}`
        : "Before editor edit",
      chatContext: editorContext,
    });
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
): Promise<DesignVersionCheckpointResult> {
  if (!context) return null;
  // A retry adds no second version: the turn's earlier version is found first,
  // and a new one has a deterministic id and is skipped on a state-hash match.
  return withoutWriteObservation(() =>
    withDesignVersionLock(designId, () =>
      snapshotDesignBeforeAgentEditInLock(designId, context),
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

    const result: {
      beforeRestoreVersionId: string;
      restore: {
        updatedAt: string;
        files: RestoreFile[];
        deletedFileIds: string[];
      };
    } = await withPreparedDesignVersionSourceFiles(
      args.designId,
      async () =>
        withDesignSourceMutationTransaction(args.designId, async (tx) => {
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

          const currentDesign = firstRow(
            await tx
              .select()
              .from(schema.designs)
              .where(eq(schema.designs.id, args.designId))
              .limit(1),
          );
          if (!currentDesign) {
            throw new Error(`Design "${args.designId}" not found.`);
          }
          await assertNoUnpersistedCollaborativeEdits(tx, args.designId);
          const before = await writeDesignCheckpoint(tx, args.designId, {
            label: "Before restore",
          });
          const now = new Date();
          const updatedAt = nextUpdatedAt(currentDesign.updatedAt ?? null, now);
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
              const collision = firstRow(
                await tx
                  .select({ designId: schema.designFiles.designId })
                  .from(schema.designFiles)
                  .where(eq(schema.designFiles.id, targetFile.id))
                  .limit(1),
              );
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
                const confirmed = firstRow(
                  await tx
                    .select({
                      filename: schema.designFiles.filename,
                      fileType: schema.designFiles.fileType,
                      content: schema.designFiles.content,
                      updatedAt: schema.designFiles.updatedAt,
                    })
                    .from(schema.designFiles)
                    .where(eq(schema.designFiles.id, existing.id))
                    .limit(1),
                );
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
                createdAt: targetFile.createdAt ?? updatedAt,
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
              const confirmed = firstRow(
                await tx
                  .select({ id: schema.designFiles.id })
                  .from(schema.designFiles)
                  .where(eq(schema.designFiles.id, currentFile.id))
                  .limit(1),
              );
              if (confirmed) {
                throw new DesignVersionRestoreConflictError(
                  "A design file changed while history was being restored. Refresh and try again.",
                );
              }
            }
          }

          const designUpdates: Record<string, unknown> = { updatedAt };
          if (target.designData !== undefined) {
            designUpdates.data = withServerOwnedTweakSelectionsRevisionJson(
              args.designId,
              currentDesign.data,
              target.designData,
            );
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

          const designRevision = currentDesign.updatedAt;
          await tx
            .update(schema.designs)
            .set(designUpdates)
            .where(
              and(
                eq(schema.designs.id, args.designId),
                designRevision === null
                  ? isNull(schema.designs.updatedAt)
                  : eq(schema.designs.updatedAt, designRevision),
              ),
            );
          const confirmed = firstRow(
            await tx
              .select({ updatedAt: schema.designs.updatedAt })
              .from(schema.designs)
              .where(eq(schema.designs.id, args.designId))
              .limit(1),
          );
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
        }),
      target.files.flatMap((file) => (file.id ? [file.id] : [])),
    );

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
