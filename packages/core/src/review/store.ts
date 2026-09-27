import { getDbExec, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import type { Visibility } from "../sharing/schema.js";
import type {
  ReviewActorKind,
  ReviewComment,
  ReviewCommentKind,
  ReviewCommentStatus,
  ReviewCommentReaction,
  ReviewThreadPreference,
  ReviewMention,
  ReviewResolutionTarget,
  ReviewScope,
  ReviewStatus,
  ReviewStatusEntry,
} from "./types.js";

let reviewTablesInitPromise: Promise<void> | undefined;

type ReviewThreadStatus = "open" | "resolved";

export interface InsertReviewCommentInput {
  id?: string;
  resourceType: string;
  resourceId: string;
  threadId?: string | null;
  parentCommentId?: string | null;
  targetId?: string | null;
  kind?: ReviewCommentKind;
  anchor?: unknown;
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
  anchor?: unknown;
  mentions?: ReviewMention[];
}

export interface QueryReviewCommentsInput {
  resourceType: string;
  resourceId: string;
  scope: ReviewScope;
  bypassScope?: boolean;
  includeResolved?: boolean;
  includeDeleted?: boolean;
  targetId?: string | null;
  newestFirst?: boolean;
  rootOnly?: boolean;
  resolutionTargets?: readonly (ReviewResolutionTarget | null)[];
  unconsumedOnly?: boolean;
  limit?: number;
}

export interface GetReviewThreadSummaryInput {
  resourceType: string;
  resourceId: string;
  scope: ReviewScope;
  bypassScope?: boolean;
  targetId?: string | null;
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

export async function ensureReviewTables(): Promise<void> {
  if (!reviewTablesInitPromise) {
    reviewTablesInitPromise = (async () => {
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

      {
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
      }
    })();
  }

  await reviewTablesInitPromise;
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

export async function insertReviewComment(
  input: InsertReviewCommentInput,
): Promise<ReviewComment> {
  await ensureReviewTables();
  return insertReviewCommentWithClient(input, getDbExec());
}

export async function insertReviewCommentIdempotently(
  input: InsertReviewCommentInput & { id: string },
): Promise<InsertReviewCommentResult> {
  await ensureReviewTables();
  return insertReviewCommentIdempotentlyWithClient(input, getDbExec());
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
    if (routeTarget) {
      const routedCount = await routeReviewThreadWithClient(
        tx,
        input.threadId,
        routeTarget,
        resource,
      );
      if (routedCount < 1) {
        throw new Error("Open review thread not found");
      }
    }
    return insertReviewCommentWithClient(input, tx);
  };
  if (client.transaction) return client.transaction(insertAndRoute);

  const reply = await insertReviewCommentWithClient(input, client);
  if (!routeTarget) return reply;
  try {
    const routedCount = await routeReviewThreadWithClient(
      client,
      input.threadId,
      routeTarget,
      resource,
    );
    if (routedCount < 1) throw new Error("Open review thread not found");
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
    if (routedCount < 1) throw new Error("Open review thread not found");
    return result;
  };
  if (client.transaction) return client.transaction(insertAndRoute);

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
    if (routedCount < 1) throw new Error("Open review thread not found");
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
  return (await writeReviewCommentWithClient(input, client)).comment;
}

async function writeReviewCommentWithClient(
  input: InsertReviewCommentInput,
  client: DbExec,
  onConflictDoNothing = false,
): Promise<InsertReviewCommentResult> {
  const id = input.id ?? createReviewId("comment");
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
    resolutionNote:
      typeof input.metadata?.resolutionNote === "string"
        ? input.metadata.resolutionNote
        : null,
  };

  const result = await client.execute({
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${onConflictDoNothing ? " ON CONFLICT (id) DO NOTHING" : ""}`,
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

  return { comment, replayed: (result.rowsAffected ?? 1) < 1 };
}

async function insertReviewCommentIdempotentlyWithClient(
  input: InsertReviewCommentInput & { id: string },
  client: DbExec,
): Promise<InsertReviewCommentResult> {
  const submitted = reviewCommentFromInput(input);
  const existing = await getReviewCommentByIdWithClient(client, submitted.id);
  if (existing) {
    assertMatchingReviewCommentReceipt(existing, submitted);
    return { comment: existing, replayed: true };
  }

  const insertion = await writeReviewCommentWithClient(input, client, true);
  if (!insertion.replayed) return insertion;

  const receipt = await getReviewCommentByIdWithClient(client, submitted.id);
  if (!receipt) {
    throw new Error("Review comment submission receipt is unavailable");
  }
  assertMatchingReviewCommentReceipt(receipt, submitted);
  return { comment: receipt, replayed: true };
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
  const immutableFields: (keyof ReviewComment)[] = [
    "id",
    "resourceType",
    "resourceId",
    "threadId",
    "parentCommentId",
    "targetId",
    "kind",
    "anchor",
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

  if (input.newestFirst && !input.rootOnly) {
    const rootFilters = [...filters, "parent_comment_id IS NULL"];
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
        WHERE review_thread_rank = 1`
    : `SELECT ${commentColumns()}
         FROM agent_review_comments AS comment
        WHERE ${filters.join(" AND ")}`;
  const order = input.newestFirst ? "DESC" : "ASC";
  const result = await client.execute({
    sql: `${selectSql}
      ORDER BY created_at ${order}${input.rootOnly ? `, id ${order}` : ""}
      LIMIT ?`,
    args: [...filterParams, clampLimit(input.limit)],
  });
  const rows = result.rows ?? [];
  return (input.newestFirst ? [...rows].reverse() : rows).map(mapCommentRow);
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

export async function updateReviewCommentAnchor(input: {
  commentId: string;
  resourceType: string;
  resourceId: string;
  anchor: unknown;
}): Promise<number> {
  await ensureReviewTables();
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_comments
             SET anchor_json = ?, updated_at = ?
           WHERE id = ?
             AND resource_type = ?
             AND resource_id = ?
             AND deleted_at IS NULL`,
    args: [
      stringifyOptionalJson(input.anchor),
      new Date().toISOString(),
      input.commentId,
      input.resourceType,
      input.resourceId,
    ],
  });
  return result.rowsAffected ?? 0;
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
  return client.transaction ? client.transaction(resolve) : resolve(client);
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
  const now = new Date().toISOString();
  const resourceClause = resource
    ? "AND resource_type = ? AND resource_id = ?"
    : "";
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
  const metadataAssignment =
    nextRootMetadata === undefined
      ? ""
      : ", metadata_json = CASE WHEN parent_comment_id IS NULL THEN ? ELSE metadata_json END";
  const result = await client.execute({
    sql: `UPDATE agent_review_comments
        SET status = ?,
            resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
            resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
            updated_at = ?
            ${metadataAssignment}
      WHERE thread_id = ? AND deleted_at IS NULL ${resourceClause}`,
    args: [
      status,
      status,
      resolvedBy ?? null,
      status,
      status === "resolved" ? now : null,
      now,
      ...(nextRootMetadata === undefined
        ? []
        : [stringifyOptionalJson(nextRootMetadata)]),
      threadId,
      ...(resource ? [resource.resourceType, resource.resourceId] : []),
    ],
  });
  return result.rowsAffected ?? 0;
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
  return routeReviewThreadWithClient(
    getDbExec(),
    threadId,
    resolutionTarget,
    resource,
  );
}

async function routeReviewThreadWithClient(
  client: DbExec,
  threadId: string,
  resolutionTarget: ReviewResolutionTarget,
  resource: { resourceType: string; resourceId: string },
): Promise<number> {
  const now = new Date().toISOString();
  const result = await client.execute({
    sql: `UPDATE agent_review_comments
        SET resolution_target = ?,
            consumed_at = CASE WHEN ? = 'agent' THEN NULL ELSE consumed_at END,
            updated_at = ?
      WHERE thread_id = ?
        AND resource_type = ?
        AND resource_id = ?
        AND parent_comment_id IS NULL
        AND status = 'open'
        AND deleted_at IS NULL`,
    args: [
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

export async function updateReviewComment(
  id: string,
  input: UpdateReviewCommentInput,
  resource?: { resourceType: string; resourceId: string },
): Promise<ReviewComment | null> {
  await ensureReviewTables();
  const assignments: string[] = [];
  const args: unknown[] = [];
  if (input.body !== undefined) {
    assignments.push("body = ?");
    args.push(input.body);
  }
  if (input.anchor !== undefined) {
    assignments.push("anchor_json = ?");
    args.push(stringifyOptionalJson(input.anchor));
  }
  if (input.mentions !== undefined) {
    assignments.push("mentions_json = ?");
    args.push(stringifyOptionalJson(input.mentions));
  }
  if (!assignments.length)
    return getReviewCommentById(id, {}, { bypassScope: true });
  assignments.push("updated_at = ?");
  args.push(new Date().toISOString());
  const resourceClause = resource
    ? " AND resource_type = ? AND resource_id = ?"
    : "";
  args.push(id);
  if (resource) args.push(resource.resourceType, resource.resourceId);
  const result = await getDbExec().execute({
    sql: `UPDATE agent_review_comments
             SET ${assignments.join(", ")}
           WHERE id = ? AND deleted_at IS NULL${resourceClause}`,
    args,
  });
  if ((result.rowsAffected ?? 0) < 1) return null;
  return getReviewCommentById(id, {}, { bypassScope: true });
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
