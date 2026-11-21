import {
  compareMirroredReviewComments,
  deleteMirroredReviewComments,
  ensureReviewTables,
  listMirroredResourceIds,
  mirrorReviewComments,
  type ReviewCommentCopy,
  type ReviewMirrorDifference,
  type ReviewMirrorResource,
} from "@agent-native/core/review";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { planCommentRouting } from "../../shared/comment-context.js";
import { getDb, schema } from "../db/index.js";

export const PLAN_REVIEW_RESOURCE = "plan";
export const PLAN_ANCHOR = "plan-anchor";

export const planCommentAnchorSchema = z.record(z.string(), z.unknown());

type PlanCommentRow = typeof schema.planComments.$inferSelect;
type PlanReader = Pick<ReturnType<typeof getDb>, "select">;

function storedAnchor(text: string | null): {
  anchor: Record<string, unknown> | null;
  unreadable: string | null;
} {
  if (!text) return { anchor: null, unreadable: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { anchor: null, unreadable: text };
  }
  const anchor = planCommentAnchorSchema.safeParse(parsed);
  return anchor.success
    ? { anchor: anchor.data, unreadable: null }
    : { anchor: null, unreadable: text };
}

export function planCommentCopy(
  row: PlanCommentRow,
  threadId: string,
): ReviewCommentCopy {
  const { anchor, unreadable } = storedAnchor(row.anchor);
  const { mentions, resolutionTarget } = planCommentRouting(row);
  const resolved = row.status === "resolved";
  return {
    id: row.id,
    threadId,
    parentCommentId: row.parentCommentId,
    surfaceId: row.sectionId,
    anchor,
    anchorKind: anchor === null ? null : PLAN_ANCHOR,
    anchorVersion: anchor === null ? null : 1,
    body: row.message,
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    createdBy: row.createdBy,
    mentions,
    resolved,
    resolvedBy: resolved ? row.resolvedBy : null,
    resolvedAt: resolved ? row.resolvedAt : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: unreadable === null ? null : { anchorText: unreadable },
    kind: row.kind,
    resolutionTarget,
    consumedAt: row.consumedAt,
  };
}

export function comparePlanComments(
  resource: ReviewMirrorResource,
  copies: readonly ReviewCommentCopy[],
) {
  return compareMirroredReviewComments(
    resource,
    copies.map(({ resolvedBy: _by, resolvedAt: _at, ...copy }) => copy),
  );
}

async function threadRoots(
  db: PlanReader,
  planId: string,
  rows: ReadonlyArray<Pick<PlanCommentRow, "id" | "parentCommentId">>,
): Promise<Map<string, string>> {
  const parents = new Map(rows.map((row) => [row.id, row.parentCommentId]));
  for (;;) {
    const unread = [
      ...new Set(
        [...parents.values()].filter(
          (id): id is string => id !== null && !parents.has(id),
        ),
      ),
    ];
    if (unread.length === 0) break;
    const found = await db
      .select({
        id: schema.planComments.id,
        parentCommentId: schema.planComments.parentCommentId,
      })
      .from(schema.planComments)
      .where(
        and(
          eq(schema.planComments.planId, planId),
          inArray(schema.planComments.id, unread),
        ),
      );
    for (const row of found) parents.set(row.id, row.parentCommentId);
    for (const id of unread) {
      if (!parents.has(id)) {
        throw new Error(
          `Plan ${planId} has a reply to comment ${id}, which isn't on it.`,
        );
      }
    }
  }
  const roots = new Map<string, string>();
  for (const row of rows) {
    const seen = new Set<string>();
    let id = row.id;
    for (;;) {
      if (seen.has(id)) {
        throw new Error(
          `Comment ${row.id} on plan ${planId} is in a reply loop.`,
        );
      }
      seen.add(id);
      const parent = parents.get(id);
      if (!parent) break;
      id = parent;
    }
    roots.set(row.id, id);
  }
  return roots;
}

async function planCopies(
  db: PlanReader,
  planId: string,
  rows: readonly PlanCommentRow[],
): Promise<ReviewCommentCopy[]> {
  const roots = await threadRoots(db, planId, rows);
  return rows.map((row) => planCommentCopy(row, roots.get(row.id) ?? row.id));
}

function planSharing() {
  return {
    ownerEmail: schema.plans.ownerEmail,
    orgId: schema.plans.orgId,
    visibility: schema.plans.visibility,
  };
}

async function planResource(
  db: PlanReader,
  planId: string,
): Promise<ReviewMirrorResource> {
  const plans = await db
    .select(planSharing())
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (plans.length === 0) throw new Error(`Plan ${planId} not found`);
  const [plan] = plans;
  return { resourceType: PLAN_REVIEW_RESOURCE, resourceId: planId, ...plan };
}

export async function mirrorPlanComments(
  db: PlanReader,
  planId: string,
  ids: readonly string[] | "all",
): Promise<void> {
  if (ids !== "all" && ids.length === 0) return;
  const resource = await planResource(db, planId);
  const rows = await db
    .select()
    .from(schema.planComments)
    .where(
      and(
        eq(schema.planComments.planId, planId),
        isNull(schema.planComments.deletedAt),
        ids === "all" ? undefined : inArray(schema.planComments.id, [...ids]),
      ),
    );
  await mirrorReviewComments(resource, await planCopies(db, planId, rows));
}

export async function deleteMirroredPlanComments(
  planId: string,
  ids: readonly string[] | "all",
  deletedBy?: string | null,
): Promise<void> {
  await deleteMirroredReviewComments(
    { resourceType: PLAN_REVIEW_RESOURCE, resourceId: planId },
    ids,
    deletedBy,
  );
}

export interface PlanCommentCopyReport {
  plans: number;
  comments: number;
  failedPlans: string[];
  differences: Array<{ planId: string } & ReviewMirrorDifference>;
}

const PLAN_PAGE_SIZE = 200;

export async function copyPlanCommentsToReviewKit(): Promise<PlanCommentCopyReport> {
  await ensureReviewTables();
  const db = getDb();
  const report: PlanCommentCopyReport = {
    plans: 0,
    comments: 0,
    failedPlans: [],
    differences: [],
  };
  let after = "";
  for (;;) {
    // guard:allow-unscoped — the startup copy covers every plan with comments.
    const page = await db
      .selectDistinct({ planId: schema.planComments.planId })
      .from(schema.planComments)
      .where(gt(schema.planComments.planId, after))
      .orderBy(asc(schema.planComments.planId))
      .limit(PLAN_PAGE_SIZE);
    for (const { planId } of page) {
      await copyPlan(planId, report);
      after = planId;
    }
    if (page.length < PLAN_PAGE_SIZE) break;
  }
  after = "";
  for (;;) {
    const page = await listMirroredResourceIds(PLAN_REVIEW_RESOURCE, {
      after,
      limit: PLAN_PAGE_SIZE,
    });
    if (page.length === 0) break;
    const copied = await db
      .selectDistinct({ planId: schema.planComments.planId })
      .from(schema.planComments)
      .where(inArray(schema.planComments.planId, page));
    const seen = new Set(copied.map((row) => row.planId));
    for (const planId of page) {
      if (!seen.has(planId)) await copyPlan(planId, report);
      after = planId;
    }
    if (page.length < PLAN_PAGE_SIZE) break;
  }
  return report;
}

async function copyPlan(
  planId: string,
  report: PlanCommentCopyReport,
): Promise<void> {
  try {
    const copied = await getDb().transaction(async (tx) => {
      const plans = await tx
        .select(planSharing())
        .from(schema.plans)
        .where(eq(schema.plans.id, planId))
        .for("update");
      const [plan] = plans;
      const resource: ReviewMirrorResource = {
        resourceType: PLAN_REVIEW_RESOURCE,
        resourceId: planId,
        ...plan,
      };
      if (plans.length === 0) {
        await deleteMirroredPlanComments(planId, "all");
        const { differences } = await comparePlanComments(resource, []);
        return { comments: 0, differences };
      }
      const rows = await tx
        .select()
        .from(schema.planComments)
        .where(eq(schema.planComments.planId, planId))
        .orderBy(
          asc(schema.planComments.createdAt),
          asc(schema.planComments.id),
        )
        .for("update");
      const live = rows.filter((row) => row.deletedAt === null);
      const copies = await planCopies(tx, planId, live);
      await mirrorReviewComments(resource, copies);
      const deletedBy = new Map<string | null, string[]>();
      for (const row of rows) {
        if (row.deletedAt === null) continue;
        const ids = deletedBy.get(row.deletedBy);
        if (ids) ids.push(row.id);
        else deletedBy.set(row.deletedBy, [row.id]);
      }
      for (const [by, ids] of deletedBy) {
        await deleteMirroredPlanComments(planId, ids, by);
      }
      const { differences } = await comparePlanComments(resource, copies);
      const extra = differences
        .filter((difference) => difference.problem === "extra")
        .map((difference) => difference.id);
      if (extra.length === 0) return { comments: copies.length, differences };
      await deleteMirroredPlanComments(planId, extra);
      const recheck = await comparePlanComments(resource, copies);
      return { comments: copies.length, differences: recheck.differences };
    });
    report.plans += 1;
    report.comments += copied.comments;
    for (const difference of copied.differences) {
      report.differences.push({ planId, ...difference });
    }
  } catch (error) {
    report.failedPlans.push(planId);
    console.error(
      `[plan] Couldn't copy plan ${planId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
