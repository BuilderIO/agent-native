import { getDbExec, sql } from "@agent-native/core/db";
import {
  deleteMirroredReviewComments,
  ensureReviewTables,
  getReviewCommentById,
  mirrorReviewComments,
  queryReviewComments,
  type ReviewComment,
  type ReviewCommentPosition,
} from "@agent-native/core/review";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  PLAN_COMMENT_KINDS,
  type PlanAuthor,
  type PlanCommentKind,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import {
  PLAN_REVIEW_RESOURCE,
  planCommentCopy,
  planResource,
} from "./plan-comment-mirror.js";

export type PlanCommentRow = typeof schema.planComments.$inferSelect;

export type PlanCommentPatch = Partial<Omit<PlanCommentRow, "planId">> & {
  id: string;
};

type PlanDb = Pick<ReturnType<typeof getDb>, "select" | "update">;

function planKind(kind: string): PlanCommentKind {
  return PLAN_COMMENT_KINDS.find((known) => known === kind) ?? "comment";
}

function planAuthor(createdBy: string): PlanAuthor {
  return createdBy === "agent" || createdBy === "import" ? createdBy : "human";
}

export function planCommentRow(comment: ReviewComment): PlanCommentRow {
  const anchorText = comment.metadata?.anchorText;
  return {
    id: comment.id,
    planId: comment.resourceId,
    parentCommentId: comment.parentCommentId,
    sectionId: comment.surfaceId ?? null,
    kind: planKind(comment.kind),
    status: comment.status === "resolved" ? "resolved" : "open",
    anchor:
      comment.anchor !== null && comment.anchor !== undefined
        ? JSON.stringify(comment.anchor)
        : typeof anchorText === "string"
          ? anchorText
          : null,
    message: comment.body,
    createdBy: planAuthor(comment.createdBy),
    authorEmail: comment.authorEmail,
    authorName: comment.authorName,
    resolutionTarget: comment.resolutionTarget,
    mentionsJson:
      comment.mentions.length > 0 ? JSON.stringify(comment.mentions) : null,
    resolvedBy: comment.resolvedBy,
    resolvedAt: comment.resolvedAt,
    consumedAt: comment.consumedAt,
    deletedAt: comment.deletedAt,
    deletedBy: comment.deletedBy,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export function completePlanCommentRow(
  row: typeof schema.planComments.$inferInsert,
): PlanCommentRow {
  return {
    id: row.id,
    planId: row.planId,
    parentCommentId: row.parentCommentId ?? null,
    sectionId: row.sectionId ?? null,
    kind: row.kind ?? "comment",
    status: row.status ?? "open",
    anchor: row.anchor ?? null,
    message: row.message,
    createdBy: row.createdBy ?? "human",
    authorEmail: row.authorEmail ?? null,
    authorName: row.authorName ?? null,
    resolutionTarget: row.resolutionTarget ?? null,
    mentionsJson: row.mentionsJson ?? null,
    resolvedBy: row.resolvedBy ?? null,
    resolvedAt: row.resolvedAt ?? null,
    consumedAt: row.consumedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    deletedBy: row.deletedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const KIT_PAGE_SIZE = 500;

export async function listPlanCommentRows(
  planId: string,
): Promise<PlanCommentRow[]> {
  const rows: PlanCommentRow[] = [];
  let after: ReviewCommentPosition | undefined;
  for (;;) {
    const page = await queryReviewComments({
      resourceType: PLAN_REVIEW_RESOURCE,
      resourceId: planId,
      scope: {},
      bypassScope: true,
      includeResolved: true,
      after,
      limit: KIT_PAGE_SIZE,
    });
    rows.push(...page.map(planCommentRow));
    const full = page.length === KIT_PAGE_SIZE;
    const last = page.pop();
    if (!full || !last) return rows;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

export async function findPlanCommentRow(
  planId: string,
  id: string,
): Promise<PlanCommentRow | null> {
  const comment = await getReviewCommentById(id, {}, { bypassScope: true });
  return comment &&
    comment.resourceType === PLAN_REVIEW_RESOURCE &&
    comment.resourceId === planId &&
    comment.status !== "deleted" &&
    comment.deletedAt === null
    ? planCommentRow(comment)
    : null;
}

export async function countPlanComments(
  planIds: readonly string[],
): Promise<Map<string, { comments: number; open: number }>> {
  const counts = new Map<string, { comments: number; open: number }>();
  if (planIds.length === 0) return counts;
  await ensureReviewTables();
  for (let start = 0; start < planIds.length; start += KIT_PAGE_SIZE) {
    const { rows } = await getDbExec().execute(
      sql`SELECT resource_id, status, COUNT(*) AS comments
            FROM agent_review_comments
           WHERE resource_type = ${sql.value(PLAN_REVIEW_RESOURCE)}
             AND resource_id IN ${sql.in(planIds.slice(start, start + KIT_PAGE_SIZE))}
             AND deleted_at IS NULL
             AND status <> 'deleted'
           GROUP BY resource_id, status`,
    );
    for (const row of rows) {
      const planId = String(row.resource_id);
      const current = counts.get(planId) ?? { comments: 0, open: 0 };
      current.comments += Number(row.comments);
      if (row.status !== "resolved") current.open += Number(row.comments);
      counts.set(planId, current);
    }
  }
  return counts;
}

async function threadIdsFor(
  planId: string,
  rows: readonly PlanCommentRow[],
): Promise<Map<string, string>> {
  const batch = new Map(rows.map((row) => [row.id, row.parentCommentId]));
  const outside = [
    ...new Set(
      rows.flatMap((row) =>
        row.parentCommentId && !batch.has(row.parentCommentId)
          ? [row.parentCommentId]
          : [],
      ),
    ),
  ];
  const stored = new Map<string, string>();
  if (outside.length > 0) {
    const { rows: found } = await getDbExec().execute(
      sql`SELECT id, thread_id FROM agent_review_comments
           WHERE resource_type = ${sql.value(PLAN_REVIEW_RESOURCE)}
             AND resource_id = ${sql.value(planId)}
             AND id IN ${sql.in(outside)}
             AND deleted_at IS NULL
             AND status <> 'deleted'`,
    );
    for (const row of found) stored.set(String(row.id), String(row.thread_id));
  }
  const threads = new Map<string, string>();
  const threadOf = (id: string, seen: Set<string>): string => {
    const known = threads.get(id) ?? stored.get(id);
    if (known) return known;
    if (seen.has(id)) {
      throw new Error(`Comment ${id} on plan ${planId} is in a reply loop.`);
    }
    seen.add(id);
    if (!batch.has(id)) {
      throw new Error(
        `Plan ${planId} has a reply to comment ${id}, which isn't on it.`,
      );
    }
    const parent = batch.get(id);
    const thread = parent ? threadOf(parent, seen) : id;
    threads.set(id, thread);
    return thread;
  };
  for (const row of rows) threadOf(row.id, new Set());
  return threads;
}

async function lockPlanComments(
  planId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const sorted = [...new Set(ids)].sort();
  for (let start = 0; start < sorted.length; start += KIT_PAGE_SIZE) {
    const { rows } = await getDbExec().execute(
      sql`SELECT id FROM agent_review_comments
           WHERE resource_type = ${sql.value(PLAN_REVIEW_RESOURCE)}
             AND resource_id = ${sql.value(planId)}
             AND id IN ${sql.in(sorted.slice(start, start + KIT_PAGE_SIZE))}
           ORDER BY id
             FOR UPDATE`,
    );
    for (const row of rows) found.add(String(row.id));
  }
  return found;
}

async function sectionIdsOnPlan(
  db: PlanDb,
  planId: string,
  rows: readonly PlanCommentRow[],
): Promise<Set<string>> {
  const named = [
    ...new Set(rows.flatMap((row) => (row.sectionId ? [row.sectionId] : []))),
  ];
  if (named.length === 0) return new Set();
  const found = await db
    .select({ id: schema.planSections.id })
    .from(schema.planSections)
    .where(
      and(
        eq(schema.planSections.planId, planId),
        inArray(schema.planSections.id, named),
      ),
    );
  return new Set(found.map((row) => row.id));
}

export async function writePlanCommentRows(
  db: PlanDb,
  planId: string,
  rows: readonly PlanCommentRow[],
  patches: readonly PlanCommentPatch[] = [],
): Promise<void> {
  if (rows.length === 0 && patches.length === 0) return;
  const resource = await planResource(db, planId);
  const added = [...new Map(rows.map((row) => [row.id, row])).values()];
  const merged = new Map<string, PlanCommentPatch>();
  for (const patch of patches) {
    merged.set(patch.id, { ...merged.get(patch.id), ...patch });
  }
  const found = await lockPlanComments(planId, [
    ...added.map((row) => row.id),
    ...merged.keys(),
  ]);
  const current =
    merged.size > 0
      ? new Map((await listPlanCommentRows(planId)).map((row) => [row.id, row]))
      : new Map<string, PlanCommentRow>();
  const live = [
    ...added.filter((row) => !found.has(row.id)),
    ...[...merged.values()].flatMap((patch) => {
      const row = current.get(patch.id);
      return row ? [{ ...row, ...patch }] : [];
    }),
  ];
  if (live.length === 0) return;
  const sections = await sectionIdsOnPlan(db, planId, live);
  const placed = live.map((row) =>
    row.sectionId && !sections.has(row.sectionId)
      ? { ...row, sectionId: null }
      : row,
  );
  const threads = await threadIdsFor(planId, placed);
  await mirrorReviewComments(
    resource,
    placed.map((row) => planCommentCopy(row, threads.get(row.id) ?? row.id)),
  );
}

export function commentAndDescendantIds(
  comments: ReadonlyArray<Pick<PlanCommentRow, "id" | "parentCommentId">>,
  commentId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const children = childrenByParent.get(comment.parentCommentId) ?? [];
    children.push(comment.id);
    childrenByParent.set(comment.parentCommentId, children);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [commentId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return ids;
}

export async function deletePlanCommentThread(
  db: PlanDb,
  planId: string,
  commentId: string,
  deletedBy: string | null,
  now: string,
): Promise<string[]> {
  const plans = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .for("no key update");
  if (plans.length === 0) throw new Error(`Plan ${planId} not found`);
  const ids = commentAndDescendantIds(
    await listPlanCommentRows(planId),
    commentId,
  );
  await lockPlanComments(planId, ids);
  await deleteMirroredReviewComments(
    { resourceType: PLAN_REVIEW_RESOURCE, resourceId: planId },
    ids,
    deletedBy,
  );
  await db
    .update(schema.planComments)
    .set({ deletedAt: now, deletedBy, updatedAt: now })
    .where(
      and(
        eq(schema.planComments.planId, planId),
        isNull(schema.planComments.deletedAt),
        inArray(schema.planComments.id, ids),
      ),
    );
  return ids;
}
