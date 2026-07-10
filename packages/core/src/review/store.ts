import { getDbExec, isPostgres } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import type { Visibility } from "../sharing/schema.js";
import type {
  ReviewActorKind,
  ReviewComment,
  ReviewCommentKind,
  ReviewCommentStatus,
  ReviewMention,
  ReviewResolutionTarget,
  ReviewScope,
  ReviewStatus,
  ReviewStatusEntry,
} from "./types.js";

let reviewTablesInitPromise: Promise<void> | undefined;

export interface InsertReviewCommentInput {
  resourceType: string;
  resourceId: string;
  threadId?: string | null;
  parentCommentId?: string | null;
  targetId?: string | null;
  kind?: ReviewCommentKind;
  anchor?: unknown | null;
  body: string;
  authorEmail?: string | null;
  authorName?: string | null;
  createdBy?: ReviewActorKind;
  resolutionTarget?: ReviewResolutionTarget | null;
  mentions?: ReviewMention[];
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  metadata?: Record<string, unknown> | null;
}

export interface QueryReviewCommentsInput {
  resourceType: string;
  resourceId: string;
  scope: ReviewScope;
  bypassScope?: boolean;
  includeResolved?: boolean;
  includeDeleted?: boolean;
  targetId?: string | null;
  limit?: number;
}

export interface UpsertReviewStatusInput {
  resourceType: string;
  resourceId: string;
  status: ReviewStatus;
  note?: string | null;
  updatedBy?: string | null;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  metadata?: Record<string, unknown> | null;
}

export async function ensureReviewTables(): Promise<void> {
  if (!reviewTablesInitPromise) {
    reviewTablesInitPromise = (async () => {
      const client = getDbExec();
      const createCommentsSql = `CREATE TABLE IF NOT EXISTS agent_review_comments (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      parent_comment_id TEXT,
      target_id TEXT,
      kind TEXT NOT NULL DEFAULT 'comment',
      status TEXT NOT NULL DEFAULT 'open',
      anchor_json TEXT,
      body TEXT NOT NULL,
      author_email TEXT,
      author_name TEXT,
      created_by TEXT NOT NULL DEFAULT 'human',
      resolution_target TEXT,
      mentions_json TEXT,
      owner_email TEXT,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      resolved_by TEXT,
      resolved_at TEXT,
      consumed_at TEXT,
      deleted_by TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    )`;
      const createStatusesSql = `CREATE TABLE IF NOT EXISTS agent_review_statuses (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      owner_email TEXT,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      metadata_json TEXT
    )`;
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_agent_review_comments_resource
           ON agent_review_comments (resource_type, resource_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_review_comments_thread
           ON agent_review_comments (thread_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_review_comments_owner
           ON agent_review_comments (owner_email, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_review_comments_org
           ON agent_review_comments (org_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_review_statuses_resource
           ON agent_review_statuses (resource_type, resource_id)`,
      ];

      if (isPostgres()) {
        await ensureTableExists("agent_review_comments", createCommentsSql);
        await ensureTableExists("agent_review_statuses", createStatusesSql);
        await ensureIndexExists(
          "idx_agent_review_comments_resource",
          indexes[0],
        );
        await ensureIndexExists("idx_agent_review_comments_thread", indexes[1]);
        await ensureIndexExists("idx_agent_review_comments_owner", indexes[2]);
        await ensureIndexExists("idx_agent_review_comments_org", indexes[3]);
        await ensureIndexExists(
          "idx_agent_review_statuses_resource",
          indexes[4],
        );
      } else {
        await client.execute(createCommentsSql);
        await client.execute(createStatusesSql);
        for (const indexSql of indexes) {
          await client.execute(indexSql);
        }
      }
    })();
  }

  await reviewTablesInitPromise;
}

export async function insertReviewComment(
  input: InsertReviewCommentInput,
): Promise<ReviewComment> {
  await ensureReviewTables();
  const client = getDbExec();
  const id = createReviewId("comment");
  const now = new Date().toISOString();
  const comment: ReviewComment = {
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    threadId: input.threadId ?? id,
    parentCommentId: input.parentCommentId ?? null,
    targetId: input.targetId ?? null,
    kind: input.kind ?? "comment",
    status: "open",
    anchor: input.anchor ?? null,
    body: input.body,
    authorEmail: input.authorEmail ?? null,
    authorName: input.authorName ?? null,
    createdBy: input.createdBy ?? "human",
    resolutionTarget: input.resolutionTarget ?? null,
    mentions: input.mentions ?? [],
    ownerEmail: input.ownerEmail ?? input.authorEmail ?? null,
    orgId: input.orgId ?? null,
    visibility:
      input.visibility === "org" || input.visibility === "public"
        ? input.visibility
        : "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? null,
  };

  await client.execute({
    sql: `INSERT INTO agent_review_comments (
      id,
      resource_type,
      resource_id,
      thread_id,
      parent_comment_id,
      target_id,
      kind,
      status,
      anchor_json,
      body,
      author_email,
      author_name,
      created_by,
      resolution_target,
      mentions_json,
      owner_email,
      org_id,
      visibility,
      resolved_by,
      resolved_at,
      consumed_at,
      deleted_by,
      deleted_at,
      created_at,
      updated_at,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      comment.id,
      comment.resourceType,
      comment.resourceId,
      comment.threadId,
      comment.parentCommentId,
      comment.targetId,
      comment.kind,
      comment.status,
      stringifyOptionalJson(comment.anchor),
      comment.body,
      comment.authorEmail,
      comment.authorName,
      comment.createdBy,
      comment.resolutionTarget,
      stringifyOptionalJson(comment.mentions),
      comment.ownerEmail,
      comment.orgId,
      comment.visibility,
      comment.resolvedBy,
      comment.resolvedAt,
      comment.consumedAt,
      comment.deletedBy,
      comment.deletedAt,
      comment.createdAt,
      comment.updatedAt,
      stringifyOptionalJson(comment.metadata),
    ],
  });

  return comment;
}

export async function queryReviewComments(
  input: QueryReviewCommentsInput,
): Promise<ReviewComment[]> {
  await ensureReviewTables();
  const client = getDbExec();
  const { clause, params } = input.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedReviewClause(input.scope);
  const filters = ["resource_type = ?", "resource_id = ?", clause];
  const filterParams: unknown[] = [
    input.resourceType,
    input.resourceId,
    ...params,
  ];
  if (!input.includeDeleted) {
    filters.push("deleted_at IS NULL");
    filters.push("status <> 'deleted'");
  }
  if (!input.includeResolved) {
    filters.push("status <> 'resolved'");
  }
  if (input.targetId !== undefined) {
    if (input.targetId === null) {
      filters.push("target_id IS NULL");
    } else {
      filters.push("target_id = ?");
      filterParams.push(input.targetId);
    }
  }

  const result = await client.execute({
    sql: `SELECT ${commentColumns()}
       FROM agent_review_comments
      WHERE ${filters.join(" AND ")}
      ORDER BY created_at ASC
      LIMIT ?`,
    args: [...filterParams, clampLimit(input.limit)],
  });
  return (result.rows ?? []).map(mapCommentRow);
}

export async function getReviewCommentById(
  id: string,
  scope: ReviewScope,
  options: { bypassScope?: boolean } = {},
): Promise<ReviewComment | null> {
  await ensureReviewTables();
  const client = getDbExec();
  const { clause, params } = options.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedReviewClause(scope);
  const result = await client.execute({
    sql: `SELECT ${commentColumns()}
       FROM agent_review_comments
      WHERE id = ? AND ${clause}
      LIMIT 1`,
    args: [id, ...params],
  });
  const row = result.rows?.[0];
  return row ? mapCommentRow(row) : null;
}

export async function resolveReviewThread(
  threadId: string,
  resolvedBy?: string | null,
  resource?: { resourceType: string; resourceId: string },
): Promise<number> {
  await ensureReviewTables();
  const now = new Date().toISOString();
  const resourceClause = resource
    ? "AND resource_type = ? AND resource_id = ?"
    : "";
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_comments
        SET status = 'resolved',
            resolved_by = ?,
            resolved_at = ?,
            updated_at = ?
      WHERE thread_id = ? AND deleted_at IS NULL ${resourceClause}`,
    args: [
      resolvedBy ?? null,
      now,
      now,
      threadId,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  return result.rowsAffected ?? 0;
}

export async function deleteReviewComment(
  id: string,
  deletedBy?: string | null,
): Promise<number> {
  await ensureReviewTables();
  const now = new Date().toISOString();
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_comments
        SET status = 'deleted',
            deleted_by = ?,
            deleted_at = ?,
            updated_at = ?
      WHERE id = ?`,
    args: [deletedBy ?? null, now, now, id],
  });
  return result.rowsAffected ?? 0;
}

export async function consumeReviewFeedback(
  ids: string[],
  consumedAt = new Date().toISOString(),
  resource?: { resourceType: string; resourceId: string },
): Promise<number> {
  if (!ids.length) {
    return 0;
  }
  await ensureReviewTables();
  const placeholders = ids.map(() => "?").join(", ");
  const resourceClause = resource
    ? "AND resource_type = ? AND resource_id = ?"
    : "";
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_comments
        SET consumed_at = ?,
            updated_at = ?
      WHERE id IN (${placeholders}) ${resourceClause}`,
    args: [
      consumedAt,
      consumedAt,
      ...ids,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  return result.rowsAffected ?? 0;
}

export async function upsertReviewStatus(
  input: UpsertReviewStatusInput,
): Promise<ReviewStatusEntry> {
  await ensureReviewTables();
  const client = getDbExec();
  const id = statusId(input.resourceType, input.resourceId);
  const now = new Date().toISOString();
  const existing = await client.execute({
    sql: "SELECT id FROM agent_review_statuses WHERE id = ? LIMIT 1",
    args: [id],
  });
  const entry: ReviewStatusEntry = {
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    status: input.status,
    note: input.note ?? null,
    updatedBy: input.updatedBy ?? null,
    updatedAt: now,
    ownerEmail: input.ownerEmail ?? input.updatedBy ?? null,
    orgId: input.orgId ?? null,
    visibility:
      input.visibility === "org" || input.visibility === "public"
        ? input.visibility
        : "private",
    metadata: input.metadata ?? null,
  };

  if (existing.rows?.length) {
    await client.execute({
      sql: `UPDATE agent_review_statuses
          SET status = ?,
              note = ?,
              updated_by = ?,
              updated_at = ?,
              owner_email = ?,
              org_id = ?,
              visibility = ?,
              metadata_json = ?
        WHERE id = ?`,
      args: [
        entry.status,
        entry.note,
        entry.updatedBy,
        entry.updatedAt,
        entry.ownerEmail,
        entry.orgId,
        entry.visibility,
        stringifyOptionalJson(entry.metadata),
        entry.id,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO agent_review_statuses (
        id,
        resource_type,
        resource_id,
        status,
        note,
        updated_by,
        updated_at,
        owner_email,
        org_id,
        visibility,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id,
        entry.resourceType,
        entry.resourceId,
        entry.status,
        entry.note,
        entry.updatedBy,
        entry.updatedAt,
        entry.ownerEmail,
        entry.orgId,
        entry.visibility,
        stringifyOptionalJson(entry.metadata),
      ],
    });
  }

  return entry;
}

export async function getReviewStatus(
  resourceType: string,
  resourceId: string,
  scope: ReviewScope,
  options: { bypassScope?: boolean } = {},
): Promise<ReviewStatusEntry | null> {
  await ensureReviewTables();
  const client = getDbExec();
  const { clause, params } = options.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedReviewClause(scope);
  const result = await client.execute({
    sql: `SELECT ${statusColumns()}
       FROM agent_review_statuses
      WHERE resource_type = ? AND resource_id = ? AND ${clause}
      LIMIT 1`,
    args: [resourceType, resourceId, ...params],
  });
  const row = result.rows?.[0];
  return row ? mapStatusRow(row) : null;
}

export function __resetReviewInitForTests(): void {
  reviewTablesInitPromise = undefined;
}

function commentColumns(): string {
  return [
    "id",
    "resource_type",
    "resource_id",
    "thread_id",
    "parent_comment_id",
    "target_id",
    "kind",
    "status",
    "anchor_json",
    "body",
    "author_email",
    "author_name",
    "created_by",
    "resolution_target",
    "mentions_json",
    "owner_email",
    "org_id",
    "visibility",
    "resolved_by",
    "resolved_at",
    "consumed_at",
    "deleted_by",
    "deleted_at",
    "created_at",
    "updated_at",
    "metadata_json",
  ].join(", ");
}

function statusColumns(): string {
  return [
    "id",
    "resource_type",
    "resource_id",
    "status",
    "note",
    "updated_by",
    "updated_at",
    "owner_email",
    "org_id",
    "visibility",
    "metadata_json",
  ].join(", ");
}

function scopedReviewClause(scope: ReviewScope): {
  clause: string;
  params: unknown[];
} {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (scope.userEmail) {
    parts.push("owner_email = ?");
    params.push(scope.userEmail);
  }
  if (scope.orgId) {
    parts.push("(visibility = 'org' AND org_id = ?)");
    params.push(scope.orgId);
  }
  parts.push("visibility = 'public'");

  return { clause: `(${parts.join(" OR ")})`, params };
}

function mapCommentRow(row: Record<string, unknown>): ReviewComment {
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    threadId: String(row.thread_id),
    parentCommentId: nullableString(row.parent_comment_id),
    targetId: nullableString(row.target_id),
    kind: normalizeKind(row.kind),
    status: normalizeCommentStatus(row.status),
    anchor: parseOptionalJson(row.anchor_json),
    body: String(row.body),
    authorEmail: nullableString(row.author_email),
    authorName: nullableString(row.author_name),
    createdBy: normalizeActor(row.created_by),
    resolutionTarget: normalizeResolutionTarget(row.resolution_target),
    mentions: parseMentions(row.mentions_json),
    ownerEmail: nullableString(row.owner_email),
    orgId: nullableString(row.org_id),
    visibility: normalizeVisibility(row.visibility),
    resolvedBy: nullableString(row.resolved_by),
    resolvedAt: nullableString(row.resolved_at),
    consumedAt: nullableString(row.consumed_at),
    deletedBy: nullableString(row.deleted_by),
    deletedAt: nullableString(row.deleted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: parseObject(row.metadata_json),
  };
}

function mapStatusRow(row: Record<string, unknown>): ReviewStatusEntry {
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    status: normalizeReviewStatus(row.status),
    note: nullableString(row.note),
    updatedBy: nullableString(row.updated_by),
    updatedAt: String(row.updated_at),
    ownerEmail: nullableString(row.owner_email),
    orgId: nullableString(row.org_id),
    visibility: normalizeVisibility(row.visibility),
    metadata: parseObject(row.metadata_json),
  };
}

function createReviewId(prefix: string): string {
  return `rev_${prefix}_${globalThis.crypto.randomUUID()}`;
}

function statusId(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 200;
  }
  return Math.min(500, Math.max(1, Math.floor(value ?? 200)));
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function stringifyOptionalJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseOptionalJson(value: unknown): unknown | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value);
}

function parseObject(value: unknown): Record<string, unknown> | null {
  const parsed = parseOptionalJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function parseMentions(value: unknown): ReviewMention[] {
  const parsed = parseOptionalJson(value);
  return Array.isArray(parsed) ? (parsed as ReviewMention[]) : [];
}

function normalizeVisibility(value: unknown): Visibility {
  return value === "org" || value === "public" ? value : "private";
}

function normalizeKind(value: unknown): ReviewCommentKind {
  return value === "annotation" ||
    value === "correction" ||
    value === "question" ||
    value === "decision" ||
    value === "review"
    ? value
    : "comment";
}

function normalizeCommentStatus(value: unknown): ReviewCommentStatus {
  return value === "resolved" || value === "deleted" ? value : "open";
}

function normalizeReviewStatus(value: unknown): ReviewStatus {
  return value === "in_review" ||
    value === "approved" ||
    value === "changes_requested"
    ? value
    : "draft";
}

function normalizeActor(value: unknown): ReviewActorKind {
  return value === "agent" || value === "import" || value === "system"
    ? value
    : "human";
}

function normalizeResolutionTarget(
  value: unknown,
): ReviewResolutionTarget | null {
  return value === "agent" || value === "human" ? value : null;
}
