import {
  getDbExec,
  getEnclosingTransactionDbExec,
  type DbExec,
} from "../db/client.js";
import { sql, type SqlFragment } from "../db/sql.js";
import type { Visibility } from "../sharing/schema.js";
import { ReviewCommentResourceConflictError } from "./errors.js";
import { ensureReviewTables } from "./store.js";
import type {
  ReviewActorKind,
  ReviewCommentKind,
  ReviewMention,
  ReviewResolutionTarget,
} from "./types.js";

/**
 * One comment as an app's own comment table holds it, in the kit's terms.
 *
 * An app moving its comments onto the kit writes them both ways for a
 * release: to its own table, which it still reads, and through
 * `mirrorReviewComments` to the kit's, in the same transaction. A startup
 * copy brings over what it wrote before, and `compareMirroredReviewComments`
 * checks the two stores agree before the app reads from the kit.
 */
export interface ReviewCommentCopy {
  id: string;
  threadId: string;
  parentCommentId: string | null;
  targetId?: string | null;
  surfaceId?: string | null;
  anchor?: unknown;
  anchorKind?: string | null;
  anchorVersion?: number | null;
  body: string;
  authorEmail: string | null;
  authorName: string | null;
  createdBy: ReviewActorKind;
  mentions?: ReviewMention[];
  resolved: boolean;
  /**
   * Who resolved it and when. The kit keeps the first copy's values while the
   * comment stays resolved, so a later edit doesn't move them. Left out, a
   * newly resolved comment counts as resolved at `updatedAt`.
   */
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
  /** Who reacted with what. Left out, the comment has no reactions. */
  reactions?: ReadonlyArray<{ actorEmail: string; reaction: string }>;
  /**
   * The comment's kind, who should act on it, and when the agent took it up,
   * for an app that keeps them. Left out, a new copy is a plain `comment`
   * routed to no one and not taken up, and a later copy leaves the kit's
   * value as it is.
   */
  kind?: ReviewCommentKind;
  resolutionTarget?: ReviewResolutionTarget | null;
  consumedAt?: string | null;
}

/** The resource mirrored comments sit on, with its sharing at the time. */
export interface ReviewMirrorResource {
  resourceType: string;
  resourceId: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  visibility?: Visibility | null;
}

export interface ReviewMirrorDifference {
  id: string;
  /**
   * `missing`: the app has it and the kit doesn't, or has it deleted.
   * `extra`: the kit has it live and the app doesn't.
   * `different`: both have it; `fields` names what differs.
   */
  problem: "missing" | "extra" | "different";
  fields?: string[];
}

export interface ReviewMirrorComparison {
  /** How many of the app's comments were checked. */
  checked: number;
  differences: ReviewMirrorDifference[];
}

const BATCH_SIZE = 100;

// In the order `copyValues` binds them.
const COPY_COLUMNS = [
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
  "reply_route_target",
  "notification_completed_at",
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
] as const;

// What a later copy of the same comment may change. Identity, the resource,
// and the kit's own bookkeeping (revision, routing, the agent queue and
// email) stay as the kit has them, and so do who resolved it and when while
// it stays resolved (`RESOLUTION_UPDATES`).
const UPDATED_COLUMNS = [
  "thread_id",
  "parent_comment_id",
  "target_id",
  "surface_id",
  "status",
  "anchor_json",
  "anchor_kind",
  "anchor_version",
  "body",
  "author_email",
  "author_name",
  "created_by",
  "mentions_json",
  "owner_email",
  "org_id",
  "visibility",
  "deleted_by",
  "deleted_at",
  "created_at",
  "updated_at",
  "metadata_json",
] as const;

const APP_KEPT_COLUMNS = [
  ["kind", "kind"],
  ["resolution_target", "resolutionTarget"],
  ["consumed_at", "consumedAt"],
] as const;

function appKeptColumns(copy: ReviewCommentCopy): string[] {
  return APP_KEPT_COLUMNS.filter(([, field]) => copy[field] !== undefined).map(
    ([column]) => column,
  );
}

const RESOLUTION_UPDATES = ["resolved_by", "resolved_at"]
  .map(
    (column) => `${column} = CASE
      WHEN agent_review_comments.status = 'resolved' AND EXCLUDED.status = 'resolved'
        THEN agent_review_comments.${column}
      ELSE EXCLUDED.${column} END`,
  )
  .join(", ");

function chunks<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// Who can see the kit's copy of a comment: the resource's sharing as the app
// passed it.
function copySharing(resource: ReviewMirrorResource, copy: ReviewCommentCopy) {
  return {
    ownerEmail: resource.ownerEmail ?? copy.authorEmail,
    orgId: resource.orgId ?? null,
    visibility:
      resource.visibility === "org" || resource.visibility === "public"
        ? resource.visibility
        : "private",
  };
}

function copyValues(
  resource: ReviewMirrorResource,
  copy: ReviewCommentCopy,
): unknown[] {
  const sharing = copySharing(resource, copy);
  return [
    copy.id,
    resource.resourceType,
    resource.resourceId,
    copy.threadId,
    copy.parentCommentId,
    copy.targetId ?? null,
    copy.surfaceId ?? null,
    copy.kind ?? "comment",
    copy.resolved ? "resolved" : "open",
    jsonOrNull(copy.anchor),
    copy.anchorKind ?? null,
    copy.anchorVersion ?? null,
    1,
    copy.body,
    copy.authorEmail,
    copy.authorName,
    copy.createdBy,
    copy.resolutionTarget ?? null,
    null,
    // The app sent this comment's email when it was written, so the kit
    // never sends it again.
    copy.createdAt,
    jsonOrNull(copy.mentions?.length ? copy.mentions : null),
    sharing.ownerEmail,
    sharing.orgId,
    sharing.visibility,
    copy.resolved ? (copy.resolvedBy ?? null) : null,
    copy.resolved ? (copy.resolvedAt ?? copy.updatedAt) : null,
    copy.consumedAt ?? null,
    null,
    null,
    copy.createdAt,
    copy.updatedAt,
    jsonOrNull(
      copy.metadata && Object.keys(copy.metadata).length > 0
        ? copy.metadata
        : null,
    ),
  ];
}

// Preparing the kit's tables can change the schema, which mustn't happen in
// the middle of the app's write, so a caller inside a transaction prepares
// them before opening it.
async function prepareTables(): Promise<void> {
  if (!getEnclosingTransactionDbExec()) await ensureReviewTables();
}

function inWrite<T>(run: (client: DbExec) => Promise<T>): Promise<T> {
  // Inside the app's transaction the kit's rows join it, so they commit or
  // roll back with the app's own.
  const enclosing = getEnclosingTransactionDbExec();
  if (enclosing) return run(enclosing);
  const client = getDbExec();
  return client.transaction ? client.transaction(run) : run(client);
}

// Run after the upsert, which locks every row it touched, so another write
// can't claim one of these IDs for another resource after the check.
async function assertSameResource(
  client: DbExec,
  resource: ReviewMirrorResource,
  ids: readonly string[],
): Promise<void> {
  const { rows } =
    await client.execute(sql`SELECT id, resource_type, resource_id
      FROM agent_review_comments
     WHERE id IN ${sql.in(ids)}`);
  for (const row of rows) {
    if (
      row.resource_type !== resource.resourceType ||
      row.resource_id !== resource.resourceId
    ) {
      throw new ReviewCommentResourceConflictError(String(row.id));
    }
  }
}

function reactionKey(reaction: { actorEmail: string; reaction: string }) {
  return JSON.stringify([reaction.actorEmail, reaction.reaction]);
}

async function mirrorReactions(
  client: DbExec,
  copies: readonly ReviewCommentCopy[],
): Promise<void> {
  if (copies.length === 0) return;
  const ids = copies.map((copy) => copy.id);
  const { rows } =
    await client.execute(sql`SELECT comment_id, actor_email, reaction
      FROM agent_review_comment_reactions
     WHERE comment_id IN ${sql.in(ids)}`);
  const current = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = String(row.comment_id);
    let keys = current.get(id);
    if (!keys) current.set(id, (keys = new Set()));
    keys.add(
      reactionKey({
        actorEmail: String(row.actor_email),
        reaction: String(row.reaction),
      }),
    );
  }
  const removed: SqlFragment[] = [];
  const added: SqlFragment[] = [];
  const now = new Date().toISOString();
  for (const copy of copies) {
    const have = current.get(copy.id) ?? new Set<string>();
    const want = new Set((copy.reactions ?? []).map(reactionKey));
    for (const key of have) {
      if (want.has(key)) continue;
      const [actorEmail, reaction] = JSON.parse(key) as [string, string];
      removed.push(
        sql`(comment_id = ${sql.value(copy.id)} AND actor_email = ${sql.value(actorEmail)} AND reaction = ${sql.value(reaction)})`,
      );
    }
    for (const key of want) {
      if (have.has(key)) continue;
      const [actorEmail, reaction] = JSON.parse(key) as [string, string];
      added.push(
        sql`(${sql.value(copy.id)}, ${sql.value(actorEmail)}, ${sql.value(reaction)}, ${sql.value(now)})`,
      );
    }
  }
  for (const batch of chunks(removed)) {
    await client.execute(sql`DELETE FROM agent_review_comment_reactions
       WHERE ${sql.join(batch, sql` OR `)}`);
  }
  for (const batch of chunks(added)) {
    await client.execute(sql`INSERT INTO agent_review_comment_reactions
        (comment_id, actor_email, reaction, created_at)
      VALUES ${sql.join(batch, sql`, `)}
      ON CONFLICT (comment_id, actor_email, reaction) DO NOTHING`);
  }
}

/**
 * Makes the kit's rows for these comments match the app's: adds the ones it
 * lacks, rewrites the ones that changed (a changed row's revision goes up),
 * and sets their reactions. A comment the kit has deleted comes back if the
 * app still has it. Comments not passed are left alone; delete them with
 * `deleteMirroredReviewComments`.
 *
 * Writes straight to the kit's tables, without its write hook or email, since
 * the app's own action did both. Run inside the app's transaction, it joins
 * it; call `ensureReviewTables()` before opening that transaction. A comment
 * ID the kit holds on another resource is refused with a
 * `ReviewCommentResourceConflictError`, which rolls the write back.
 *
 * With `onlyMissing`, it only adds the comments the kit lacks, with their
 * reactions, and leaves every comment it has as it is, deleted ones too. An
 * app that has switched to the kit copies with it, so a comment changed
 * through the kit since is never put back as the app's table had it.
 */
export async function mirrorReviewComments(
  resource: ReviewMirrorResource,
  copies: readonly ReviewCommentCopy[],
  options: { onlyMissing?: boolean } = {},
): Promise<{ written: number }> {
  if (copies.length === 0) return { written: 0 };
  await prepareTables();
  if (options.onlyMissing) return addMissingComments(resource, copies);
  const groups = new Map<string, ReviewCommentCopy[]>();
  for (const copy of copies) {
    const key = appKeptColumns(copy).join(",");
    const group = groups.get(key);
    if (group) group.push(copy);
    else groups.set(key, [copy]);
  }
  return inWrite(async (client) => {
    let written = 0;
    for (const [key, group] of groups) {
      written += await upsertCopies(
        client,
        resource,
        group,
        key ? [...UPDATED_COLUMNS, ...key.split(",")] : UPDATED_COLUMNS,
      );
    }
    return { written };
  });
}

async function upsertCopies(
  client: DbExec,
  resource: ReviewMirrorResource,
  copies: readonly ReviewCommentCopy[],
  columns: readonly string[],
): Promise<number> {
  const row = `(${COPY_COLUMNS.map(() => "?").join(", ")})`;
  const updates = columns
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");
  const current = columns
    .map((column) => `agent_review_comments.${column}`)
    .join(", ");
  const incoming = columns.map((column) => `EXCLUDED.${column}`).join(", ");
  let written = 0;
  for (const batch of chunks(copies)) {
    // raw-sql-ok: the column lists and placeholders are constant text; every value is bound.
    const { rows } = await client.execute({
      sql: `INSERT INTO agent_review_comments (${COPY_COLUMNS.join(", ")})
          VALUES ${batch.map(() => row).join(", ")}
          ON CONFLICT (id) DO UPDATE SET ${updates}, ${RESOLUTION_UPDATES},
            revision = agent_review_comments.revision + 1
          WHERE agent_review_comments.resource_type = EXCLUDED.resource_type
            AND agent_review_comments.resource_id = EXCLUDED.resource_id
            AND (${current}) IS DISTINCT FROM (${incoming})
          RETURNING id`,
      args: batch.flatMap((copy) => copyValues(resource, copy)),
    });
    written += rows.length;
    await assertSameResource(
      client,
      resource,
      batch.map((copy) => copy.id),
    );
    await mirrorReactions(client, batch);
  }
  return written;
}

async function addMissingComments(
  resource: ReviewMirrorResource,
  copies: readonly ReviewCommentCopy[],
): Promise<{ written: number }> {
  return inWrite(async (client) => {
    const row = `(${COPY_COLUMNS.map(() => "?").join(", ")})`;
    let written = 0;
    for (const batch of chunks(copies)) {
      // raw-sql-ok: the column list and placeholders are constant text; every value is bound.
      const { rows } = await client.execute({
        sql: `INSERT INTO agent_review_comments (${COPY_COLUMNS.join(", ")})
          VALUES ${batch.map(() => row).join(", ")}
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
        args: batch.flatMap((copy) => copyValues(resource, copy)),
      });
      written += rows.length;
      await assertSameResource(
        client,
        resource,
        batch.map((copy) => copy.id),
      );
      const added = new Set(rows.map((inserted) => String(inserted.id)));
      await mirrorReactions(
        client,
        batch.filter((copy) => added.has(copy.id)),
      );
    }
    return { written };
  });
}

/**
 * Marks the app's deleted comments deleted in the kit and clears what someone
 * wrote in them, as the kit's own delete does. Pass `"all"` when the whole
 * resource went. Comments the kit lacks or has deleted already are skipped.
 */
export async function deleteMirroredReviewComments(
  resource: ReviewMirrorResource,
  ids: readonly string[] | "all",
  deletedBy?: string | null,
): Promise<{ deleted: number }> {
  if (ids !== "all" && ids.length === 0) return { deleted: 0 };
  await prepareTables();
  const now = new Date().toISOString();
  const clear = (match: SqlFragment) =>
    sql`UPDATE agent_review_comments
          SET status = 'deleted',
              body = '',
              mentions_json = NULL,
              anchor_json = NULL,
              metadata_json = NULL,
              deleted_by = ${sql.value(deletedBy ?? null)},
              deleted_at = ${sql.value(now)},
              updated_at = ${sql.value(now)},
              revision = revision + 1
        WHERE resource_type = ${sql.value(resource.resourceType)}
          AND resource_id = ${sql.value(resource.resourceId)}
          AND deleted_at IS NULL
          ${match}`;
  return inWrite(async (client) => {
    if (ids === "all") {
      const result = await client.execute(clear(sql``));
      return { deleted: result.rowsAffected };
    }
    let deleted = 0;
    for (const batch of chunks(ids)) {
      const result = await client.execute(
        clear(sql`AND id IN ${sql.in(batch)}`),
      );
      deleted += result.rowsAffected;
    }
    return { deleted };
  });
}

/**
 * Deletes the comments among `ids` whose thread's first comment the kit has
 * deleted or never held, at any depth in the thread. A startup copy passes the
 * comments only the kit holds: a reply written through the kit's own actions
 * in a thread the app deleted only in its own table, which the kit would have
 * deleted with its thread had the delete gone through the kit. Like the kit's
 * own delete, a deleted reply takes no other reply with it.
 */
export async function deleteOrphanedMirroredReplies(
  resource: ReviewMirrorResource,
  ids: readonly string[],
): Promise<{ deleted: string[] }> {
  if (ids.length === 0) return { deleted: [] };
  await prepareTables();
  const orphaned = await inWrite(async (client) => {
    const found: string[] = [];
    for (const batch of chunks(ids)) {
      const { rows } = await client.execute(sql`SELECT c.id
            FROM agent_review_comments c
           WHERE c.resource_type = ${sql.value(resource.resourceType)}
             AND c.resource_id = ${sql.value(resource.resourceId)}
             AND c.deleted_at IS NULL
             AND c.id IN ${sql.in(batch)}
             AND c.thread_id <> c.id
             AND NOT EXISTS (SELECT 1 FROM agent_review_comments root
                              WHERE root.id = c.thread_id
                                AND root.resource_type = c.resource_type
                                AND root.resource_id = c.resource_id
                                AND root.deleted_at IS NULL)`);
      for (const row of rows) found.push(String(row.id));
    }
    return found;
  });
  await deleteMirroredReviewComments(resource, orphaned);
  return { deleted: orphaned };
}

/**
 * Locks a resource's live thread roots `FOR UPDATE`, in ID order, the order
 * the kit's own writes take them. A comment write holds its thread before the
 * app's write hook reads the resource's row, so an app deleting a resource
 * calls this inside its transaction before it locks that row, and neither
 * waits on a row the other holds.
 */
export async function lockMirroredReviewThreads(
  resource: ReviewMirrorResource,
): Promise<void> {
  await prepareTables();
  await inWrite((client) =>
    client.execute(sql`SELECT id FROM agent_review_comments
        WHERE resource_type = ${sql.value(resource.resourceType)}
          AND resource_id = ${sql.value(resource.resourceId)}
          AND parent_comment_id IS NULL
          AND deleted_at IS NULL
        ORDER BY id
          FOR UPDATE`),
  );
}

/**
 * Gives replies the kit holds with no parent the parent the app names. An app
 * that once saved some replies without a parent, telling them apart from the
 * thread's first comment some other way, links them before it reads from the
 * kit, which takes every comment with no parent for a thread's first and
 * deletes the whole thread with it. A reply is linked only to a comment in
 * its own thread, and one that has a parent already is left alone.
 */
export async function linkMirroredReviewReplies(
  resource: ReviewMirrorResource,
  links: ReadonlyArray<{ id: string; parentCommentId: string }>,
): Promise<{ linked: number }> {
  if (links.length === 0) return { linked: 0 };
  await prepareTables();
  return inWrite(async (client) => {
    let linked = 0;
    for (const link of links) {
      const result = await client.execute(sql`UPDATE agent_review_comments
            SET parent_comment_id = ${sql.value(link.parentCommentId)},
                revision = revision + 1
          WHERE id = ${sql.value(link.id)}
            AND id <> ${sql.value(link.parentCommentId)}
            AND resource_type = ${sql.value(resource.resourceType)}
            AND resource_id = ${sql.value(resource.resourceId)}
            AND parent_comment_id IS NULL
            AND EXISTS (SELECT 1 FROM agent_review_comments parent
                         WHERE parent.id = ${sql.value(link.parentCommentId)}
                           AND parent.resource_type = agent_review_comments.resource_type
                           AND parent.resource_id = agent_review_comments.resource_id
                           AND parent.thread_id = agent_review_comments.thread_id)`);
      linked += result.rowsAffected;
    }
    return { linked };
  });
}

/**
 * Moves comments' anchors when the app changes the resource under them, as
 * footage added at the start of a video moves every comment on it later. The
 * app makes the move, so no write hook runs and the anchor's kind is kept.
 * Each moved comment's revision goes up; deleted comments, and comments on
 * another resource, are left alone.
 */
export async function moveMirroredReviewAnchors(
  resource: ReviewMirrorResource,
  moves: ReadonlyArray<{ id: string; anchor: unknown }>,
): Promise<{ moved: number }> {
  if (moves.length === 0) return { moved: 0 };
  await prepareTables();
  const updatedAt = new Date().toISOString();
  return inWrite(async (client) => {
    let moved = 0;
    for (const batch of chunks(moves)) {
      const anchors = batch.map(
        (move) =>
          sql`WHEN ${sql.value(move.id)} THEN ${sql.value(jsonOrNull(move.anchor))}`,
      );
      const result = await client.execute(sql`UPDATE agent_review_comments
            SET anchor_json = CASE id ${sql.join(anchors, sql` `)} ELSE anchor_json END,
                updated_at = ${sql.value(updatedAt)},
                revision = revision + 1
          WHERE id IN ${sql.in(batch.map((move) => move.id))}
            AND resource_type = ${sql.value(resource.resourceType)}
            AND resource_id = ${sql.value(resource.resourceId)}
            AND deleted_at IS NULL
            AND status <> 'deleted'`);
      moved += result.rowsAffected;
    }
    return { moved };
  });
}

/**
 * The IDs of resources of this type that have comments in the kit it hasn't
 * deleted, a page at a time in ID order, starting after `after`. A startup
 * copy uses it to reach resources whose comments only the kit still has.
 */
export async function listMirroredResourceIds(
  resourceType: string,
  page: { after?: string; limit: number },
): Promise<string[]> {
  await prepareTables();
  const { rows } = await getDbExec().execute(sql`SELECT DISTINCT resource_id
       FROM agent_review_comments
      WHERE resource_type = ${sql.value(resourceType)}
        AND deleted_at IS NULL
        AND resource_id > ${sql.value(page.after ?? "")}
      ORDER BY resource_id
      LIMIT ${sql.value(page.limit)}`);
  return rows.map((row) => String(row.resource_id));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Compares the app's comments on one resource with the kit's: which are
 * missing, which the kit has extra, and for the rest, any difference in
 * thread, parent, surface, anchor, text, author, mentions, resolution,
 * creation time, metadata, reactions or sharing, so a resource whose sharing
 * changed since the copy shows up. Who resolved a comment and when, and its
 * kind, routing and pickup, are compared only where the app passes them.
 * Update times aren't compared.
 */
export async function compareMirroredReviewComments(
  resource: ReviewMirrorResource,
  copies: readonly ReviewCommentCopy[],
): Promise<ReviewMirrorComparison> {
  await prepareTables();
  const client = getDbExec();
  const kitRows = new Map<string, Record<string, unknown>>();
  let after = "";
  for (;;) {
    // Paged by id, so a resource with many comments is read a page at a time.
    const { rows } =
      await client.execute(sql`SELECT id, thread_id, parent_comment_id, target_id,
          surface_id, status, anchor_json, anchor_kind, anchor_version, body,
          author_email, author_name, created_by, mentions_json, resolved_by,
          resolved_at, created_at, metadata_json, owner_email, org_id,
          visibility, kind, resolution_target, consumed_at, deleted_at
       FROM agent_review_comments
      WHERE resource_type = ${sql.value(resource.resourceType)}
        AND resource_id = ${sql.value(resource.resourceId)}
        AND id > ${sql.value(after)}
      ORDER BY id
      LIMIT 500`);
    for (const row of rows) kitRows.set(String(row.id), row);
    const last = rows.at(-1);
    if (rows.length < 500 || !last) break;
    after = String(last.id);
  }

  const kitReactions = new Map<string, string[]>();
  for (const batch of chunks([...kitRows.keys()])) {
    const { rows } =
      await client.execute(sql`SELECT comment_id, actor_email, reaction
        FROM agent_review_comment_reactions
       WHERE comment_id IN ${sql.in(batch)}`);
    for (const row of rows) {
      const id = String(row.comment_id);
      const list = kitReactions.get(id) ?? [];
      list.push(
        reactionKey({
          actorEmail: String(row.actor_email),
          reaction: String(row.reaction),
        }),
      );
      kitReactions.set(id, list);
    }
  }

  const differences: ReviewMirrorDifference[] = [];
  const seen = new Set<string>();
  for (const copy of copies) {
    seen.add(copy.id);
    const row = kitRows.get(copy.id);
    if (!row || row.deleted_at !== null) {
      differences.push({ id: copy.id, problem: "missing" });
      continue;
    }
    const expected: Record<string, unknown> = {
      threadId: copy.threadId,
      parentCommentId: copy.parentCommentId,
      targetId: copy.targetId ?? null,
      surfaceId: copy.surfaceId ?? null,
      anchor: copy.anchor ?? null,
      anchorKind: copy.anchorKind ?? null,
      anchorVersion: copy.anchorVersion ?? null,
      body: copy.body,
      authorEmail: copy.authorEmail,
      authorName: copy.authorName,
      createdBy: copy.createdBy,
      mentions: copy.mentions?.length ? copy.mentions : null,
      status: copy.resolved ? "resolved" : "open",
      createdAt: copy.createdAt,
      metadata:
        copy.metadata && Object.keys(copy.metadata).length > 0
          ? copy.metadata
          : null,
      reactions: (copy.reactions ?? []).map(reactionKey).sort(),
      ...copySharing(resource, copy),
    };
    const actual: Record<string, unknown> = {
      threadId: row.thread_id,
      parentCommentId: row.parent_comment_id ?? null,
      targetId: row.target_id ?? null,
      surfaceId: row.surface_id ?? null,
      anchor: parsedJson(row.anchor_json),
      anchorKind: row.anchor_kind ?? null,
      anchorVersion:
        row.anchor_version === null || row.anchor_version === undefined
          ? null
          : Number(row.anchor_version),
      body: row.body,
      authorEmail: row.author_email ?? null,
      authorName: row.author_name ?? null,
      createdBy: row.created_by,
      mentions: parsedJson(row.mentions_json),
      status: row.status,
      createdAt: row.created_at,
      metadata: parsedJson(row.metadata_json),
      reactions: (kitReactions.get(copy.id) ?? []).sort(),
      ownerEmail: row.owner_email ?? null,
      orgId: row.org_id ?? null,
      visibility: row.visibility,
    };
    if (copy.resolvedBy !== undefined) {
      expected.resolvedBy = copy.resolved ? copy.resolvedBy : null;
      actual.resolvedBy = row.resolved_by ?? null;
    }
    if (copy.resolvedAt != null) {
      expected.resolvedAt = copy.resolved ? copy.resolvedAt : null;
      actual.resolvedAt = row.resolved_at ?? null;
    }
    for (const [column, field] of APP_KEPT_COLUMNS) {
      if (copy[field] === undefined) continue;
      expected[field] = copy[field];
      actual[field] = row[column] ?? null;
    }
    const fields = Object.keys(expected).filter(
      (field) => stableJson(expected[field]) !== stableJson(actual[field]),
    );
    if (fields.length > 0) {
      differences.push({ id: copy.id, problem: "different", fields });
    }
  }
  for (const [id, row] of kitRows) {
    if (!seen.has(id) && row.deleted_at === null) {
      differences.push({ id, problem: "extra" });
    }
  }
  return { checked: copies.length, differences };
}
