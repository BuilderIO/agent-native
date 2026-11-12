import { getDbExec, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { sql, type SqlFragment } from "../db/sql.js";
import { defineStore } from "../db/store-registry.js";
import type { Visibility } from "../sharing/schema.js";
import {
  ReviewAnchorError,
  ReviewCommentEmptyError,
  ReviewCommentLinkConflictError,
  ReviewCommentRevisionConflictError,
  ReviewCursorError,
} from "./errors.js";
import {
  hasReviewCommentWriteHook,
  normalizeReviewAnchor,
  runReviewCommentWriteHook,
} from "./registry.js";
import type {
  ReviewActorKind,
  ReviewComment,
  ReviewCommentKind,
  ReviewCommentLink,
  ReviewCommentStatus,
  ReviewCommentReaction,
  ReviewThreadPreference,
  ReviewMention,
  ReviewResolutionTarget,
  ReviewScope,
  ReviewStatus,
  ReviewStatusEntry,
} from "./types.js";

type ReviewThreadStatus = "open" | "resolved";

export interface InsertReviewCommentInput {
  id?: string;
  resourceType: string;
  resourceId: string;
  threadId?: string | null;
  parentCommentId?: string | null;
  targetId?: string | null;
  surfaceId?: string | null;
  kind?: ReviewCommentKind;
  anchor?: unknown;
  anchorKind?: string | null;
  anchorVersion?: number | null;
  body: string;
  authorEmail?: string | null;
  authorName?: string | null;
  createdBy?: ReviewActorKind;
  resolutionTarget?: ReviewResolutionTarget | null;
  replyRouteTarget?: ReviewResolutionTarget | null;
  mentions?: ReviewMention[];
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
  metadata?: Record<string, unknown> | null;
}

export interface InsertReviewCommentResult {
  comment: ReviewComment;
  replayed: boolean;
}

export interface UpdateReviewCommentInput {
  body?: string;
  /**
   * The comment's images, already checked, in place of the ones in its
   * metadata. The rest of its metadata stays.
   */
  attachments?: Record<string, unknown>[];
  anchor?: unknown;
  /** With `anchor`: a new kind for it. Left out, the comment's kind stays. */
  anchorKind?: string | null;
  anchorVersion?: number | null;
  mentions?: ReviewMention[];
}

export interface ReviewCommentWriteOptions {
  /**
   * The revision the caller read. When the comment has moved past it, nothing
   * is written and a `ReviewCommentRevisionConflictError` is thrown.
   */
  expectedRevision?: number | undefined;
  /**
   * Refuse, with a `ReviewCommentEmptyError`, a change that leaves the comment
   * with no text and no image. Checked against the locked row, so a change
   * made since the caller read the comment counts.
   */
  requireContent?: boolean | undefined;
  /** Who made the change, for the resource's write hook. */
  actorEmail?: string | null | undefined;
}

export interface QueryReviewCommentsInput {
  resourceType: string;
  resourceId: string;
  scope: ReviewScope;
  bypassScope?: boolean | undefined;
  includeResolved?: boolean | undefined;
  includeDeleted?: boolean | undefined;
  targetId?: string | null | undefined;
  /** One surface's comments, or with `null` those on no surface. */
  surfaceId?: string | null | undefined;
  newestFirst?: boolean | undefined;
  rootOnly?: boolean;
  resolutionTargets?: readonly (ReviewResolutionTarget | null)[];
  unconsumedOnly?: boolean;
  /** Oldest first only: start after this comment. */
  after?: ReviewCommentPosition | undefined;
  limit?: number | undefined;
}

/** Where a comment sits in oldest-first order. */
export interface ReviewCommentPosition {
  createdAt: string;
  id: string;
}

export interface ReviewCommentPage {
  comments: ReviewComment[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface GetReviewThreadSummaryInput {
  resourceType: string;
  resourceId: string;
  scope: ReviewScope;
  bypassScope?: boolean;
  targetId?: string | null;
  /** One surface's threads, or `null` for those on no surface. */
  surfaceId?: string | null | undefined;
}

export interface ReviewThreadSummary {
  openCount: number;
  agentQueueCount: number;
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

export const reviewStore = defineStore({
  id: "review",
  migrations: [
    {
      name: "baseline",
      run: async () => {
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
      -- guard:allow-identity-column - immutable review creator snapshot
      created_by TEXT NOT NULL DEFAULT 'human',
      resolution_target TEXT,
      reply_route_target TEXT DEFAULT 'legacy',
      notification_completed_at TEXT,
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
        const createReactionsSql = `CREATE TABLE IF NOT EXISTS agent_review_comment_reactions (
      comment_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, actor_email, reaction)
    )`;
        const createPreferencesSql = `CREATE TABLE IF NOT EXISTS agent_review_thread_preferences (
      thread_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_email)
    )`;
        const createNotificationDeliveriesSql = `CREATE TABLE IF NOT EXISTS agent_review_notification_deliveries (
      comment_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      claim_token TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      sent_at TEXT,
      PRIMARY KEY (comment_id, recipient_email)
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
          `CREATE INDEX IF NOT EXISTS idx_agent_review_comments_queue
           ON agent_review_comments (
             resource_type,
             resource_id,
             parent_comment_id,
             resolution_target,
             consumed_at,
             created_at
           )`,
          `CREATE INDEX IF NOT EXISTS idx_agent_review_statuses_resource
           ON agent_review_statuses (resource_type, resource_id)`,
        ];

        await ensureTableExists("agent_review_comments", createCommentsSql);
        await ensureColumnExists(
          "agent_review_comments",
          "reply_route_target",
          "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS reply_route_target TEXT DEFAULT 'legacy'",
        );
        await ensureColumnExists(
          "agent_review_comments",
          "notification_completed_at",
          "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS notification_completed_at TEXT",
        );
        await ensureTableExists("agent_review_statuses", createStatusesSql);
        await ensureTableExists(
          "agent_review_comment_reactions",
          createReactionsSql,
        );
        await ensureTableExists(
          "agent_review_thread_preferences",
          createPreferencesSql,
        );
        await ensureTableExists(
          "agent_review_notification_deliveries",
          createNotificationDeliveriesSql,
        );
        await ensureIndexExists(
          "idx_agent_review_comments_resource",
          indexes[0],
        );
        await ensureIndexExists("idx_agent_review_comments_thread", indexes[1]);
        await ensureIndexExists("idx_agent_review_comments_owner", indexes[2]);
        await ensureIndexExists("idx_agent_review_comments_org", indexes[3]);
        await ensureIndexExists("idx_agent_review_comments_queue", indexes[4]);
        await ensureIndexExists(
          "idx_agent_review_statuses_resource",
          indexes[5],
        );
      },
    },
    {
      // What every app's comments need from one table: the surface a thread
      // sits on, a typed and versioned anchor, a revision that goes up on
      // every change, and links to the same comments in other systems. Each
      // column is nullable or has a default, so code deployed before this
      // keeps inserting.
      name: "storage-contract",
      sql: [
        "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS surface_id TEXT",
        "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS anchor_kind TEXT",
        "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS anchor_version INTEGER",
        "ALTER TABLE agent_review_comments ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1",
        `CREATE TABLE IF NOT EXISTS agent_review_comment_links (
          provider TEXT NOT NULL,
          external_kind TEXT NOT NULL,
          external_id TEXT NOT NULL,
          comment_id TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (provider, external_kind, external_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_agent_review_comment_links_comment
           ON agent_review_comment_links (comment_id)`,
      ],
    },
  ],
});

export function ensureReviewTables(): Promise<void> {
  return reviewStore.ready();
}

export async function setReviewCommentReaction(input: {
  commentId: string;
  actorEmail: string;
  reaction: string;
  active: boolean;
}) {
  await ensureReviewTables();
  const client = getDbExec();
  if (input.active) {
    await client.execute({
      sql: "INSERT INTO agent_review_comment_reactions (comment_id,actor_email,reaction,created_at) VALUES (?,?,?,?) ON CONFLICT (comment_id,actor_email,reaction) DO NOTHING",
      args: [
        input.commentId,
        input.actorEmail,
        input.reaction,
        new Date().toISOString(),
      ],
    });
  } else {
    await client.execute({
      sql: "DELETE FROM agent_review_comment_reactions WHERE comment_id = ? AND actor_email = ? AND reaction = ?",
      args: [input.commentId, input.actorEmail, input.reaction],
    });
  }
  return { ...input };
}

export async function setReviewThreadPreference(input: {
  threadId: string;
  userEmail: string;
  muted?: boolean;
  unread?: boolean;
}) {
  await ensureReviewTables();
  const client = getDbExec();
  const fields = (["muted", "unread"] as const).filter(
    (field) => input[field] !== undefined,
  );
  if (!fields.length) throw new Error("A review thread preference is required");
  await client.execute({
    sql: `INSERT INTO agent_review_thread_preferences (thread_id,user_email,muted,unread,updated_at) VALUES (?,?,?,?,?) ON CONFLICT (thread_id,user_email) DO UPDATE SET ${fields.map((field) => `${field} = excluded.${field}`).join(", ")}, updated_at = excluded.updated_at`,
    args: [
      input.threadId,
      input.userEmail,
      input.muted ? 1 : 0,
      input.unread ? 1 : 0,
      new Date().toISOString(),
    ],
  });
  const row = (
    await client.execute({
      sql: "SELECT muted,unread FROM agent_review_thread_preferences WHERE thread_id = ? AND user_email = ?",
      args: [input.threadId, input.userEmail],
    })
  ).rows[0];
  if (!row)
    throw new Error("Persisted review thread preference is unavailable");
  return {
    threadId: input.threadId,
    muted: Boolean(row.muted),
    unread: Boolean(row.unread),
  };
}

export async function setReviewThreadUnreadPreferences(input: {
  threadIds: string[];
  userEmail: string;
  unread: boolean;
  resource: { resourceType: string; resourceId: string };
}) {
  await ensureReviewTables();
  const threadIds = [...new Set(input.threadIds)];
  if (!threadIds.length) return [];
  const client = getDbExec();
  const placeholders = threadIds.map(() => "?").join(",");
  const roots = await client.execute({
    sql: `SELECT thread_id FROM agent_review_comments WHERE resource_type = ? AND resource_id = ? AND parent_comment_id IS NULL AND status <> 'deleted' AND thread_id IN (${placeholders})`,
    args: [
      input.resource.resourceType,
      input.resource.resourceId,
      ...threadIds,
    ],
  });
  if (
    new Set(roots.rows.map((row) => String(row.thread_id))).size !==
    threadIds.length
  ) {
    throw new Error("Review thread not found");
  }
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO agent_review_thread_preferences (thread_id,user_email,muted,unread,updated_at) VALUES ${threadIds.map(() => "(?,?,?,?,?)").join(",")} ON CONFLICT (thread_id,user_email) DO UPDATE SET unread = excluded.unread, updated_at = excluded.updated_at`,
    args: threadIds.flatMap((threadId) => [
      threadId,
      input.userEmail,
      0,
      input.unread ? 1 : 0,
      now,
    ]),
  });
  const rows = await client.execute({
    sql: `SELECT thread_id,muted,unread FROM agent_review_thread_preferences WHERE user_email = ? AND thread_id IN (${placeholders})`,
    args: [input.userEmail, ...threadIds],
  });
  return rows.rows.map((row) => ({
    threadId: String(row.thread_id),
    muted: Boolean(row.muted),
    unread: Boolean(row.unread),
  }));
}

export async function getReviewDiscussionStateForComments(
  comments: Pick<ReviewComment, "id" | "threadId">[],
  userEmail: string | null,
) {
  const reactions: Record<string, ReviewCommentReaction[]> = {};
  const threadPreferences: Record<string, ReviewThreadPreference> = {};
  if (!comments.length) return { reactions, threadPreferences };
  await ensureReviewTables();
  const commentIds = [...new Set(comments.map((comment) => comment.id))];
  const threadIds = [...new Set(comments.map((comment) => comment.threadId))];
  for (const id of commentIds) reactions[id] = [];
  for (const id of threadIds)
    threadPreferences[id] = { muted: false, unread: false };
  const client = getDbExec();
  const [reactionRows, preferenceRows] = await Promise.all([
    client.execute({
      sql: `SELECT comment_id,reaction,COUNT(*) AS count,MAX(CASE WHEN actor_email = ? THEN 1 ELSE 0 END) AS reacted_by_me FROM agent_review_comment_reactions WHERE comment_id IN (${commentIds.map(() => "?").join(",")}) GROUP BY comment_id,reaction ORDER BY comment_id,reaction`,
      args: [userEmail, ...commentIds],
    }),
    userEmail
      ? client.execute({
          sql: `SELECT thread_id,muted,unread FROM agent_review_thread_preferences WHERE user_email = ? AND thread_id IN (${threadIds.map(() => "?").join(",")})`,
          args: [userEmail, ...threadIds],
        })
      : Promise.resolve({ rows: [] }),
  ]);
  for (const row of reactionRows.rows) {
    reactions[String(row.comment_id)].push({
      reaction: String(row.reaction),
      count: Number(row.count),
      reactedByMe: Boolean(row.reacted_by_me),
    });
  }
  for (const row of preferenceRows.rows) {
    threadPreferences[String(row.thread_id)] = {
      muted: Boolean(row.muted),
      unread: Boolean(row.unread),
    };
  }
  return { reactions, threadPreferences };
}

export async function filterUnmutedReviewThreadRecipients(
  threadId: string,
  recipients: string[],
) {
  if (!recipients.length) return [];
  await ensureReviewTables();
  const rows = (
    await getDbExec().execute({
      sql: `SELECT user_email FROM agent_review_thread_preferences WHERE thread_id = ? AND muted = 1 AND user_email IN (${recipients.map(() => "?").join(",")})`,
      args: [threadId, ...recipients],
    })
  ).rows;
  const muted = new Set(rows.map((row) => String(row.user_email)));
  return recipients.filter((email) => !muted.has(email));
}

/**
 * Runs a comment write in one transaction, so the resource's write hook
 * commits or rolls back with it. Pass the resource type when it's known.
 */
function inReviewWrite<T>(
  resourceType: string,
  write: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const client = getDbExec();
  if (client.transaction) return client.transaction(write);
  assertReviewWriteCanRollBack(resourceType);
  return write(client);
}

/**
 * A write hook refuses a write by throwing, which only a transaction can
 * undo. Every client core ships has transactions; one without them, such as a
 * test double, is refused a write to a hooked resource before anything
 * changes. A write that names no resource is checked against the resources
 * it would touch, read first, so another resource's hook doesn't refuse it.
 */
function assertReviewWriteCanRollBack(...resourceTypes: string[]): void {
  if (resourceTypes.some((type) => hasReviewCommentWriteHook(type))) {
    throw new Error(
      "This database client has no transactions, so it can't run a comment write that has a write hook.",
    );
  }
}

export async function insertReviewComment(
  input: InsertReviewCommentInput,
): Promise<ReviewComment> {
  await ensureReviewTables();
  return inReviewWrite(input.resourceType, (tx) =>
    insertReviewCommentWithClient(input, tx),
  );
}

export async function insertReviewCommentIdempotently(
  input: InsertReviewCommentInput & { id: string },
): Promise<InsertReviewCommentResult> {
  await ensureReviewTables();
  return inReviewWrite(input.resourceType, (tx) =>
    insertReviewCommentIdempotentlyWithClient(input, tx),
  );
}

export async function reviewCommentNotificationCompleted(
  id: string,
): Promise<boolean> {
  await ensureReviewTables();
  const result = await getDbExec().execute({
    sql: "SELECT notification_completed_at FROM agent_review_comments WHERE id = ?",
    args: [id],
  });
  if (!result.rows?.length) throw new Error("Review comment not found");
  return result.rows[0].notification_completed_at !== null;
}

export async function markReviewCommentNotificationCompleted(
  id: string,
): Promise<void> {
  await ensureReviewTables();
  await getDbExec().execute({
    sql: "UPDATE agent_review_comments SET notification_completed_at = ? WHERE id = ? AND notification_completed_at IS NULL",
    args: [new Date().toISOString(), id],
  });
}

export async function claimReviewNotificationDelivery(
  commentId: string,
  recipientEmail: string,
): Promise<{ status: "claimed"; token: string } | { status: "sent" | "busy" }> {
  await ensureReviewTables();
  const token = globalThis.crypto.randomUUID();
  const now = new Date();
  const expiredBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
  const result = await getDbExec().execute({
    sql: `INSERT INTO agent_review_notification_deliveries
      (comment_id, recipient_email, claim_token, claimed_at, sent_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT (comment_id, recipient_email) DO UPDATE
      SET claim_token = excluded.claim_token, claimed_at = excluded.claimed_at
      WHERE agent_review_notification_deliveries.sent_at IS NULL
        AND agent_review_notification_deliveries.claimed_at < ?`,
    args: [commentId, recipientEmail, token, now.toISOString(), expiredBefore],
  });
  if ((result.rowsAffected ?? 0) > 0) return { status: "claimed", token };
  const existing = await getDbExec().execute({
    sql: `SELECT sent_at FROM agent_review_notification_deliveries
      WHERE comment_id = ? AND recipient_email = ?`,
    args: [commentId, recipientEmail],
  });
  if (!existing.rows?.length)
    throw new Error("Review notification receipt is unavailable");
  return { status: existing.rows[0].sent_at ? "sent" : "busy" };
}

export async function finishReviewNotificationDelivery(
  commentId: string,
  recipientEmail: string,
  token: string,
): Promise<void> {
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_notification_deliveries SET sent_at = ?
      WHERE comment_id = ? AND recipient_email = ? AND claim_token = ? AND sent_at IS NULL`,
    args: [new Date().toISOString(), commentId, recipientEmail, token],
  });
  if (result.rowsAffected !== 1)
    throw new Error("Review notification delivery claim was lost");
}

export async function releaseReviewNotificationDelivery(
  commentId: string,
  recipientEmail: string,
  token: string,
): Promise<void> {
  await getDbExec().execute({
    sql: `DELETE FROM agent_review_notification_deliveries
      WHERE comment_id = ? AND recipient_email = ? AND claim_token = ? AND sent_at IS NULL`,
    args: [commentId, recipientEmail, token],
  });
}

/** A reply's thread has no live first comment on the resource. */
export class ReviewThreadNotFoundError extends Error {
  constructor() {
    super("Open review thread not found");
    this.name = "ReviewThreadNotFoundError";
  }
}

/** A reply's thread is there but resolved. */
export class ReviewThreadNotOpenError extends Error {
  constructor() {
    super("Review thread is not open");
    this.name = "ReviewThreadNotOpenError";
  }
}

/** A retried submission's comment saved, then was deleted. */
export class ReviewCommentDeletedError extends Error {
  constructor() {
    super("Review comment was deleted");
    this.name = "ReviewCommentDeletedError";
  }
}

/**
 * A reply needs a live, open root. A root's thread isn't always its own id (a
 * suggestion's correction comment opens one of its own), so the roots are found
 * by thread, as a thread delete finds them. They're held `FOR SHARE` in id
 * order, the order a delete or a resolve takes them `FOR UPDATE`, which inside
 * a transaction makes a concurrent delete or resolve wait for the reply and
 * then see it, or makes the reply see the change and refuse. Outside one the
 * lock lasts only as long as the read. A retry of a reply that already saved,
 * named by `replyId`, still goes through in a thread resolved since, so it can
 * replay.
 */
async function assertLiveReviewRoot(
  client: DbExec,
  threadId: string,
  resource: { resourceType: string; resourceId: string },
  replyId?: string,
): Promise<void> {
  // raw-sql-ok: the statement is constant text; the ids are bound.
  const { rows } = await client.execute({
    sql: `SELECT id, status FROM agent_review_comments
           WHERE thread_id = ? AND resource_type = ? AND resource_id = ?
             AND parent_comment_id IS NULL AND deleted_at IS NULL
           ORDER BY id
           FOR SHARE`,
    args: [threadId, resource.resourceType, resource.resourceId],
  });
  if (rows.length === 0) throw new ReviewThreadNotFoundError();
  if (rows.some((row) => row.status === "open")) return;
  if (replyId) {
    // raw-sql-ok: the statement is constant text; the id is bound.
    const saved = await client.execute({
      sql: `SELECT id FROM agent_review_comments WHERE id = ?`,
      args: [replyId],
    });
    if (saved.rows.length > 0) return;
  }
  throw new ReviewThreadNotOpenError();
}

/**
 * Locks every first comment in a thread `FOR UPDATE`, in id order. A thread
 * delete, a routed reply, routing a thread, resolving it and marking its
 * feedback consumed all change them, and taking them in one order makes each
 * wait for the other rather than each holding a row the other needs.
 */
async function lockReviewThreadRoots(
  client: DbExec,
  threadId: string,
  resource?: { resourceType: string; resourceId: string },
): Promise<void> {
  const onResource = resource
    ? sql`AND resource_type = ${sql.value(resource.resourceType)}
        AND resource_id = ${sql.value(resource.resourceId)}`
    : sql``;
  await client.execute(sql`SELECT id
       FROM agent_review_comments
      WHERE thread_id = ${sql.value(threadId)}
        ${onResource}
        AND parent_comment_id IS NULL
      ORDER BY id
        FOR UPDATE`);
}

export async function insertReviewReply(
  input: InsertReviewCommentInput & {
    threadId: string;
    parentCommentId: string;
  },
  routeTarget: ReviewResolutionTarget | null,
  resource: { resourceType: string; resourceId: string },
): Promise<ReviewComment> {
  await ensureReviewTables();
  const client = getDbExec();
  const insertAndRoute = async (tx: DbExec) => {
    // Routing updates every first comment in the thread, so a routed reply
    // takes them all up front, in the order a thread delete does.
    if (routeTarget) await lockReviewThreadRoots(tx, input.threadId, resource);
    // raw-sql-ok: the helper's statement is constant text; the ids are bound.
    await assertLiveReviewRoot(tx, input.threadId, resource);
    if (routeTarget) {
      const routedCount = await routeReviewThreadWithClient(
        tx,
        input.threadId,
        routeTarget,
        resource,
      );
      if (routedCount < 1) {
        throw new ReviewThreadNotFoundError();
      }
    }
    return insertReviewCommentWithClient(input, tx);
  };
  if (client.transaction) return client.transaction(insertAndRoute);
  assertReviewWriteCanRollBack(resource.resourceType);

  // raw-sql-ok: the helper's statement is constant text; the ids are bound.
  await assertLiveReviewRoot(client, input.threadId, resource);
  const reply = await insertReviewCommentWithClient(input, client);
  if (!routeTarget) return reply;
  try {
    const routedCount = await routeReviewThreadWithClient(
      client,
      input.threadId,
      routeTarget,
      resource,
    );
    if (routedCount < 1) throw new ReviewThreadNotFoundError();
    return reply;
  } catch (error) {
    await client.execute({
      sql: `DELETE FROM agent_review_comments
             WHERE id = ? AND resource_type = ? AND resource_id = ?`,
      args: [reply.id, resource.resourceType, resource.resourceId],
    });
    throw error;
  }
}

export async function insertReviewReplyIdempotently(
  input: InsertReviewCommentInput & {
    id: string;
    threadId: string;
    parentCommentId: string;
  },
  routeTarget: ReviewResolutionTarget | null,
  resource: { resourceType: string; resourceId: string },
): Promise<InsertReviewCommentResult> {
  await ensureReviewTables();
  const client = getDbExec();
  const insertAndRoute = async (tx: DbExec) => {
    // As in insertReviewReply, a routed reply locks the thread's first
    // comments in a thread delete's order before it changes them.
    if (routeTarget) await lockReviewThreadRoots(tx, input.threadId, resource);
    // raw-sql-ok: the helper's statement is constant text; the ids are bound.
    await assertLiveReviewRoot(tx, input.threadId, resource, input.id);
    const result = await insertReviewCommentIdempotentlyWithClient(
      { ...input, replyRouteTarget: routeTarget },
      tx,
    );
    if (result.replayed) {
      await assertMatchingReplyRouteTarget(tx, input.id, routeTarget);
    }
    if (result.replayed || !routeTarget) return result;
    const routedCount = await routeReviewThreadWithClient(
      tx,
      input.threadId,
      routeTarget,
      resource,
    );
    if (routedCount < 1) throw new ReviewThreadNotFoundError();
    return result;
  };
  if (client.transaction) return client.transaction(insertAndRoute);
  assertReviewWriteCanRollBack(resource.resourceType);

  // raw-sql-ok: the helper's statement is constant text; the ids are bound.
  await assertLiveReviewRoot(client, input.threadId, resource, input.id);
  const result = await insertReviewCommentIdempotentlyWithClient(
    { ...input, replyRouteTarget: routeTarget },
    client,
  );
  if (result.replayed) {
    await assertMatchingReplyRouteTarget(client, input.id, routeTarget);
  }
  if (result.replayed || !routeTarget) return result;
  try {
    const routedCount = await routeReviewThreadWithClient(
      client,
      input.threadId,
      routeTarget,
      resource,
    );
    if (routedCount < 1) throw new ReviewThreadNotFoundError();
    return result;
  } catch (error) {
    await client.execute({
      sql: `DELETE FROM agent_review_comments
             WHERE id = ? AND resource_type = ? AND resource_id = ?`,
      args: [input.id, resource.resourceType, resource.resourceId],
    });
    throw error;
  }
}

async function assertMatchingReplyRouteTarget(
  client: DbExec,
  commentId: string,
  routeTarget: ReviewResolutionTarget | null,
): Promise<void> {
  const result = await client.execute({
    sql: `SELECT reply_route_target FROM agent_review_comments WHERE id = ?`,
    args: [commentId],
  });
  if (result.rows?.[0]?.reply_route_target !== routeTarget) {
    throw new Error(
      "Review comment submission ID conflicts with another submission",
    );
  }
}

export async function insertReviewCommentWithClient(
  input: InsertReviewCommentInput,
  client: DbExec,
): Promise<ReviewComment> {
  return (
    await writeReviewCommentWithClient(
      normalizeReviewCommentInput(input),
      client,
    )
  ).comment;
}

/**
 * The input with its anchor checked against the resource's anchor kinds. A
 * reply carries its thread's anchor as stored, so a thread begun before its
 * resource declared kinds can still be answered.
 */
function normalizeReviewCommentInput(
  input: InsertReviewCommentInput,
): InsertReviewCommentInput {
  if (input.parentCommentId) return input;
  return {
    ...input,
    ...normalizeReviewAnchor(input.resourceType, input),
  };
}

let lastReviewCommentWrittenAt = 0;

/**
 * When a new comment is written. Comments written in the same millisecond
 * list by their random ids, so on one server each new comment is stamped at
 * least a millisecond after the last, keeping them in the order they were
 * written. A clock that moved back a second or more, such as a test's fake
 * clock, is taken as it is.
 */
function reviewCommentWriteTime(): string {
  const now = Date.now();
  lastReviewCommentWrittenAt =
    now > lastReviewCommentWrittenAt || lastReviewCommentWrittenAt - now >= 1000
      ? now
      : lastReviewCommentWrittenAt + 1;
  return new Date(lastReviewCommentWrittenAt).toISOString();
}

/** Writes an already normalized comment, then runs the resource's hook. */
async function writeReviewCommentWithClient(
  input: InsertReviewCommentInput,
  client: DbExec,
  onConflictDoNothing = false,
): Promise<InsertReviewCommentResult> {
  const id = input.id ?? createReviewId("comment");
  const now = reviewCommentWriteTime();
  const comment: ReviewComment = {
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    threadId: input.threadId ?? id,
    parentCommentId: input.parentCommentId ?? null,
    targetId: input.targetId ?? null,
    surfaceId: input.surfaceId ?? null,
    kind: input.kind ?? "comment",
    status: "open",
    anchor: input.anchor ?? null,
    anchorKind: input.anchorKind ?? null,
    anchorVersion: input.anchorVersion ?? null,
    revision: 1,
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
    resolutionNote:
      typeof input.metadata?.resolutionNote === "string"
        ? input.metadata.resolutionNote
        : null,
  };

  // raw-sql-ok: the column list is constant text; every value is bound.
  const result = await client.execute({
    sql: `INSERT INTO agent_review_comments (
      id,
      resource_type,
      resource_id,
      thread_id,
      parent_comment_id,
      target_id,
      surface_id,
      kind,
      status,
      anchor_json,
      anchor_kind,
      anchor_version,
      revision,
      body,
      author_email,
      author_name,
      created_by,
      resolution_target,
      reply_route_target,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${onConflictDoNothing ? " ON CONFLICT (id) DO NOTHING" : ""}`,
    args: [
      comment.id,
      comment.resourceType,
      comment.resourceId,
      comment.threadId,
      comment.parentCommentId,
      comment.targetId,
      comment.surfaceId,
      comment.kind,
      comment.status,
      stringifyOptionalJson(comment.anchor),
      comment.anchorKind,
      comment.anchorVersion,
      comment.revision,
      comment.body,
      comment.authorEmail,
      comment.authorName,
      comment.createdBy,
      comment.resolutionTarget,
      input.replyRouteTarget ?? null,
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

  const replayed = result.rowsAffected < 1;
  if (!replayed) {
    await runReviewCommentWriteHook(
      comment.resourceType,
      { type: "created", comment },
      client,
    );
  }
  return { comment, replayed };
}

async function insertReviewCommentIdempotentlyWithClient(
  rawInput: InsertReviewCommentInput & { id: string },
  client: DbExec,
): Promise<InsertReviewCommentResult> {
  // A retry is read the way its first submission was stored, so a change to
  // the resource's anchor kinds since then doesn't turn it into a conflict.
  const existing = await getReviewCommentByIdWithClient(client, rawInput.id);
  if (existing) {
    assertMatchingReviewCommentReceipt(
      existing,
      reviewCommentFromInput(replayedReviewCommentInput(rawInput, existing)),
    );
    return { comment: existing, replayed: true };
  }

  const input = { ...normalizeReviewCommentInput(rawInput), id: rawInput.id };
  const submitted = reviewCommentFromInput(input);
  const insertion = await writeReviewCommentWithClient(input, client, true);
  if (!insertion.replayed) return insertion;

  const receipt = await getReviewCommentByIdWithClient(client, submitted.id);
  if (!receipt) {
    throw new Error("Review comment submission receipt is unavailable");
  }
  assertMatchingReviewCommentReceipt(receipt, submitted);
  return { comment: receipt, replayed: true };
}

/**
 * A retried submission normalized as its stored comment was: untyped if it
 * was stored untyped, and otherwise at its stored anchor version unless the
 * retry names one. A stored kind the resource no longer reads leaves the
 * retry as sent, so a retry of what was stored still finds it and any other
 * still conflicts.
 */
function replayedReviewCommentInput(
  input: InsertReviewCommentInput,
  stored: ReviewComment,
): InsertReviewCommentInput {
  if (input.parentCommentId) return input;
  if (
    stored.anchorKind == null &&
    input.anchorKind == null &&
    input.anchorVersion == null
  ) {
    return { ...input, anchorKind: null, anchorVersion: null };
  }
  const replayed = {
    ...input,
    anchorVersion:
      input.anchorVersion ??
      ((input.anchorKind ?? null) === (stored.anchorKind ?? null)
        ? (stored.anchorVersion ?? null)
        : null),
  };
  try {
    return normalizeReviewCommentInput(replayed);
  } catch (error) {
    if (
      !(error instanceof ReviewAnchorError) ||
      stored.anchorKind == null ||
      input.anchorKind !== stored.anchorKind
    ) {
      throw error;
    }
    return replayed;
  }
}

function reviewCommentFromInput(
  input: InsertReviewCommentInput,
): ReviewComment {
  const id = input.id ?? createReviewId("comment");
  return {
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    threadId: input.threadId ?? id,
    parentCommentId: input.parentCommentId ?? null,
    targetId: input.targetId ?? null,
    surfaceId: input.surfaceId ?? null,
    kind: input.kind ?? "comment",
    status: "open",
    anchor: input.anchor ?? null,
    anchorKind: input.anchorKind ?? null,
    anchorVersion: input.anchorVersion ?? null,
    revision: 1,
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
    createdAt: "",
    updatedAt: "",
    metadata: input.metadata ?? null,
    resolutionNote:
      typeof input.metadata?.resolutionNote === "string"
        ? input.metadata.resolutionNote
        : null,
  };
}

async function getReviewCommentByIdWithClient(
  client: DbExec,
  id: string,
): Promise<ReviewComment | null> {
  const result = await client.execute({
    sql: `SELECT ${commentColumns()}
       FROM agent_review_comments
      WHERE id = ?
      LIMIT 1`,
    args: [id],
  });
  const row = result.rows?.[0];
  return row ? mapCommentRow(row) : null;
}

function assertMatchingReviewCommentReceipt(
  existing: ReviewComment,
  submitted: ReviewComment,
) {
  // Deleting a comment clears fields compared below, so a retry can't match.
  if (existing.status === "deleted") throw new ReviewCommentDeletedError();
  const immutableFields: (keyof ReviewComment)[] = [
    "id",
    "resourceType",
    "resourceId",
    "threadId",
    "parentCommentId",
    "targetId",
    "surfaceId",
    "kind",
    "anchor",
    "anchorKind",
    "anchorVersion",
    "body",
    "authorEmail",
    "createdBy",
    "resolutionTarget",
    "mentions",
    "metadata",
  ];
  if (
    immutableFields.some(
      (field) => !reviewReceiptValueEquals(existing[field], submitted[field]),
    )
  ) {
    throw new Error(
      "Review comment submission ID conflicts with another submission",
    );
  }
}

function reviewReceiptValueEquals(left: unknown, right: unknown): boolean {
  return stableReviewReceiptJson(left) === stableReviewReceiptJson(right);
}

function stableReviewReceiptJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableReviewReceiptJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${stableReviewReceiptJson(entry)}`,
    )
    .join(",")}}`;
}

/** Leave out deleted comments. Neither takes a parameter. */
const LIVE_COMMENT_FILTERS = ["deleted_at IS NULL", "status <> 'deleted'"];

export async function queryReviewComments(
  input: QueryReviewCommentsInput,
): Promise<ReviewComment[]> {
  return selectReviewComments(input);
}

/**
 * The comments a query asks for. `lookahead` reads that many past the limit,
 * so a page can tell whether another follows even at the largest limit.
 */
async function selectReviewComments(
  input: QueryReviewCommentsInput,
  lookahead = 0,
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
    filters.push(...LIVE_COMMENT_FILTERS);
  }
  if (!input.includeResolved) {
    filters.push("status <> 'resolved'");
  }
  if (input.targetId !== undefined) {
    if (input.targetId === null) {
      filters.push("target_id IS NULL");
    } else {
      const { clause: rootScopeClause, params: rootScopeParams } =
        input.bypassScope
          ? { clause: "1 = 1", params: [] as unknown[] }
          : scopedReviewClause(input.scope, "root");
      filters.push(`(
        comment.target_id = ?
        OR (
          comment.parent_comment_id IS NOT NULL
          AND comment.thread_id IN (
            SELECT root.thread_id
              FROM agent_review_comments AS root
             WHERE root.resource_type = ?
               AND root.resource_id = ?
               AND root.parent_comment_id IS NULL
               AND root.target_id = ?
               AND ${rootScopeClause}
          )
        )
      )`);
      filterParams.push(
        input.targetId,
        input.resourceType,
        input.resourceId,
        input.targetId,
        ...rootScopeParams,
      );
    }
  }
  if (input.surfaceId !== undefined) {
    if (input.surfaceId === null) {
      filters.push("surface_id IS NULL");
    } else {
      filters.push("surface_id = ?");
      filterParams.push(input.surfaceId);
    }
  }
  if (input.rootOnly) {
    filters.push("parent_comment_id IS NULL");
  }
  if (input.unconsumedOnly) {
    filters.push("consumed_at IS NULL");
  }
  if (input.resolutionTargets !== undefined) {
    const targets = Array.from(
      new Set(
        input.resolutionTargets.filter(
          (target): target is ReviewResolutionTarget => target !== null,
        ),
      ),
    );
    const resolutionFilters: string[] = [];
    if (targets.length > 0) {
      resolutionFilters.push(
        `resolution_target IN (${targets.map(() => "?").join(", ")})`,
      );
      filterParams.push(...targets);
    }
    if (input.resolutionTargets.includes(null)) {
      resolutionFilters.push("resolution_target IS NULL");
    }
    filters.push(
      resolutionFilters.length > 0
        ? `(${resolutionFilters.join(" OR ")})`
        : "1 = 0",
    );
  }

  if (input.after && input.newestFirst) {
    throw new ReviewCursorError("Comment lists page oldest first only.");
  }

  if (input.newestFirst && !input.rootOnly) {
    // A root deleted before deletes took replies along still anchors its live
    // replies, so they list here as they do oldest first.
    const rootFilters = [
      ...filters.filter((filter) => !LIVE_COMMENT_FILTERS.includes(filter)),
      "parent_comment_id IS NULL",
    ];
    const rootFilterSql = rootFilters
      .map((filter) => filter.replace(/\bcomment\./g, "roots."))
      .join(" AND ");
    const result = await client.execute({
      sql: `WITH selected_review_threads AS (
          SELECT roots.thread_id,
                 activity.latest_activity,
                 MIN(roots.created_at) AS root_created_at,
                 MIN(roots.id) AS root_id
            FROM agent_review_comments AS roots
            JOIN (
              SELECT thread_id, MAX(created_at) AS latest_activity
                FROM agent_review_comments AS comment
               WHERE ${filters.join(" AND ")}
               GROUP BY thread_id
             ) AS activity ON activity.thread_id = roots.thread_id
           WHERE ${rootFilterSql}
           GROUP BY roots.thread_id, activity.latest_activity
           ORDER BY activity.latest_activity DESC,
                    root_created_at DESC,
                    root_id DESC
           LIMIT ?
        )
        SELECT ${commentColumns()}
          FROM agent_review_comments AS comment
         WHERE ${filters.join(" AND ")}
           AND thread_id IN (SELECT thread_id FROM selected_review_threads)
         ORDER BY created_at ASC, id ASC`,
      args: [
        ...filterParams,
        ...filterParams,
        clampLimit(input.limit),
        ...filterParams,
      ],
    });
    return (result.rows ?? []).map(mapCommentRow);
  }

  // A page starts after the last comment of the one before, in the same
  // created-then-id order, so a run of comments written in the same
  // millisecond is neither split nor repeated.
  const afterSql = input.after
    ? "(created_at > ? OR (created_at = ? AND id > ?))"
    : null;
  const afterParams = input.after
    ? [input.after.createdAt, input.after.createdAt, input.after.id]
    : [];
  // raw-sql-ok: the columns and filters are constant text; the values are bound.
  const selectSql = input.rootOnly
    ? `SELECT ${commentColumns()}
         FROM (
           SELECT ${commentColumns()},
                  ROW_NUMBER() OVER (
                    PARTITION BY thread_id
                    ORDER BY created_at ASC, id ASC
                  ) AS review_thread_rank
             FROM agent_review_comments AS comment
            WHERE ${filters.join(" AND ")}
         ) AS distinct_review_threads
        WHERE review_thread_rank = 1${afterSql ? ` AND ${afterSql}` : ""}`
    : `SELECT ${commentColumns()}
         FROM agent_review_comments AS comment
        WHERE ${[...filters, ...(afterSql ? [afterSql] : [])].join(" AND ")}`;
  const order = input.newestFirst ? "DESC" : "ASC";
  // raw-sql-ok: the order is ASC or DESC and the rest constant; values are bound.
  const result = await client.execute({
    sql: `${selectSql}
      ORDER BY created_at ${order}, id ${order}
      LIMIT ?`,
    args: [
      ...filterParams,
      ...afterParams,
      clampLimit(input.limit) + lookahead,
    ],
  });
  const rows = result.rows ?? [];
  return (input.newestFirst ? [...rows].reverse() : rows).map(mapCommentRow);
}

/**
 * One page of a resource's comments, oldest first, and the cursor for the
 * next. Unlike a plain list, which stops at its limit, every comment is
 * reachable page by page.
 */
export async function queryReviewCommentPage(
  input: Omit<QueryReviewCommentsInput, "after"> & {
    cursor?: string | null | undefined;
  },
): Promise<ReviewCommentPage> {
  const { cursor, ...query } = input;
  if (query.newestFirst) {
    throw new ReviewCursorError("Comment lists page oldest first only.");
  }
  const limit = clampLimit(query.limit);
  const queryKey = await reviewCommentQueryKey(query);
  // One more than the page, to know whether another follows.
  const rows = await selectReviewComments(
    {
      ...query,
      after: cursor ? decodeReviewCommentCursor(cursor, queryKey) : undefined,
      limit,
    },
    1,
  );
  const comments = rows.slice(0, limit);
  const last = rows.length > limit ? comments[comments.length - 1] : undefined;
  return {
    comments,
    nextCursor: last ? encodeReviewCommentCursor(queryKey, last) : null,
  };
}

const REVIEW_CURSOR_PREFIX = "c1~";

/**
 * Names a list by what it holds: its resource, filters and reader, but not
 * its page size. A cursor carries it, so one from another list is refused
 * rather than silently skipping what that list holds before its position.
 */
async function reviewCommentQueryKey(
  query: Omit<QueryReviewCommentsInput, "after">,
): Promise<string> {
  const identity = JSON.stringify({
    resourceType: query.resourceType,
    resourceId: query.resourceId,
    scope: query.bypassScope
      ? null
      : {
          userEmail: query.scope.userEmail ?? null,
          orgId: query.scope.orgId ?? null,
        },
    includeResolved: query.includeResolved === true,
    includeDeleted: query.includeDeleted === true,
    // A filter left out drops its key, so "any" differs from `null`.
    targetId: query.targetId,
    surfaceId: query.surfaceId,
    rootOnly: query.rootOnly === true,
    unconsumedOnly: query.unconsumedOnly === true,
    resolutionTargets: query.resolutionTargets
      ? [
          ...new Set(
            query.resolutionTargets.map((target) => JSON.stringify(target)),
          ),
        ].sort()
      : undefined,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * A cursor names its list, then the last comment of a page: its time and its
 * ID.
 */
function encodeReviewCommentCursor(
  queryKey: string,
  position: ReviewCommentPosition,
): string {
  return `${REVIEW_CURSOR_PREFIX}${queryKey}~${position.createdAt}~${position.id}`;
}

function decodeReviewCommentCursor(
  cursor: string,
  queryKey: string,
): ReviewCommentPosition {
  const listPrefix = `${REVIEW_CURSOR_PREFIX}${queryKey}~`;
  if (
    cursor.startsWith(REVIEW_CURSOR_PREFIX) &&
    !cursor.startsWith(listPrefix)
  ) {
    throw new ReviewCursorError(
      "This cursor is from another comment list. Start the list again.",
    );
  }
  const rest = cursor.startsWith(listPrefix)
    ? cursor.slice(listPrefix.length)
    : "";
  // The time never holds a `~`, so the first one after it starts the ID.
  const split = rest.indexOf("~");
  const createdAt = split > 0 ? rest.slice(0, split) : "";
  const id = split > 0 ? rest.slice(split + 1) : "";
  if (!id || Number.isNaN(Date.parse(createdAt))) {
    throw new ReviewCursorError("Not a comment list cursor.");
  }
  return { createdAt, id };
}

export async function getReviewThreadSummary(
  input: GetReviewThreadSummaryInput,
): Promise<ReviewThreadSummary> {
  await ensureReviewTables();
  const { clause, params } = input.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedReviewClause(input.scope);
  const filters = [
    "resource_type = ?",
    "resource_id = ?",
    clause,
    "parent_comment_id IS NULL",
    "deleted_at IS NULL",
    "status = 'open'",
  ];
  const filterParams: unknown[] = [
    input.resourceType,
    input.resourceId,
    ...params,
  ];
  if (input.targetId !== undefined) {
    if (input.targetId === null) {
      filters.push("target_id IS NULL");
    } else {
      filters.push("target_id = ?");
      filterParams.push(input.targetId);
    }
  }
  if (input.surfaceId === null) {
    filters.push("surface_id IS NULL");
  } else if (input.surfaceId !== undefined) {
    filters.push("surface_id = ?");
    filterParams.push(input.surfaceId);
  }
  const result = await getDbExec().execute({
    sql: `SELECT COUNT(DISTINCT thread_id) AS open_count,
                 COUNT(DISTINCT CASE
                   WHEN (resolution_target IS NULL OR resolution_target <> 'human')
                    AND consumed_at IS NULL
                   THEN thread_id
                 END) AS agent_queue_count
            FROM agent_review_comments
           WHERE ${filters.join(" AND ")}`,
    args: filterParams,
  });
  const row = result.rows?.[0];
  return {
    openCount: Number(row?.open_count ?? 0),
    agentQueueCount: Number(row?.agent_queue_count ?? 0),
  };
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

export async function getReviewThreadRoot(
  threadId: string,
  resource: { resourceType: string; resourceId: string },
  scope: ReviewScope,
  options: { bypassScope?: boolean } = {},
): Promise<ReviewComment | null> {
  await ensureReviewTables();
  const { clause, params } = options.bypassScope
    ? { clause: "1 = 1", params: [] as unknown[] }
    : scopedReviewClause(scope);
  const result = await getDbExec().execute({
    sql: `SELECT ${commentColumns()}
       FROM agent_review_comments
      WHERE thread_id = ?
        AND resource_type = ?
        AND resource_id = ?
        AND parent_comment_id IS NULL
        AND ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    args: [threadId, resource.resourceType, resource.resourceId, ...params],
  });
  const row = result.rows?.[0];
  return row ? mapCommentRow(row) : null;
}

/**
 * Takes a live comment `FOR UPDATE`, so a change made from what was read here
 * can't lose a concurrent one.
 */
async function lockLiveReviewComment(
  client: DbExec,
  id: string,
  resource?: { resourceType: string; resourceId: string },
): Promise<ReviewComment | null> {
  // raw-sql-ok: the columns and resource clause are constant; values are bound.
  const result = await client.execute({
    sql: `SELECT ${commentColumns()}
       FROM agent_review_comments
      WHERE id = ?
        ${resource ? "AND resource_type = ? AND resource_id = ?" : ""}
        AND deleted_at IS NULL
        FOR UPDATE`,
    args: [
      id,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  const row = result.rows[0];
  return row ? mapCommentRow(row) : null;
}

/**
 * Changes a comment's body, mentions or anchor. Checks the anchor against its
 * kind, refuses a stale `expectedRevision`, moves the revision on, and runs
 * the resource's hook. Returns null when there's no live comment to change.
 */
async function writeReviewCommentChange(
  client: DbExec,
  id: string,
  input: UpdateReviewCommentInput,
  resource: { resourceType: string; resourceId: string } | undefined,
  options: ReviewCommentWriteOptions,
): Promise<ReviewComment | null> {
  const current = await lockLiveReviewComment(client, id, resource);
  if (!current) return null;
  const revision = current.revision ?? 1;
  if (
    options.expectedRevision !== undefined &&
    options.expectedRevision !== revision
  ) {
    throw new ReviewCommentRevisionConflictError(id, revision);
  }
  if (options.requireContent) {
    const body = input.body ?? current.body;
    const attachments = input.attachments ?? current.metadata?.attachments;
    if (
      !body.trim() &&
      !(Array.isArray(attachments) && attachments.length > 0)
    ) {
      throw new ReviewCommentEmptyError(id);
    }
  }
  const assignments: SqlFragment[] = [];
  if (input.body !== undefined) {
    assignments.push(sql`body = ${sql.value(input.body)}`);
  }
  if (input.mentions !== undefined) {
    assignments.push(
      sql`mentions_json = ${sql.value(stringifyOptionalJson(input.mentions))}`,
    );
  }
  if (input.attachments !== undefined) {
    // From the locked row, so a change made since the caller read the comment
    // keeps the rest of its metadata.
    const { attachments: _previous, ...rest } = current.metadata ?? {};
    const metadata = input.attachments.length
      ? { ...rest, attachments: input.attachments }
      : rest;
    assignments.push(
      sql`metadata_json = ${sql.value(
        stringifyOptionalJson(Object.keys(metadata).length ? metadata : null),
      )}`,
    );
  }
  if (input.anchor !== undefined) {
    // A moved anchor is written now, so at its kind's current version unless
    // the caller says otherwise.
    const anchor = normalizeReviewAnchor(current.resourceType, {
      anchor: input.anchor,
      // Clearing the anchor clears its kind too; null isn't parsed as one.
      anchorKind:
        input.anchorKind !== undefined
          ? input.anchorKind
          : input.anchor === null
            ? null
            : (current.anchorKind ?? null),
      anchorVersion: input.anchorVersion ?? null,
    });
    assignments.push(
      sql`anchor_json = ${sql.value(stringifyOptionalJson(anchor.anchor))}`,
      sql`anchor_kind = ${sql.value(anchor.anchorKind)}`,
      sql`anchor_version = ${sql.value(anchor.anchorVersion)}`,
    );
  }
  if (!assignments.length) return current;
  // The row lock holds the revision inside a transaction. The update checks
  // it again, so a client without one can't write over a change made after
  // its read, whether or not the caller named a revision.
  const result = await client.execute(sql`UPDATE agent_review_comments
        SET ${sql.join(assignments, sql`, `)},
            revision = revision + 1,
            updated_at = ${sql.value(new Date().toISOString())}
      WHERE id = ${sql.value(id)} AND revision = ${sql.value(revision)}`);
  if (result.rowsAffected < 1) {
    const latest = await getReviewCommentByIdWithClient(client, id);
    throw new ReviewCommentRevisionConflictError(id, latest?.revision ?? 1);
  }
  const updated = await getReviewCommentByIdWithClient(client, id);
  if (!updated) throw new Error("Review comment not found after update");
  const changesContent =
    input.body !== undefined ||
    input.mentions !== undefined ||
    input.attachments !== undefined;
  // An edit that also moves the anchor tells the hook both, so a hook keeping
  // anchor or surface state still hears of the move.
  const events = changesContent
    ? input.anchor === undefined
      ? (["edited"] as const)
      : (["edited", "anchor-moved"] as const)
    : (["anchor-moved"] as const);
  for (const type of events) {
    await runReviewCommentWriteHook(
      updated.resourceType,
      { type, comment: updated, actorEmail: options.actorEmail ?? null },
      client,
    );
  }
  return updated;
}

export async function resolveReviewThread(
  threadId: string,
  resolvedBy?: string | null,
  resource?: { resourceType: string; resourceId: string },
  resolutionNote?: string,
  status: ReviewThreadStatus = "resolved",
): Promise<number> {
  await ensureReviewTables();
  const client = getDbExec();
  const resolve = (tx: DbExec) =>
    resolveReviewThreadWithClient(
      tx,
      threadId,
      resolvedBy,
      resource,
      resolutionNote,
      status,
    );
  if (client.transaction) return client.transaction(resolve);
  assertReviewWriteCanRollBack(
    ...(resource
      ? [resource.resourceType]
      : await getReviewThreadResourceTypes(client, threadId)),
  );
  return resolve(client);
}

/** The resources a thread's live comments sit on; a thread ID can repeat. */
async function getReviewThreadResourceTypes(
  client: DbExec,
  threadId: string,
): Promise<string[]> {
  const { rows } = await client.execute(
    sql`SELECT DISTINCT resource_type
       FROM agent_review_comments
      WHERE thread_id = ${sql.value(threadId)} AND deleted_at IS NULL`,
  );
  return rows.map((row) =>
    String((row as { resource_type: unknown }).resource_type),
  );
}

export async function resolveReviewThreadWithClient(
  client: DbExec,
  threadId: string,
  resolvedBy?: string | null,
  resource?: { resourceType: string; resourceId: string },
  resolutionNote?: string,
  status: ReviewThreadStatus = "resolved",
): Promise<number> {
  if (status === "open" && resolutionNote !== undefined) {
    throw new Error("Resolution notes are only supported when resolving");
  }
  // Resolving updates every comment in the thread. It takes the first ones in
  // the order a thread delete does, so neither holds one while it waits for
  // another the other holds.
  await lockReviewThreadRoots(client, threadId, resource);
  const now = new Date().toISOString();
  const resourceClause = resource
    ? "AND resource_type = ? AND resource_id = ?"
    : "";
  // raw-sql-ok: the resource clause is constant text; the ids are bound.
  const root = await client.execute({
    sql: `SELECT metadata_json
       FROM agent_review_comments
      WHERE thread_id = ?
        AND parent_comment_id IS NULL
        AND deleted_at IS NULL
        ${resourceClause}
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    args: [
      threadId,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  if (!root.rows?.[0]) {
    return 0;
  }

  const rootMetadata = parseObject(root.rows[0].metadata_json);
  const nextRootMetadata =
    status === "open"
      ? withoutResolutionNote(rootMetadata)
      : resolutionNote === undefined
        ? undefined
        : { ...(rootMetadata ?? {}), resolutionNote };
  const noteChanges =
    nextRootMetadata !== undefined &&
    stringifyOptionalJson(nextRootMetadata) !==
      stringifyOptionalJson(rootMetadata);
  // Only comments not already in this state change, so resolving a resolved
  // thread again moves no revision and fires no hook; a new resolution note
  // still rewrites the first comment, keeping who resolved it and when.
  // A thread ID can repeat across resources, so a call that names none counts
  // each resource apart and runs each changed one's hook.
  // raw-sql-ok: the resource clause is constant text; the ids are bound.
  const counts = await client.execute({
    sql: `SELECT resource_type, resource_id, COUNT(*) AS live,
            COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS changing
       FROM agent_review_comments
      WHERE thread_id = ? AND deleted_at IS NULL ${resourceClause}
      GROUP BY resource_type, resource_id
      ORDER BY resource_type, resource_id`,
    args: [
      status,
      threadId,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  const perResource = counts.rows.map((row) => ({
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    live: Number(row.live),
    changing: Number(row.changing),
  }));
  const live = perResource.reduce((sum, row) => sum + row.live, 0);
  const changing = perResource.reduce((sum, row) => sum + row.changing, 0);
  if (changing > 0 || noteChanges) {
    const metadataAssignment = noteChanges
      ? ", metadata_json = CASE WHEN parent_comment_id IS NULL THEN ? ELSE metadata_json END"
      : "";
    // raw-sql-ok: the clauses are constant text; every value is bound.
    await client.execute({
      sql: `UPDATE agent_review_comments
          SET status = ?,
              resolved_by = CASE
                WHEN status = ? THEN resolved_by
                WHEN ? = 'resolved' THEN ?
                ELSE NULL
              END,
              resolved_at = CASE
                WHEN status = ? THEN resolved_at
                WHEN ? = 'resolved' THEN ?
                ELSE NULL
              END,
              revision = revision + 1,
              updated_at = ?
              ${metadataAssignment}
        WHERE thread_id = ? AND deleted_at IS NULL
          AND (status <> ?${noteChanges ? " OR parent_comment_id IS NULL" : ""})
          ${resourceClause}`,
      args: [
        status,
        status,
        status,
        resolvedBy ?? null,
        status,
        status,
        status === "resolved" ? now : null,
        now,
        ...(noteChanges ? [stringifyOptionalJson(nextRootMetadata)] : []),
        threadId,
        status,
        ...(resource ? [resource.resourceType, resource.resourceId] : []),
      ],
    });
  }
  for (const changed of perResource) {
    if (changed.changing < 1) continue;
    await runReviewCommentWriteHook(
      changed.resourceType,
      {
        type: status === "resolved" ? "resolved" : "reopened",
        resourceType: changed.resourceType,
        resourceId: changed.resourceId,
        threadId,
        actorEmail: resolvedBy ?? null,
      },
      client,
    );
  }
  return live;
}

function withoutResolutionNote(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null | undefined {
  if (!metadata || !("resolutionNote" in metadata)) {
    return undefined;
  }
  const next = { ...metadata };
  delete next.resolutionNote;
  return Object.keys(next).length > 0 ? next : null;
}

export async function routeReviewThread(
  threadId: string,
  resolutionTarget: ReviewResolutionTarget,
  resource: { resourceType: string; resourceId: string },
): Promise<number> {
  await ensureReviewTables();
  const client = getDbExec();
  // Routing updates every first comment in the thread. It takes them in the
  // order a thread delete and a routed reply do, so none of them holds one
  // while it waits for another that one of the others holds.
  const route = async (tx: DbExec) => {
    await lockReviewThreadRoots(tx, threadId, resource);
    // raw-sql-ok: the helper's statement is constant text; the ids are bound.
    return routeReviewThreadWithClient(
      tx,
      threadId,
      resolutionTarget,
      resource,
    );
  };
  return client.transaction ? client.transaction(route) : route(client);
}

async function routeReviewThreadWithClient(
  client: DbExec,
  threadId: string,
  resolutionTarget: ReviewResolutionTarget,
  resource: { resourceType: string; resourceId: string },
): Promise<number> {
  const now = new Date().toISOString();
  // Every open first comment still counts as routed, but only one whose route
  // changes, or that the agent already took and is sent back to it, moves its
  // revision; a caller's next edit at the revision it read still goes through.
  const result = await client.execute({
    sql: `UPDATE agent_review_comments
        SET resolution_target = ?,
            consumed_at = CASE WHEN ? = 'agent' THEN NULL ELSE consumed_at END,
            revision = CASE
              WHEN resolution_target IS NULL
                OR resolution_target <> ?
                OR (? = 'agent' AND consumed_at IS NOT NULL)
              THEN revision + 1
              ELSE revision
            END,
            updated_at = CASE
              WHEN resolution_target IS NULL
                OR resolution_target <> ?
                OR (? = 'agent' AND consumed_at IS NOT NULL)
              THEN ?
              ELSE updated_at
            END
      WHERE thread_id = ?
        AND resource_type = ?
        AND resource_id = ?
        AND parent_comment_id IS NULL
        AND status = 'open'
        AND deleted_at IS NULL`,
    args: [
      resolutionTarget,
      resolutionTarget,
      resolutionTarget,
      resolutionTarget,
      resolutionTarget,
      resolutionTarget,
      now,
      threadId,
      resource.resourceType,
      resource.resourceId,
    ],
  });
  return result.rowsAffected ?? 0;
}

export async function sendReviewThreadToAgent(
  threadId: string,
  resource: { resourceType: string; resourceId: string },
): Promise<number> {
  return routeReviewThread(threadId, "agent", resource);
}

/**
 * Who wrote each thread's live comments, its first comment included, each
 * author once. Read on its own, so a list cut short by its limit cannot hide
 * one from the answer.
 */
export async function getLiveReviewAuthorsByThread(
  threadIds: ReadonlyArray<string>,
  resource: { resourceType: string; resourceId: string },
): Promise<Map<string, Array<string | null>>> {
  const ids = [...new Set(threadIds)];
  if (!ids.length) return new Map();
  await ensureReviewTables();
  // raw-sql-ok: the interpolation is only `?` placeholders; the ids are bound.
  const { rows } = await getDbExec().execute({
    sql: `SELECT DISTINCT thread_id, author_email FROM agent_review_comments
           WHERE resource_type = ? AND resource_id = ? AND deleted_at IS NULL
             AND thread_id IN (${ids.map(() => "?").join(",")})`,
    args: [resource.resourceType, resource.resourceId, ...ids],
  });
  const authorsByThread = new Map<string, Array<string | null>>();
  for (const row of rows) {
    const { thread_id: threadId, author_email: email } = row as {
      thread_id: unknown;
      author_email?: unknown;
    };
    const authors = authorsByThread.get(String(threadId)) ?? [];
    authors.push(typeof email === "string" ? email : null);
    authorsByThread.set(String(threadId), authors);
  }
  return authorsByThread;
}

export interface DeleteReviewCommentOptions {
  /**
   * Called for a thread's first comment with the author of every other live
   * comment in the thread, which the delete takes along. They're read after the
   * thread is locked, so no reply can land between the check and the delete.
   * Throwing refuses the delete and removes nothing.
   */
  assertThreadDeletable?: (
    replyAuthorEmails: ReadonlyArray<string | null>,
  ) => void;
}

/**
 * Soft-deletes a comment, and with a thread's first comment the rest of the
 * thread too. Each row stays, but what someone wrote or attached is cleared:
 * its text, mentions, anchor, image attachments and any resolution note, as
 * they are in apps that remove the row.
 */
export async function deleteReviewComment(
  id: string,
  deletedBy?: string | null,
  options: DeleteReviewCommentOptions = {},
): Promise<number> {
  await ensureReviewTables();
  const now = new Date().toISOString();
  const actor = deletedBy ?? null;
  const client = getDbExec();
  const deleteIn = async (tx: DbExec) => {
    // raw-sql-ok: the statement is constant text; the id is bound.
    const { rows: targets } = await tx.execute({
      sql: `SELECT thread_id, resource_type, resource_id, parent_comment_id
              FROM agent_review_comments
             WHERE id = ?`,
      args: [id],
    });
    const target = targets[0] as
      | {
          thread_id: unknown;
          resource_type: unknown;
          resource_id: unknown;
          parent_comment_id: unknown;
        }
      | undefined;
    const root = target && target.parent_comment_id == null ? target : null;
    if (root) {
      // A reply still being written holds its root `FOR SHARE`. Taking every
      // first comment in the thread `FOR UPDATE` first waits that out, so
      // everything read or updated below sees the reply and takes it along. A
      // later reply finds its root gone and refuses. They're taken in id
      // order, as another delete or a routed reply in the thread takes them,
      // so neither holds one the other is waiting for.
      await lockReviewThreadRoots(tx, String(root.thread_id), {
        resourceType: String(root.resource_type),
        resourceId: String(root.resource_id),
      });
    }
    // A thread's first comment is the thread. Comments left behind would have
    // no root for any list to hang them on, but would still sit in the table.
    // A thread is everything that shares its id, as listing, resolving and
    // muting take it, so that's what goes, including any other comment with no
    // parent. A root's thread isn't always its own id (a suggestion's
    // correction comment opens one of its own), and a thread given at insert
    // could repeat on another resource, so the rest of the thread is found by
    // the thread and resource stored on the root. The check is shown exactly
    // the comments the delete takes.
    const rest: DeletedCommentRow[] = root
      ? ((
          await tx.execute(sql`SELECT id, parent_comment_id, author_email,
                metadata_json
               FROM agent_review_comments
              WHERE thread_id = ${sql.value(String(root.thread_id))}
                AND resource_type = ${sql.value(String(root.resource_type))}
                AND resource_id = ${sql.value(String(root.resource_id))}
                AND id <> ${sql.value(id)}
                AND deleted_at IS NULL`)
        ).rows as DeletedCommentRow[])
      : [];
    if (root && options.assertThreadDeletable) {
      options.assertThreadDeletable(
        rest.map((comment) =>
          typeof comment.author_email === "string"
            ? comment.author_email
            : null,
        ),
      );
    }
    // The hook hears only of what this delete cleared; a comment deleted on
    // its own meanwhile already told it.
    const deletedIds: string[] = [];
    if ((await clearDeletedReviewComment(tx, id, actor, now)) > 0) {
      deletedIds.push(id);
    }
    // Another comment with no parent can have its metadata changed while this
    // runs, as resolving writes a note to each, so it gets the same rechecked
    // update as the root.
    for (const other of rest.filter((comment) => !comment.parent_comment_id)) {
      const otherId = String(other.id);
      if ((await clearDeletedReviewComment(tx, otherId, actor, now)) > 0) {
        deletedIds.push(otherId);
      }
    }
    deletedIds.push(
      ...(await clearDeletedReviewReplies(
        tx,
        rest.filter((comment) => comment.parent_comment_id),
        actor,
        now,
      )),
    );
    if (target && deletedIds.length > 0) {
      const resourceType = String(target.resource_type);
      await runReviewCommentWriteHook(
        resourceType,
        {
          type: "deleted",
          resourceType,
          resourceId: String(target.resource_id),
          threadId: String(target.thread_id),
          commentIds: deletedIds,
          actorEmail: actor,
        },
        tx,
      );
    }
    return deletedIds.length;
  };
  if (client.transaction) return client.transaction(deleteIn);
  // A comment's resource never changes, so it can be read ahead of the delete.
  const resourceType = await getReviewCommentResourceType(client, id);
  if (resourceType !== null) assertReviewWriteCanRollBack(resourceType);
  return deleteIn(client);
}

async function getReviewCommentResourceType(
  client: DbExec,
  id: string,
): Promise<string | null> {
  const { rows } = await client.execute(
    sql`SELECT resource_type FROM agent_review_comments WHERE id = ${sql.value(id)} LIMIT 1`,
  );
  const row = rows[0] as { resource_type: unknown } | undefined;
  return row ? String(row.resource_type) : null;
}

interface DeletedCommentRow {
  id: unknown;
  parent_comment_id?: unknown;
  author_email?: unknown;
  metadata_json?: unknown;
}

/** A `type` or `kind` that marks a comment's metadata as a resolution note. */
const RESOLUTION_NOTE_MARKERS = new Set([
  "resolution",
  "resolution_note",
  "resolution-note",
]);

/** Takes `key` out of `record`, saying whether it was there. */
function dropKey(record: Record<string, unknown>, key: string): boolean {
  if (!(key in record)) return false;
  delete record[key];
  return true;
}

/**
 * The metadata a deleted comment keeps, or `undefined` when nothing in it
 * needs clearing. What goes is what someone wrote or attached: image
 * attachments, and a resolution note in each shape the kit's comment card
 * reads one from.
 */
function metadataAfterDelete(metadataJson: unknown): string | null | undefined {
  const metadata = parseObject(metadataJson);
  if (!metadata) return undefined;
  let changed = false;
  for (const key of ["attachments", "resolutionNote", "resolvedNote"]) {
    changed = dropKey(metadata, key) || changed;
  }
  // A comment marked as a resolution note keeps its note under `note`.
  const marker = metadata.type ?? metadata.kind;
  if (typeof marker === "string" && RESOLUTION_NOTE_MARKERS.has(marker)) {
    changed = dropKey(metadata, "note") || changed;
  }
  // Metadata is decoded already, and a resolution given as plain text, as any
  // caller may store, has no note to take. The comment card reads one only
  // from an object.
  const resolution = isPlainObject(metadata.resolution)
    ? metadata.resolution
    : null;
  if (resolution && dropKey(resolution, "note")) {
    changed = true;
    if (Object.keys(resolution).length > 0) metadata.resolution = resolution;
    else delete metadata.resolution;
  }
  if (!changed) return undefined;
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

/** How many times a deletion rereads a comment that changed under it. */
const DELETE_COMMENT_ATTEMPTS = 5;

/**
 * Marks one comment deleted and clears what someone wrote or attached in it.
 * Another write, such as a resolution note, can change the metadata between
 * the read and the update. The update only lands on the metadata it read, and
 * reads again when that changed, so the other write isn't lost.
 */
async function clearDeletedReviewComment(
  client: DbExec,
  id: string,
  deletedBy: string | null,
  now: string,
): Promise<number> {
  // Only a live comment is cleared. One already deleted, earlier or on its own
  // while its thread was being deleted, keeps who deleted it and when.
  for (let attempt = 0; attempt < DELETE_COMMENT_ATTEMPTS; attempt += 1) {
    const existing = await client.execute(sql`SELECT metadata_json
         FROM agent_review_comments
        WHERE id = ${sql.value(id)} AND deleted_at IS NULL
        LIMIT 1`);
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    if (!row) return 0;
    const read = typeof row.metadata_json === "string" ? row.metadata_json : "";
    const remainingMetadata = metadataAfterDelete(row.metadata_json);
    const metadata =
      remainingMetadata === undefined
        ? sql`metadata_json`
        : sql`${sql.value(remainingMetadata)}`;
    const result = await client.execute(sql`UPDATE agent_review_comments
          SET status = 'deleted',
              body = '',
              mentions_json = NULL,
              anchor_json = NULL,
              metadata_json = ${metadata},
              deleted_by = ${sql.value(deletedBy)},
              revision = revision + 1,
              deleted_at = ${sql.value(now)},
              updated_at = ${sql.value(now)}
        WHERE id = ${sql.value(id)}
          AND deleted_at IS NULL
          AND COALESCE(metadata_json, '') = ${sql.value(read)}`);
    if (result.rowsAffected > 0) return result.rowsAffected;
  }
  throw new Error(
    `Comment ${id} kept changing while it was being deleted; try again.`,
  );
}

/** Replies cleared per statement, well inside PostgreSQL's 65,535 bound values. */
const DELETED_REPLIES_PER_STATEMENT = 1_000;

/**
 * Clears a deleted thread's replies, a thousand to a statement. Only a comment
 * with no parent has its metadata changed after it's written, so each reply's
 * metadata, read under the thread's lock, is still current here. A reply can
 * still be deleted on its own in between, as that takes no thread lock, so
 * only those still live are cleared, and one deleted meanwhile keeps who
 * deleted it and when. Returns the ids it cleared.
 */
async function clearDeletedReviewReplies(
  client: DbExec,
  replies: readonly DeletedCommentRow[],
  deletedBy: string | null,
  now: string,
): Promise<string[]> {
  const deleted: string[] = [];
  for (
    let start = 0;
    start < replies.length;
    start += DELETED_REPLIES_PER_STATEMENT
  ) {
    const batch = replies.slice(start, start + DELETED_REPLIES_PER_STATEMENT);
    const rewrites = batch.flatMap((reply) => {
      const remainingMetadata = metadataAfterDelete(reply.metadata_json);
      return remainingMetadata === undefined
        ? []
        : [
            sql`WHEN ${sql.value(String(reply.id))} THEN ${sql.value(remainingMetadata)}`,
          ];
    });
    const metadata =
      rewrites.length > 0
        ? sql`CASE id ${sql.join(rewrites, sql` `)} ELSE metadata_json END`
        : sql`metadata_json`;
    const result = await client.execute(sql`UPDATE agent_review_comments
          SET status = 'deleted',
              body = '',
              mentions_json = NULL,
              anchor_json = NULL,
              metadata_json = ${metadata},
              deleted_by = ${sql.value(deletedBy)},
              revision = revision + 1,
              deleted_at = ${sql.value(now)},
              updated_at = ${sql.value(now)}
        WHERE id IN ${sql.in(batch.map((reply) => String(reply.id)))}
          AND deleted_at IS NULL
        RETURNING id`);
    for (const row of result.rows) {
      deleted.push(String((row as { id: unknown }).id));
    }
  }
  return deleted;
}

/** Distinct authors of a thread's live comments, for reply emails. */
export async function listReviewThreadParticipantEmails(input: {
  resourceType: string;
  resourceId: string;
  threadId: string;
}): Promise<string[]> {
  await ensureReviewTables();
  const result = await getDbExec().execute(sql`SELECT DISTINCT author_email
       FROM agent_review_comments
      WHERE resource_type = ${sql.value(input.resourceType)}
        AND resource_id = ${sql.value(input.resourceId)}
        AND thread_id = ${sql.value(input.threadId)}
        AND author_email IS NOT NULL
        AND deleted_at IS NULL
        AND status <> 'deleted'`);
  return result.rows
    .map((row) => nullableString((row as Record<string, unknown>).author_email))
    .filter((email): email is string => Boolean(email));
}

export async function updateReviewComment(
  id: string,
  input: UpdateReviewCommentInput,
  resource?: { resourceType: string; resourceId: string },
  options: ReviewCommentWriteOptions = {},
): Promise<ReviewComment | null> {
  await ensureReviewTables();
  const client = getDbExec();
  const write = (tx: DbExec) =>
    writeReviewCommentChange(tx, id, input, resource, options);
  if (client.transaction) return client.transaction(write);
  // A comment's resource never changes, so it can be read ahead of the edit.
  const resourceType =
    resource?.resourceType ?? (await getReviewCommentResourceType(client, id));
  if (resourceType !== null) assertReviewWriteCanRollBack(resourceType);
  return write(client);
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
  const onResource = resource
    ? sql`AND resource_type = ${sql.value(resource.resourceType)}
        AND resource_id = ${sql.value(resource.resourceId)}`
    : sql``;
  const client = getDbExec();
  const consume = async (tx: DbExec) => {
    // The comments can be in several threads. The first comments of each are
    // taken in one id order, as a thread delete takes its own, so neither
    // holds one while it waits for another the other holds.
    await tx.execute(sql`SELECT id
         FROM agent_review_comments
        WHERE thread_id IN (
                SELECT thread_id
                  FROM agent_review_comments
                 WHERE id IN ${sql.in(ids)}
                   ${onResource})
          ${onResource}
          AND parent_comment_id IS NULL
        ORDER BY id
          FOR UPDATE`);
    const result = await tx.execute(sql`UPDATE agent_review_comments
          SET consumed_at = COALESCE(consumed_at, ${sql.value(consumedAt)}),
              revision = CASE
                WHEN consumed_at IS NULL THEN revision + 1
                ELSE revision
              END,
              updated_at = CASE
                WHEN consumed_at IS NULL THEN ${sql.value(consumedAt)}
                ELSE updated_at
              END
        WHERE id IN ${sql.in(ids)}
          ${onResource}`);
    return result.rowsAffected;
  };
  return client.transaction ? client.transaction(consume) : consume(client);
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

/**
 * Links a comment to the same comment or thread in another system, such as a
 * Notion comment or discussion, so an import can skip what it already copied.
 * Linking the same outside ID to the same comment again changes nothing;
 * linking it to another comment is refused. Links outlive a deleted comment,
 * so a later import doesn't bring it back.
 */
export async function linkReviewComment(
  input: Omit<ReviewCommentLink, "createdAt" | "resourceType" | "resourceId">,
  client?: DbExec,
): Promise<ReviewCommentLink> {
  await ensureReviewTables();
  const db = client ?? getDbExec();
  const comment = await getReviewCommentByIdWithClient(db, input.commentId);
  if (!comment) throw new Error("Review comment not found");
  await db.execute(sql`INSERT INTO agent_review_comment_links
        (provider, external_kind, external_id, comment_id, resource_type,
         resource_id, created_at)
      VALUES (${sql.value(input.provider)}, ${sql.value(input.externalKind)},
        ${sql.value(input.externalId)}, ${sql.value(input.commentId)},
        ${sql.value(comment.resourceType)}, ${sql.value(comment.resourceId)},
        ${sql.value(new Date().toISOString())})
      ON CONFLICT (provider, external_kind, external_id) DO NOTHING`);
  const link = await findReviewCommentLink(input, db);
  if (!link || link.commentId !== input.commentId) {
    throw new ReviewCommentLinkConflictError(
      input.provider,
      input.externalKind,
      input.externalId,
    );
  }
  return link;
}

/** The comment an outside ID is linked to, if any. */
export async function findReviewCommentLink(
  input: Pick<ReviewCommentLink, "provider" | "externalKind" | "externalId">,
  client?: DbExec,
): Promise<ReviewCommentLink | null> {
  await ensureReviewTables();
  const result = await (client ?? getDbExec()).execute(sql`SELECT provider,
        external_kind, external_id, comment_id, resource_type, resource_id,
        created_at
       FROM agent_review_comment_links
      WHERE provider = ${sql.value(input.provider)}
        AND external_kind = ${sql.value(input.externalKind)}
        AND external_id = ${sql.value(input.externalId)}`);
  const row = result.rows[0];
  return row ? mapLinkRow(row as Record<string, unknown>) : null;
}

/** Every outside link on these comments, optionally from one system. */
export async function listReviewCommentLinks(
  commentIds: readonly string[],
  provider?: string,
): Promise<ReviewCommentLink[]> {
  const ids = [...new Set(commentIds)];
  if (!ids.length) return [];
  await ensureReviewTables();
  const fromProvider = provider
    ? sql`AND provider = ${sql.value(provider)}`
    : sql``;
  const result = await getDbExec().execute(sql`SELECT provider, external_kind,
        external_id, comment_id, resource_type, resource_id, created_at
       FROM agent_review_comment_links
      WHERE comment_id IN ${sql.in(ids)}
        ${fromProvider}
      ORDER BY comment_id, provider, external_kind, external_id`);
  return result.rows.map((row) => mapLinkRow(row as Record<string, unknown>));
}

function mapLinkRow(row: Record<string, unknown>): ReviewCommentLink {
  return {
    provider: String(row.provider),
    externalKind: String(row.external_kind),
    externalId: String(row.external_id),
    commentId: String(row.comment_id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    createdAt: String(row.created_at),
  };
}

export function __resetReviewInitForTests(): void {
  reviewStore.reset();
}

function commentColumns(): string {
  // raw-sql-ok: a constant column list.
  return [
    "id",
    "resource_type",
    "resource_id",
    "thread_id",
    "parent_comment_id",
    "target_id",
    "surface_id",
    "kind",
    "status",
    "anchor_json",
    "anchor_kind",
    "anchor_version",
    "revision",
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

function scopedReviewClause(
  scope: ReviewScope,
  alias?: string,
): {
  clause: string;
  params: unknown[];
} {
  const parts: string[] = [];
  const params: unknown[] = [];
  const column = (name: string) => (alias ? `${alias}.${name}` : name);

  if (scope.userEmail) {
    parts.push(`${column("owner_email")} = ?`);
    params.push(scope.userEmail);
  }
  if (scope.orgId) {
    parts.push(`(${column("visibility")} = 'org' AND ${column("org_id")} = ?)`);
    params.push(scope.orgId);
  }
  parts.push(`${column("visibility")} = 'public'`);

  return { clause: `(${parts.join(" OR ")})`, params };
}

function mapCommentRow(row: Record<string, unknown>): ReviewComment {
  const metadata = parseObject(row.metadata_json);
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    threadId: String(row.thread_id),
    parentCommentId: nullableString(row.parent_comment_id),
    targetId: nullableString(row.target_id),
    surfaceId: nullableString(row.surface_id),
    kind: normalizeKind(row.kind),
    status: normalizeCommentStatus(row.status),
    anchor: parseOptionalJson(row.anchor_json),
    anchorKind: nullableString(row.anchor_kind),
    anchorVersion:
      row.anchor_version === null || row.anchor_version === undefined
        ? null
        : Number(row.anchor_version),
    revision: Number(row.revision ?? 1),
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
    metadata,
    resolutionNote:
      typeof metadata?.resolutionNote === "string"
        ? metadata.resolutionNote
        : null,
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

export function reviewCommentIdForClientOperation(
  clientOperationId: string,
): string {
  return `rev_comment_${clientOperationId}`;
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

function parseOptionalJson(value: unknown): unknown {
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
  return isPlainObject(parsed) ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
