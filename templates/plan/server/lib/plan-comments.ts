import { getDbExec, sql } from "@agent-native/core/db";
import {
  deleteMirroredReviewComments,
  ensureReviewTables,
  getReviewCommentById,
  listReviewCommentReactors,
  mirrorReviewComments,
  queryReviewComments,
  reviewReactionActor,
  setReviewCommentReaction,
  type ReviewComment,
  type ReviewCommentCopy,
  type ReviewCommentPosition,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  PLAN_COMMENT_KINDS,
  type PlanAuthor,
  type PlanCommentKind,
  type PlanCommentReaction,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanOwnerEmailForWrite,
} from "./local-identity.js";
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

async function listPlanKitComments(planId: string): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];
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
    comments.push(...page);
    const full = page.length === KIT_PAGE_SIZE;
    const last = page.pop();
    if (!full || !last) return comments;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

export async function listPlanCommentRows(
  planId: string,
): Promise<PlanCommentRow[]> {
  return (await listPlanKitComments(planId)).map(planCommentRow);
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

async function livePlanResource(db: PlanDb, planId: string) {
  const resource = await planResource(db, planId);
  const plans = await db
    .select({ deletedAt: schema.plans.deletedAt })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId));
  if (plans.some((plan) => plan.deletedAt)) {
    throw new Error(`Plan ${planId} not found`);
  }
  return resource;
}

async function sectionIdsOnPlan(
  db: PlanDb,
  planId: string,
  sectionIds: ReadonlyArray<string | null | undefined>,
): Promise<Set<string>> {
  const named = [
    ...new Set(
      sectionIds.flatMap((sectionId) => (sectionId ? [sectionId] : [])),
    ),
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

function withAnchorText(
  metadata: Record<string, unknown> | null,
  anchorText: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const current: Record<string, unknown> = metadata ?? {};
  const { anchorText: _replaced, ...kept } = current;
  const next = { ...kept, ...anchorText };
  return Object.keys(next).length > 0 ? next : null;
}

function patchedCopy(
  comment: ReviewComment,
  patch: PlanCommentPatch,
  reactors: Record<string, string[]> | undefined,
): ReviewCommentCopy {
  const plan = planCommentCopy(
    { ...planCommentRow(comment), ...patch },
    comment.threadId,
  );
  const sets = (...keys: Array<keyof PlanCommentPatch>) =>
    keys.some((key) => patch[key] !== undefined);
  const routed = sets("message", "anchor", "mentionsJson", "resolutionTarget");
  return {
    id: comment.id,
    threadId: comment.threadId,
    parentCommentId: comment.parentCommentId,
    targetId: comment.targetId,
    surfaceId: (sets("sectionId") ? plan.surfaceId : comment.surfaceId) ?? null,
    ...(sets("anchor")
      ? {
          anchor: plan.anchor,
          anchorKind: plan.anchorKind ?? null,
          anchorVersion: plan.anchorVersion ?? null,
          metadata: withAnchorText(comment.metadata, plan.metadata),
        }
      : {
          anchor: comment.anchor,
          anchorKind: comment.anchorKind ?? null,
          anchorVersion: comment.anchorVersion ?? null,
          metadata: comment.metadata,
        }),
    body: sets("message") ? plan.body : comment.body,
    authorEmail: comment.authorEmail,
    authorName: comment.authorName,
    createdBy: comment.createdBy,
    mentions: routed ? (plan.mentions ?? []) : comment.mentions,
    resolutionTarget: routed
      ? (plan.resolutionTarget ?? null)
      : comment.resolutionTarget,
    resolved: sets("status") ? plan.resolved : comment.status === "resolved",
    resolvedBy: sets("status", "resolvedBy")
      ? (plan.resolvedBy ?? null)
      : comment.resolvedBy,
    resolvedAt: sets("status", "resolvedAt")
      ? (plan.resolvedAt ?? null)
      : comment.resolvedAt,
    createdAt: comment.createdAt,
    updatedAt: plan.updatedAt,
    reactions: Object.entries(reactors ?? {}).flatMap(([reaction, actors]) =>
      actors.map((actorEmail) => ({ actorEmail, reaction })),
    ),
    kind: (sets("kind") ? plan.kind : undefined) ?? comment.kind,
    consumedAt: sets("consumedAt")
      ? (plan.consumedAt ?? null)
      : comment.consumedAt,
  };
}

export async function writePlanCommentRows(
  db: PlanDb,
  planId: string,
  rows: readonly PlanCommentRow[],
  patches: readonly PlanCommentPatch[] = [],
): Promise<void> {
  if (rows.length === 0 && patches.length === 0) return;
  const resource = await livePlanResource(db, planId);
  const added = [...new Map(rows.map((row) => [row.id, row])).values()];
  const merged = new Map<string, PlanCommentPatch>();
  for (const patch of patches) {
    merged.set(patch.id, { ...merged.get(patch.id), ...patch });
  }
  const found = await lockPlanComments(planId, [
    ...added.map((row) => row.id),
    ...merged.keys(),
  ]);
  const fresh = added.filter((row) => !found.has(row.id));
  const kit =
    merged.size > 0
      ? new Map(
          (await listPlanKitComments(planId)).map((comment) => [
            comment.id,
            comment,
          ]),
        )
      : new Map<string, ReviewComment>();
  const patched = [...merged.values()].flatMap((patch) => {
    const comment = kit.get(patch.id);
    return comment ? [{ comment, patch }] : [];
  });
  const sections = await sectionIdsOnPlan(db, planId, [
    ...fresh.map((row) => row.sectionId),
    ...patched.map(({ patch }) => patch.sectionId),
  ]);
  const placed = (sectionId: string | null | undefined) =>
    !sectionId || sections.has(sectionId);

  if (fresh.length > 0) {
    const newRows = fresh.map((row) =>
      placed(row.sectionId) ? row : { ...row, sectionId: null },
    );
    const threads = await threadIdsFor(planId, newRows);
    await mirrorReviewComments(
      resource,
      newRows.map((row) => planCommentCopy(row, threads.get(row.id) ?? row.id)),
      { onlyMissing: true },
    );
  }
  if (patched.length > 0) {
    const reactors = await listReviewCommentReactors(
      patched.map(({ comment }) => comment.id),
    );
    await mirrorReviewComments(
      resource,
      patched.map(({ comment, patch }) =>
        patchedCopy(
          comment,
          placed(patch.sectionId) ? patch : { ...patch, sectionId: null },
          reactors[comment.id],
        ),
      ),
    );
  }
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

export function planReactionActor(ctx: unknown): string | null {
  const email = getRequestUserEmail();
  if (isAnonymousPublicViewer(email) || isGuestAuthorIdentity(email)) {
    return null;
  }
  return reviewReactionActor({
    ...(ctx as ReviewResourceContext | undefined),
    userEmail: resolvePlanOwnerEmailForWrite(email) ?? null,
  });
}

export async function planCommentReactions(
  commentIds: readonly string[],
  actor: string | null,
): Promise<Map<string, PlanCommentReaction[]>> {
  const reactors = await listReviewCommentReactors(commentIds);
  return new Map(
    Object.entries(reactors).map(([id, byReaction]) => [
      id,
      Object.entries(byReaction).map(([reaction, actors]) => ({
        reaction,
        count: actors.length,
        reactedByMe:
          actor !== null && actors.some((who) => who.toLowerCase() === actor),
      })),
    ]),
  );
}

export async function reactToPlanComment(
  db: PlanDb,
  planId: string,
  reaction: {
    commentId: string;
    actorEmail: string;
    reaction: string;
    active: boolean;
  },
): Promise<PlanCommentReaction[]> {
  await livePlanResource(db, planId);
  await lockPlanComments(planId, [reaction.commentId]);
  const comment = await getReviewCommentById(
    reaction.commentId,
    {},
    { bypassScope: true },
  );
  if (
    !comment ||
    comment.resourceType !== PLAN_REVIEW_RESOURCE ||
    comment.resourceId !== planId ||
    comment.status === "deleted" ||
    comment.deletedAt !== null
  ) {
    throw new Error(`Comment ${reaction.commentId} isn't on plan ${planId}.`);
  }
  await setReviewCommentReaction(reaction);
  const reactions = await planCommentReactions(
    [reaction.commentId],
    reaction.actorEmail,
  );
  return reactions.get(reaction.commentId) ?? [];
}

export async function deletePlanCommentThread(
  db: PlanDb,
  planId: string,
  commentId: string,
  deletedBy: string | null,
  now: string,
): Promise<string[]> {
  const plans = await db
    .select({ deletedAt: schema.plans.deletedAt })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .for("no key update");
  if (plans.length === 0 || plans.some((plan) => plan.deletedAt)) {
    throw new Error(`Plan ${planId} not found`);
  }
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
