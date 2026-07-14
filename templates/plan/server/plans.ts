import { Buffer } from "node:buffer";

import { emit } from "@agent-native/core/event-bus";
import { buildDeepLink } from "@agent-native/core/server";
import {
  assertAccess,
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  extractCommentMentions,
  normalizeCommentMentions,
  normalizePlanCommentResolutionTarget,
  parsePlanCommentAnchor,
  type PlanCommentMention,
} from "../shared/comment-context.js";
import {
  PLAN_AUTHORS,
  PLAN_COMMENT_KINDS,
  PLAN_COMMENT_RESOLUTION_TARGETS,
  PLAN_COMMENT_STATUSES,
  PLAN_KINDS,
  PLAN_SECTION_TYPES,
  PLAN_SOURCES,
  PLAN_STATUSES,
  type PlanBundle,
  type PlanAuthor,
  type PlanKind,
  type PlanComment,
  type PlanEvent,
  type PlanSection,
  type PlanSummary,
} from "../shared/types.js";
import { getDb, schema } from "./db/index.js";
import { resolvePlanAccessContext } from "./lib/local-identity.js";
import {
  buildPlanContentHtml,
  parsePlanContent,
  sanitizeStoredPlanHtml,
} from "./plan-content.js";

type ImplementationFile = {
  id: string;
  path: string;
  absolutePath?: string;
  line?: number;
  language: string;
  summary: string;
  symbols: string[];
  previewCode?: string;
};

export const planStatusSchema = z.enum(PLAN_STATUSES);
export const planSourceSchema = z.enum(PLAN_SOURCES);
export const planKindSchema = z.enum(PLAN_KINDS);
export const planSectionTypeSchema = z.enum(PLAN_SECTION_TYPES);
export const planCommentKindSchema = z.enum(PLAN_COMMENT_KINDS);
export const planCommentStatusSchema = z.enum(PLAN_COMMENT_STATUSES);
export const planCommentResolutionTargetSchema = z.enum(
  PLAN_COMMENT_RESOLUTION_TARGETS,
);
export const planAuthorSchema = z.enum(PLAN_AUTHORS);

export const sectionInputSchema = z.object({
  id: z.string().optional(),
  type: planSectionTypeSchema.optional().default("custom"),
  title: z.string().min(1),
  body: z.string().optional().default(""),
  html: z.string().optional(),
  order: z.number().int().optional(),
  createdBy: planAuthorSchema.optional().default("agent"),
});

export const commentInputSchema = z.object({
  id: z.string().optional(),
  parentCommentId: z.string().optional(),
  sectionId: z.string().optional(),
  kind: planCommentKindSchema.optional().default("comment"),
  status: planCommentStatusSchema.optional().default("open"),
  anchor: z.string().optional(),
  message: z.string().min(1),
  createdBy: planAuthorSchema.optional().default("human"),
  authorEmail: z.string().trim().optional(),
  authorName: z.string().trim().optional(),
  resolutionTarget: planCommentResolutionTargetSchema.optional(),
  mentions: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase(),
        label: z.string().trim(),
        role: z.string().trim().optional(),
      }),
    )
    .optional(),
  resolvedBy: z.string().trim().optional().nullable(),
  resolvedAt: z.string().trim().optional().nullable(),
});

export type PlanCommentInput = z.infer<typeof commentInputSchema>;

export function newId(prefix: string): string {
  // Plans and recaps both use a `-` separator (plan-…, recap-…) so the id reads
  // cleanly in the URL; other prefixes keep the legacy `_` separator.
  const separator = prefix === "plan" || prefix === "recap" ? "-" : "_";
  return `${prefix}${separator}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseMentionsJson(value: string | null | undefined) {
  if (!value) return [];
  try {
    return normalizeCommentMentions(JSON.parse(value));
  } catch {
    return [];
  }
}

function commentMentionsForInput(
  comment: Pick<PlanCommentInput, "mentions" | "message" | "anchor">,
  anchor = parsePlanCommentAnchor(comment.anchor),
) {
  const mentions = normalizeCommentMentions([
    ...(comment.mentions ?? []),
    ...(anchor?.mentions ?? []),
    ...extractCommentMentions(comment.message),
  ]);
  return mentions;
}

function mentionsJson(mentions: PlanCommentMention[]) {
  return mentions.length > 0 ? JSON.stringify(mentions) : null;
}

export function commentMetadataForInput(comment: PlanCommentInput) {
  const anchor = parsePlanCommentAnchor(comment.anchor);
  const mentions = commentMentionsForInput(comment, anchor);
  const resolutionTarget = normalizePlanCommentResolutionTarget(
    comment.resolutionTarget ??
      anchor?.resolutionTarget ??
      (mentions.length > 0 ? "human" : undefined),
  );
  let anchorString = comment.anchor ?? null;
  if (anchor) {
    anchorString = JSON.stringify({
      ...anchor,
      resolutionTarget,
      mentions,
    });
  }
  return {
    anchor: anchorString,
    resolutionTarget,
    mentions,
    mentionsJson: mentionsJson(mentions),
  };
}

export function commentResolutionFields(input: {
  status: PlanCommentInput["status"];
  createdBy: PlanCommentInput["createdBy"];
  authorEmail?: string | null;
  requestEmail?: string | null;
  now: string;
}) {
  if (input.status !== "resolved") {
    return { resolvedBy: null, resolvedAt: null };
  }
  return {
    resolvedBy:
      nonEmpty(input.requestEmail) ??
      nonEmpty(input.authorEmail) ??
      input.createdBy,
    resolvedAt: input.now,
  };
}

export function resolveCommentAuthor(input: {
  createdBy: PlanAuthor;
  authorEmail?: string | null;
  authorName?: string | null;
  requestEmail?: string | null;
  requestName?: string | null;
}): { authorEmail: string | null; authorName: string | null } {
  const requestEmail = nonEmpty(input.requestEmail);
  const requestName = nonEmpty(input.requestName);
  return {
    authorEmail:
      input.createdBy === "human"
        ? (requestEmail ?? nonEmpty(input.authorEmail))
        : nonEmpty(input.authorEmail),
    authorName:
      input.createdBy === "human"
        ? (requestName ?? nonEmpty(input.authorName))
        : nonEmpty(input.authorName),
  };
}

export function buildInitialPlanCommentRows(input: {
  planId: string;
  comments: PlanCommentInput[];
  requestEmail?: string | null;
  requestName?: string | null;
  now: string;
}): Array<typeof schema.planComments.$inferInsert> {
  type NewCommentRow = typeof schema.planComments.$inferInsert;
  const pendingComments = input.comments.map((comment) => {
    const author = resolveCommentAuthor({
      createdBy: comment.createdBy,
      authorEmail: comment.authorEmail,
      authorName: comment.authorName,
      requestEmail: input.requestEmail,
      requestName: input.requestName,
    });
    const metadata = commentMetadataForInput(comment);
    const resolution = commentResolutionFields({
      status: comment.status,
      createdBy: comment.createdBy,
      authorEmail: author.authorEmail,
      requestEmail: input.requestEmail,
      now: input.now,
    });
    const row: NewCommentRow = {
      ...author,
      id: comment.id ?? newId("cmt"),
      planId: input.planId,
      parentCommentId: null,
      sectionId: comment.sectionId ?? null,
      kind: comment.kind,
      status: comment.status,
      anchor: metadata.anchor,
      message: comment.message,
      createdBy: comment.createdBy,
      resolutionTarget: metadata.resolutionTarget,
      mentionsJson: metadata.mentionsJson,
      resolvedBy: comment.resolvedBy ?? resolution.resolvedBy,
      resolvedAt: comment.resolvedAt ?? resolution.resolvedAt,
      consumedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    return { input: comment, row };
  });

  const commentsById = new Map<string, NewCommentRow>();
  for (const pending of pendingComments) {
    if (commentsById.has(pending.row.id)) {
      throw new Error(`Duplicate comment id ${pending.row.id}.`);
    }
    commentsById.set(pending.row.id, pending.row);
  }

  for (const pending of pendingComments) {
    if (!pending.input.parentCommentId) continue;
    const parent = commentsById.get(pending.input.parentCommentId);
    if (!parent) {
      throw new Error(
        `Parent comment ${pending.input.parentCommentId} was not found in initial comments.`,
      );
    }
    pending.row.parentCommentId = parent.id;
    pending.row.sectionId = pending.input.sectionId ?? parent.sectionId;
    pending.row.kind = parent.kind;
    pending.row.anchor = pending.input.anchor ?? parent.anchor;
    if (
      !pending.input.resolutionTarget &&
      commentMentionsForInput(pending.input).length === 0
    ) {
      pending.row.resolutionTarget =
        parent.resolutionTarget ??
        normalizePlanCommentResolutionTarget(
          parsePlanCommentAnchor(parent.anchor)?.resolutionTarget,
        );
    }
  }

  const rows: NewCommentRow[] = [];
  const insertedCommentIds = new Set<string>();
  const uninserted = new Map(
    pendingComments.map((pending) => [pending.row.id, pending]),
  );
  while (uninserted.size > 0) {
    let insertedThisPass = false;
    for (const [commentId, pending] of Array.from(uninserted.entries())) {
      if (
        pending.row.parentCommentId &&
        !insertedCommentIds.has(pending.row.parentCommentId)
      ) {
        continue;
      }
      rows.push(pending.row);
      insertedCommentIds.add(commentId);
      uninserted.delete(commentId);
      insertedThisPass = true;
    }
    if (!insertedThisPass) {
      throw new Error("Initial comment threads contain a parent cycle.");
    }
  }
  return rows;
}

export function buildUpdatedPlanCommentRows(input: {
  planId: string;
  comments: PlanCommentInput[];
  existingComments: Array<
    Pick<
      PlanComment,
      "id" | "sectionId" | "kind" | "anchor" | "resolutionTarget"
    >
  >;
  requestEmail?: string | null;
  requestName?: string | null;
  now: string;
}): Array<typeof schema.planComments.$inferInsert> {
  type NewCommentRow = typeof schema.planComments.$inferInsert;
  type ParentContext = Pick<
    NewCommentRow,
    "id" | "sectionId" | "kind" | "anchor" | "resolutionTarget"
  >;
  const existingParents = new Map<string, ParentContext>(
    input.existingComments.map((comment) => [comment.id, comment]),
  );
  const pendingComments = input.comments.map((comment) => {
    const author = resolveCommentAuthor({
      createdBy: comment.createdBy,
      authorEmail: comment.authorEmail,
      authorName: comment.authorName,
      requestEmail: input.requestEmail,
      requestName: input.requestName,
    });
    const metadata = commentMetadataForInput(comment);
    const resolution = commentResolutionFields({
      status: comment.status,
      createdBy: comment.createdBy,
      authorEmail: author.authorEmail,
      requestEmail: input.requestEmail,
      now: input.now,
    });
    const row: NewCommentRow = {
      ...author,
      id: comment.id ?? newId("cmt"),
      planId: input.planId,
      parentCommentId: null,
      sectionId: comment.sectionId ?? null,
      kind: comment.kind,
      status: comment.status,
      anchor: metadata.anchor,
      message: comment.message,
      createdBy: comment.createdBy,
      resolutionTarget: metadata.resolutionTarget,
      mentionsJson: metadata.mentionsJson,
      resolvedBy: comment.resolvedBy ?? resolution.resolvedBy,
      resolvedAt: comment.resolvedAt ?? resolution.resolvedAt,
      consumedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    return { input: comment, row };
  });

  const pendingById = new Map<
    string,
    { input: PlanCommentInput; row: NewCommentRow }
  >();
  for (const pending of pendingComments) {
    if (pendingById.has(pending.row.id)) {
      throw new Error(`Duplicate comment id ${pending.row.id}.`);
    }
    pendingById.set(pending.row.id, pending);
  }

  for (const pending of pendingComments) {
    const parentId = pending.input.parentCommentId;
    if (!parentId) continue;
    const parent =
      pendingById.get(parentId)?.row ?? existingParents.get(parentId);
    if (!parent) {
      throw new Error(
        `Parent comment ${parentId} was not found on plan ${input.planId}.`,
      );
    }
    pending.row.parentCommentId = parent.id;
    pending.row.sectionId = pending.input.sectionId ?? parent.sectionId;
    pending.row.kind = parent.kind;
    pending.row.anchor = pending.input.anchor ?? parent.anchor;
    if (
      !pending.input.resolutionTarget &&
      commentMentionsForInput(pending.input).length === 0
    ) {
      pending.row.resolutionTarget =
        parent.resolutionTarget ??
        normalizePlanCommentResolutionTarget(
          parsePlanCommentAnchor(parent.anchor)?.resolutionTarget,
        );
    }
  }

  const rows: NewCommentRow[] = [];
  const availableParentIds = new Set(existingParents.keys());
  const uninserted = new Map(
    pendingComments.map((pending) => [pending.row.id, pending]),
  );
  while (uninserted.size > 0) {
    let insertedThisPass = false;
    for (const [commentId, pending] of Array.from(uninserted.entries())) {
      if (
        pending.row.parentCommentId &&
        pendingById.has(pending.row.parentCommentId) &&
        !availableParentIds.has(pending.row.parentCommentId)
      ) {
        continue;
      }
      rows.push(pending.row);
      availableParentIds.add(commentId);
      uninserted.delete(commentId);
      insertedThisPass = true;
    }
    if (!insertedThisPass) {
      throw new Error("Updated comment threads contain a parent cycle.");
    }
  }
  return rows;
}

// Chunk size for batched comment inserts. Keeps a single INSERT well under
// SQLite's default 999-bound-parameter limit and Postgres' practical
// statement-size limits even for a wide comment row shape.
const PLAN_COMMENT_INSERT_CHUNK_SIZE = 200;

export async function insertInitialPlanComments(input: {
  planId: string;
  comments: PlanCommentInput[];
  requestEmail?: string | null;
  requestName?: string | null;
  now: string;
}) {
  const rows = buildInitialPlanCommentRows(input);
  if (rows.length === 0) return;
  const db = getDb();
  for (let i = 0; i < rows.length; i += PLAN_COMMENT_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + PLAN_COMMENT_INSERT_CHUNK_SIZE);
    await db.insert(schema.planComments).values(chunk);
  }
}

export function planPath(id: string, kind: PlanKind = "plan"): string {
  const base = kind === "recap" ? "recaps" : "plans";
  return `/${base}/${encodeURIComponent(id)}`;
}

export function planDeepLink(id: string, kind: PlanKind = "plan"): string {
  return buildDeepLink({
    app: "plan",
    view: "plan",
    to: planPath(id, kind),
    params: { planId: id },
  });
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function toSection(
  row: typeof schema.planSections.$inferSelect,
): PlanSection {
  return {
    id: row.id,
    planId: row.planId,
    type: row.type,
    title: row.title,
    body: row.body,
    html: row.html,
    order: row.order,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toComment(
  row: typeof schema.planComments.$inferSelect,
): PlanComment {
  const anchor = parsePlanCommentAnchor(row.anchor);
  const mentions = normalizeCommentMentions([
    ...parseMentionsJson(row.mentionsJson),
    ...(anchor?.mentions ?? []),
    ...extractCommentMentions(row.message),
  ]);
  return {
    id: row.id,
    planId: row.planId,
    parentCommentId: row.parentCommentId,
    sectionId: row.sectionId,
    kind: row.kind,
    status: row.status,
    anchor: row.anchor,
    message: row.message,
    createdBy: row.createdBy,
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    resolutionTarget: normalizePlanCommentResolutionTarget(
      row.resolutionTarget ??
        anchor?.resolutionTarget ??
        (mentions.length > 0 ? "human" : undefined),
    ),
    mentions,
    mentionsJson: row.mentionsJson,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    consumedAt: row.consumedAt,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEvent(row: typeof schema.planEvents.$inferSelect): PlanEvent {
  return {
    id: row.id,
    planId: row.planId,
    type: row.type,
    message: row.message,
    payload: parseJsonRecord(row.payload),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function writeEvent(input: {
  planId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
  createdBy?: "agent" | "human" | "import";
}) {
  await getDb()
    .insert(schema.planEvents)
    .values({
      id: newId("evt"),
      planId: input.planId,
      type: input.type,
      message: input.message,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      createdBy: input.createdBy ?? "agent",
      createdAt: nowIso(),
    });
}

// ---------------------------------------------------------------------------
// Event-bus helpers — fire-and-forget; failures must never block callers
// ---------------------------------------------------------------------------

export function emitPlanCreated(input: {
  planId: string;
  title: string;
  kind: PlanKind;
  status: string;
  ownerEmail?: string | null;
}) {
  try {
    emit(
      "plan.created",
      {
        planId: input.planId,
        title: input.title,
        kind: input.kind,
        status: input.status,
        path: planPath(input.planId, input.kind),
        createdBy: "agent",
      },
      { owner: input.ownerEmail ?? undefined },
    );
  } catch {
    // best-effort — never block plan creation
  }
}

export function emitPlanCommented(input: {
  planId: string;
  title: string;
  kind: PlanKind;
  comments: Array<{
    id: string;
    message: string;
    resolutionTarget?: string | null;
    authorEmail?: string | null;
    createdBy?: string;
  }>;
  ownerEmail?: string | null;
}) {
  if (input.comments.length === 0) return;
  try {
    // Derive the dominant resolutionTarget (prefer "agent" if any comment targets agent)
    const resolutionTarget =
      input.comments.find((c) => c.resolutionTarget === "agent")
        ?.resolutionTarget ??
      input.comments[0]?.resolutionTarget ??
      null;
    const firstComment = input.comments[0];
    const excerpt = firstComment ? firstComment.message.slice(0, 200) : "";
    const author =
      input.comments.find((c) => c.authorEmail)?.authorEmail ?? null;
    emit(
      "plan.commented",
      {
        planId: input.planId,
        title: input.title,
        kind: input.kind,
        commentIds: input.comments.map((c) => c.id),
        commentCount: input.comments.length,
        resolutionTarget:
          resolutionTarget === "agent" || resolutionTarget === "human"
            ? resolutionTarget
            : null,
        excerpt,
        author,
        path: planPath(input.planId, input.kind),
      },
      { owner: input.ownerEmail ?? undefined },
    );
  } catch {
    // best-effort — never block comment writes
  }
}

export function emitPlanPublished(input: {
  planId: string;
  title: string;
  kind: PlanKind;
  hostedPlanId: string;
  url: string;
  requestedVisibility: string;
  ownerEmail?: string | null;
}) {
  try {
    emit(
      "plan.published",
      {
        planId: input.planId,
        title: input.title,
        kind: input.kind,
        hostedPlanId: input.hostedPlanId,
        url: input.url,
        requestedVisibility: input.requestedVisibility,
      },
      { owner: input.ownerEmail ?? undefined },
    );
  } catch {
    // best-effort — never block publish
  }
}

export function emitPlanStatusChanged(input: {
  planId: string;
  title: string;
  kind: PlanKind;
  oldStatus: string | null;
  newStatus: string;
  changedBy?: string | null;
  ownerEmail?: string | null;
}) {
  try {
    emit(
      "plan.status.changed",
      {
        planId: input.planId,
        title: input.title,
        kind: input.kind,
        oldStatus: input.oldStatus,
        newStatus: input.newStatus,
        changedBy: input.changedBy ?? null,
        path: planPath(input.planId, input.kind),
      },
      { owner: input.ownerEmail ?? undefined },
    );
  } catch {
    // best-effort — never block status changes
  }
}

export async function assertPlanEditor(planId: string) {
  const ctx = resolvePlanAccessContext(currentAccess());
  try {
    const access = await assertAccess("plan", planId, "editor", ctx);
    if ((access.resource as typeof schema.plans.$inferSelect).deletedAt) {
      throw new ForbiddenError(`Plan ${planId} not found`);
    }
    return access;
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    // The caller failed the editor gate. If they can still READ the resource
    // (viewer on an org/public plan or recap), replace core's bare role error
    // ("Requires editor role on plan X (have viewer)") with a teaching error
    // that names the resource kind and the sanctioned next step. Agents retry
    // bare role errors verbatim in a loop; they act on errors that say what to
    // do instead. Callers with no read access (or a deleted plan) keep the
    // original non-leaking error.
    const readable = await resolveAccess("plan", planId, ctx).catch(() => null);
    const resource = readable?.resource as
      | typeof schema.plans.$inferSelect
      | undefined;
    if (!readable || !resource || resource.deletedAt) throw error;
    throw new ForbiddenError(
      resource.kind === "recap"
        ? `Recap ${planId} is read-only for you (your role: ${readable.role}). Recaps are published review snapshots owned by whoever published them (often the PR recap workflow), and changing one requires editor access. Do not retry this call with the same arguments. Instead: (1) add review feedback with a comment-only update-visual-plan call or reply-to-plan-comment — commenting only needs viewer access; (2) publish an updated recap you own with create-visual-recap (pass its planId only when replacing a recap you own); or (3) ask the recap owner to share editor access.`
        : `Plan ${planId} is read-only for you (your role: ${readable.role}); this operation requires editor access. Do not retry this call with the same arguments. Instead add feedback with a comment-only update-visual-plan call or reply-to-plan-comment — commenting only needs viewer access — or ask the plan owner to share editor access.`,
    );
  }
}

export async function loadPlanBundle(planId: string): Promise<PlanBundle> {
  const access = await resolveAccess(
    "plan",
    planId,
    resolvePlanAccessContext(currentAccess()),
  );
  // `!access` means not-found OR no-permission (the resolver conflates them to
  // avoid leaking existence). Throw ForbiddenError (statusCode 403) so the action
  // surface returns a clean 4xx instead of a 500 stack — a missing/private plan
  // must never surface as an Internal Server Error.
  if (!access || !access.resource) {
    throw new ForbiddenError(`Plan ${planId} not found`);
  }
  const plan = access.resource as typeof schema.plans.$inferSelect;
  if (plan.deletedAt) {
    throw new ForbiddenError(`Plan ${planId} not found`);
  }
  return loadPlanBundleForAuthorizedPlan(planId, plan, access.role);
}

export async function loadPlanBundleForAgentAccess(
  planId: string,
): Promise<PlanBundle> {
  const db = getDb();
  // guard:allow-unscoped -- callers must verify a plan-scoped agent_access token before using this helper; it intentionally returns a read-only viewer bundle.
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan || plan.deletedAt) {
    throw new ForbiddenError(`Plan ${planId} not found`);
  }
  return loadPlanBundleForAuthorizedPlan(planId, plan, "viewer");
}

async function loadPlanBundleForAuthorizedPlan(
  planId: string,
  plan: typeof schema.plans.$inferSelect,
  role: PlanBundle["access"]["role"],
): Promise<PlanBundle> {
  const db = getDb();
  const [sectionRows, commentRows, eventRows] = await Promise.all([
    db
      .select()
      .from(schema.planSections)
      .where(eq(schema.planSections.planId, planId))
      .orderBy(
        asc(schema.planSections.order),
        asc(schema.planSections.createdAt),
      ),
    db
      .select()
      .from(schema.planComments)
      .where(
        and(
          eq(schema.planComments.planId, planId),
          isNull(schema.planComments.deletedAt),
        ),
      )
      .orderBy(asc(schema.planComments.createdAt)),
    db
      .select()
      .from(schema.planEvents)
      .where(eq(schema.planEvents.planId, planId))
      // plan_events is an append-only log with no cap; loadPlanBundle is polled
      // every 3s while a plan is open (usePlan refetchInterval), so fetching
      // every event ever written grows unbounded with plan age. Cap to the most
      // recent 50 and reverse back to ascending order — downstream consumers
      // (get-plan-feedback, PlansPage) only ever take the last 6-10 of a given
      // event type, well within this window.
      .orderBy(desc(schema.planEvents.createdAt))
      .limit(50),
  ]);

  const sections = sectionRows.map(toSection);
  const comments = commentRows.map(toComment);
  const events = eventRows.reverse().map(toEvent);
  return {
    plan: {
      id: plan.id,
      title: plan.title,
      brief: plan.brief,
      kind: plan.kind ?? "plan",
      status: plan.status,
      source: plan.source,
      repoPath: plan.repoPath,
      currentFocus: plan.currentFocus,
      hostedPlanId: plan.hostedPlanId,
      hostedPlanUrl: plan.hostedPlanUrl,
      sourceUrl: plan.sourceUrl,
      sourceAuthorName: plan.sourceAuthorName,
      sourceAuthorLogin: plan.sourceAuthorLogin,
      html: plan.html,
      markdown: plan.markdown,
      content: parsePlanContent(plan.content),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      approvedAt: plan.approvedAt,
      deletedAt: plan.deletedAt,
      deletedBy: plan.deletedBy,
    },
    access: {
      role,
      ownerEmail: plan.ownerEmail ?? null,
      orgId: plan.orgId ?? null,
      visibility: plan.visibility ?? "private",
    },
    sections,
    comments,
    events,
    summary: summarizePlan(sections, comments),
  };
}

/**
 * Full append-only event log for a plan, ascending. `loadPlanBundle` caps its
 * events at the most recent 50 because it sits on a 3s poll; durable receipts
 * (export-visual-plan) call this instead so the exported history stays
 * complete. Callers must have already resolved access to the plan.
 */
export async function loadFullPlanEvents(planId: string): Promise<PlanEvent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.planEvents)
    .where(eq(schema.planEvents.planId, planId))
    .orderBy(asc(schema.planEvents.createdAt));
  return rows.map(toEvent);
}

export function summarizePlan(
  sections: PlanSection[],
  comments: PlanComment[],
) {
  const sectionCounts: Record<string, number> = {};
  for (const section of sections) {
    sectionCounts[section.type] = (sectionCounts[section.type] ?? 0) + 1;
  }
  return {
    sectionCounts,
    commentCount: comments.length,
    openCommentCount: comments.filter((comment) => comment.status === "open")
      .length,
  };
}

export async function summarizePlans(
  plans: Array<
    Pick<
      typeof schema.plans.$inferSelect,
      | "id"
      | "title"
      | "brief"
      | "kind"
      | "status"
      | "source"
      | "repoPath"
      | "currentFocus"
      | "hostedPlanId"
      | "hostedPlanUrl"
      | "sourceUrl"
      | "sourceAuthorName"
      | "sourceAuthorLogin"
      | "createdAt"
      | "updatedAt"
      | "approvedAt"
      | "deletedAt"
      | "deletedBy"
      | "ownerEmail"
    >
  >,
  options: { deleteOwnerEmail?: string | null } = {},
): Promise<PlanSummary[]> {
  if (plans.length === 0) return [];
  const ids = plans.map((plan) => plan.id);
  const db = getDb();
  // Project only the columns summarizePlan() actually uses — `type` for
  // section counts and `status` for open/total comment counts. A bare
  // `.select()` would pull every column including large html/body/anchor blobs
  // for all comments across all listed plans, which is pure waste here.
  const [sectionRows, commentRows] = await Promise.all([
    db
      .select({
        planId: schema.planSections.planId,
        type: schema.planSections.type,
      })
      .from(schema.planSections)
      .where(inArray(schema.planSections.planId, ids)),
    db
      .select({
        planId: schema.planComments.planId,
        status: schema.planComments.status,
      })
      .from(schema.planComments)
      .where(
        and(
          inArray(schema.planComments.planId, ids),
          isNull(schema.planComments.deletedAt),
        ),
      ),
  ]);
  return plans.map((plan) => {
    // summarizePlan only needs type (sections) and status (comments).
    const sections = sectionRows
      .filter((section) => section.planId === plan.id)
      .map((row) => ({ type: row.type }) as PlanSection);
    const comments = commentRows
      .filter((comment) => comment.planId === plan.id)
      .map((row) => ({ status: row.status }) as PlanComment);
    return {
      id: plan.id,
      title: plan.title,
      brief: plan.brief,
      kind: plan.kind ?? "plan",
      status: plan.status,
      source: plan.source,
      repoPath: plan.repoPath,
      currentFocus: plan.currentFocus,
      hostedPlanId: plan.hostedPlanId,
      hostedPlanUrl: plan.hostedPlanUrl,
      sourceUrl: plan.sourceUrl,
      sourceAuthorName: plan.sourceAuthorName,
      sourceAuthorLogin: plan.sourceAuthorLogin,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      approvedAt: plan.approvedAt,
      deletedAt: plan.deletedAt,
      deletedBy: plan.deletedBy,
      ownerEmail: plan.ownerEmail ?? null,
      canDelete: Boolean(
        options.deleteOwnerEmail &&
        plan.ownerEmail === options.deleteOwnerEmail,
      ),
      ...summarizePlan(sections, comments),
    };
  });
}

export function deriveSectionsFromText(planText: string) {
  const chunks = planText
    .split(/\n(?=#{1,3}\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const sourceChunks = chunks.length > 1 ? chunks : [planText.trim()];
  const sections: Array<z.infer<typeof sectionInputSchema>> = sourceChunks
    .slice(0, 8)
    .map((chunk, index) => {
      const [firstLine = `Plan section ${index + 1}`, ...rest] =
        chunk.split(/\r?\n/);
      const title = firstLine.replace(/^#{1,3}\s+/, "").trim();
      const body = rest.join("\n").trim() || chunk;
      return {
        type: inferSectionType(title, body),
        title: title.slice(0, 120) || `Plan section ${index + 1}`,
        body,
        order: index,
        createdBy: "import" as const,
      };
    });
  if (!sections.some((section) => section.type === "diagram")) {
    sections.splice(1, 0, {
      type: "diagram" as const,
      title: "How the plan fits together",
      body: "Generated companion diagram for the imported plan.",
      html: renderCompanionDiagramHtml(planText),
      order: 1,
      createdBy: "agent" as const,
    });
  }
  return sections.map((section, index) => ({ ...section, order: index }));
}

function inferSectionType(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  if (
    /\b(file|files|symbol|symbols|component|function|implementation|touch|update|modify)\b/.test(
      text,
    ) &&
    findFileReferences(`${title}\n${body}`).length > 0
  ) {
    return "implementation" as const;
  }
  if (/\b(mockup|screen|ui|layout)\b/.test(text)) {
    return "mockup" as const;
  }
  if (/\b(wireframe|prototype)\b/.test(text)) {
    return "wireframe" as const;
  }
  if (/\b(flow|architecture|diagram|state|data)\b/.test(text)) {
    return "diagram" as const;
  }
  if (/\b(step|task|phase|implement|build)\b/.test(text)) {
    return "steps" as const;
  }
  if (/\b(decision|option|tradeoff|choose)\b/.test(text)) {
    return "decisions" as const;
  }
  if (/\b(question|open|unclear|assume|risk)\b/.test(text)) {
    return "questions" as const;
  }
  return "summary" as const;
}

export function buildPlanHtml(bundle: PlanBundle): string {
  if (bundle.plan.content) {
    return buildPlanContentHtml({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      source: bundle.plan.source,
      status: bundle.plan.status,
      repoPath: bundle.plan.repoPath,
    });
  }
  const storedHtml = normalizeStoredHtml(bundle.plan.html);
  if (storedHtml.trim()) return storedHtml;
  const title = escapeHtml(bundle.plan.title);
  const brief = escapeHtml(bundle.plan.brief);
  const sectionHtml = bundle.sections
    .map((section) => renderSectionHtml(section, bundle.plan.repoPath))
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${DOCUMENT_CSS}</style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="kicker">Working plan</p>
      <h1>${title}</h1>
      <p class="lede">${brief}</p>
      <ul class="meta">
        <li>${escapeHtml(bundle.plan.source)}</li>
        <li>${escapeHtml(bundle.plan.status.replace(/_/g, " "))}</li>
        ${bundle.plan.repoPath ? `<li>${escapeHtml(bundle.plan.repoPath)}</li>` : ""}
      </ul>
    </section>
    ${sectionHtml}
  </main>
</body>
</html>`;
}

function normalizeStoredHtml(value: unknown): string {
  let raw: string;
  if (typeof value === "string") raw = value;
  else if (value instanceof Uint8Array)
    raw = Buffer.from(value).toString("utf8");
  else if (value == null) raw = "";
  else raw = String(value);
  // Sanitize at the render/export choke point so every consumer of the legacy
  // `html` escape-hatch — and any row written before write-time sanitization —
  // is stripped of script execution before it reaches an iframe.
  return raw ? sanitizeStoredPlanHtml(raw) : raw;
}

function renderSectionHtml(section: PlanSection, repoPath?: string | null) {
  const body = markdownishToHtml(section.body);
  const custom = section.html?.trim();
  const visual =
    custom ||
    (section.type === "implementation"
      ? renderImplementationMapHtml(section.body, repoPath)
      : section.type === "wireframe" || section.type === "mockup"
        ? renderWireframeHtml(section.title)
        : section.type === "diagram"
          ? renderFlowHtml(section.title)
          : "");
  const renderBody = !(section.type === "implementation" && visual);
  if (!section.title.trim() && !body && !visual) return "";
  return `<section id="${escapeHtml(section.id)}" class="plan-section ${escapeHtml(section.type)}">
  <p class="section-type">${escapeHtml(section.type.replace(/_/g, " "))}</p>
  <h2>${escapeHtml(section.title)}</h2>
  ${visual ? `<div class="visual">${visual}</div>` : ""}
  ${renderBody && body ? `<div class="copy">${body}</div>` : ""}
</section>`;
}

const FILE_REFERENCE_PATTERN =
  /(?:^|[\s([`])((?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@(). -]+\.(?:tsx?|jsx?|css|scss|mdx?|json|jsonc|sql|py|go|rs|java|kt|swift|rb|php|ya?ml|toml|html|vue|svelte|astro|graphql|gql|prisma|sh|bash|zsh))(?:[:#](\d+))?/gim;

function findFileReferences(value: string) {
  const refs: Array<{ path: string; line?: number; index: number }> = [];
  let match: RegExpExecArray | null;
  FILE_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = FILE_REFERENCE_PATTERN.exec(value))) {
    const rawPath = match[1]?.trim().replace(/[),.;\]]+$/, "");
    if (!rawPath) continue;
    refs.push({
      path: rawPath,
      line: match[2] ? Number(match[2]) : undefined,
      index: match.index,
    });
  }
  return refs;
}

function parseImplementationFiles(
  body: string,
  repoPath?: string | null,
): ImplementationFile[] {
  const implementationFiles = new Map<string, ImplementationFile>();
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    for (const ref of findFileReferences(line)) {
      const existing = implementationFiles.get(ref.path);
      const summary = cleanImplementationSummary(line, ref.path);
      const symbols = extractSymbols(line, ref.path);
      if (existing) {
        if (!existing.line && ref.line) existing.line = ref.line;
        if (summary && !existing.summary) existing.summary = summary;
        for (const symbol of symbols) {
          if (!existing.symbols.includes(symbol)) existing.symbols.push(symbol);
        }
        continue;
      }
      implementationFiles.set(ref.path, {
        id: stableDomId(`impl-${ref.path}`),
        path: ref.path,
        absolutePath: resolveImplementationPath(repoPath, ref.path),
        line: ref.line,
        language: inferLanguage(ref.path),
        summary,
        symbols,
      });
    }
  }

  const fences = Array.from(body.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)).map(
    (match) => ({
      info: match[1]?.trim() ?? "",
      code: match[2]?.trimEnd() ?? "",
      index: match.index ?? 0,
    }),
  );

  for (const fence of fences) {
    const nearbyRefs = findFileReferences(
      body.slice(Math.max(0, fence.index - 280), fence.index),
    );
    const hintedRef =
      findFileReferences(fence.info)[0] || nearbyRefs[nearbyRefs.length - 1];
    const item = hintedRef
      ? implementationFiles.get(hintedRef.path)
      : Array.from(implementationFiles.values()).find(
          (candidate) => !candidate.previewCode,
        );
    if (!item) continue;
    item.previewCode = fence.code;
    item.language = inferLanguage(item.path, fence.info) || item.language;
  }

  return Array.from(implementationFiles.values()).slice(0, 12);
}

function cleanImplementationSummary(line: string, path: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(new RegExp(`${escapeRegExp(path)}(?::\\d+)?`), "")
    .replace(/\s+[—-]\s+/, " ")
    .replace(/\b(symbols?|components?|functions?)\s*:\s*[^.;]+[.;]?/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function extractSymbols(line: string, path: string) {
  const symbols = new Set<string>();
  const explicit = line.match(
    /\b(?:symbols?|components?|functions?)\s*:\s*([^.;]+)/i,
  );
  if (explicit?.[1]) {
    for (const part of explicit[1].split(/[,/]/)) {
      const symbol = part.trim().replace(/^`|`$/g, "");
      if (symbol && symbol !== path) symbols.add(symbol);
    }
  }
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value && value !== path && !value.includes("/")) symbols.add(value);
  }
  return Array.from(symbols).slice(0, 5);
}

function resolveImplementationPath(
  repoPath: string | null | undefined,
  filePath: string,
) {
  if (filePath.startsWith("/")) return filePath;
  if (!repoPath) return undefined;
  return `${repoPath.replace(/\/+$/, "")}/${filePath.replace(/^\.?\//, "")}`;
}

function inferLanguage(filePath: string, info = "") {
  const infoLang = info
    .split(/\s+/)[0]
    ?.replace(/[^\w#+-]/g, "")
    .toLowerCase();
  if (infoLang && !infoLang.includes("/")) return infoLang;
  const extension = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    css: "css",
    scss: "scss",
    md: "md",
    mdx: "mdx",
    json: "json",
    jsonc: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    py: "py",
    rs: "rs",
    go: "go",
    sql: "sql",
    sh: "sh",
    bash: "sh",
    zsh: "sh",
  };
  return (extension && map[extension]) || "text";
}

function stableDomId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorFilePath(absolutePath?: string) {
  if (!absolutePath) return "";
  return absolutePath;
}

const EDITOR_OPTIONS = [
  {
    value: "vscode",
    label: "VS Code",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-brand-vscode" aria-hidden="true"><path d="M16 3v18l4 -2.5v-13l-4 -2.5"></path><path d="M9.165 13.903l-4.165 3.597l-2 -1l4.333 -4.5m1.735 -1.802l6.932 -7.198v5l-4.795 4.141"></path><path d="M16 16.5l-11 -10l-2 1l13 13.5"></path></svg>`,
  },
  {
    value: "cursor",
    label: "Cursor",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-cube" aria-hidden="true"><path d="M21 16.008v-8.018a1.98 1.98 0 0 0 -1 -1.717l-7 -4.008a2.016 2.016 0 0 0 -2 0l-7 4.008c-.619 .355 -1 1.01 -1 1.718v8.018c0 .709 .381 1.363 1 1.717l7 4.008a2.016 2.016 0 0 0 2 0l7 -4.008c.619 -.355 1 -1.01 1 -1.718"></path><path d="M12 22v-10"></path><path d="M12 12l8.73 -5.04"></path><path d="M3.27 6.96l8.73 5.04"></path></svg>`,
  },
  {
    value: "finder",
    label: "Finder",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-brand-finder" aria-hidden="true"><path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -14"></path><path d="M7 8v1"></path><path d="M17 8v1"></path><path d="M12.5 4c-.654 1.486 -1.26 3.443 -1.5 9h2.5c-.19 2.867 .094 5.024 .5 7"></path><path d="M7 15.5c3.667 2 6.333 2 10 0"></path></svg>`,
  },
  {
    value: "terminal",
    label: "Terminal",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-terminal-2" aria-hidden="true"><path d="M8 9l3 3l-3 3"></path><path d="M13 15l3 0"></path><path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12"></path></svg>`,
  },
  {
    value: "ghostty",
    label: "Ghostty",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-ghost-3" aria-hidden="true"><path d="M5 11a7 7 0 0 1 14 0v7a1.78 1.78 0 0 1 -3.1 1.4a1.65 1.65 0 0 0 -2.6 0a1.65 1.65 0 0 1 -2.6 0a1.65 1.65 0 0 0 -2.6 0a1.78 1.78 0 0 1 -3.1 -1.4v-7"></path><path d="M10 10h.01"></path><path d="M14 10h.01"></path></svg>`,
  },
  {
    value: "xcode",
    label: "Xcode",
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-hammer" aria-hidden="true"><path d="M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385"></path><path d="M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0"></path></svg>`,
  },
] as const;

function renderEditorIconHtml(editor: (typeof EDITOR_OPTIONS)[number]) {
  return `<span class="editor-icon editor-icon-${escapeHtml(editor.value)}">${editor.icon}</span>`;
}

function renderEditorPickerHtml(editorPath: string, editorLine: string) {
  const current = EDITOR_OPTIONS[0];
  return `<div class="editor-picker" data-agent-native-editor-picker data-editor="${current.value}">
    <button type="button" class="editor-picker-trigger" data-agent-native-editor-trigger aria-haspopup="menu" aria-expanded="false" aria-label="Choose editor">
      ${renderEditorIconHtml(current)}
      <span class="editor-picker-sr">Preferred editor: ${current.label}</span>
      <span class="editor-picker-caret" aria-hidden="true"></span>
    </button>
    <select class="editor-picker-select" data-agent-native-editor-select aria-hidden="true" tabindex="-1">
      ${EDITOR_OPTIONS.map((editor) => `<option value="${escapeHtml(editor.value)}">${escapeHtml(editor.label)}</option>`).join("")}
    </select>
    <div class="editor-picker-menu" data-agent-native-editor-menu role="menu">
      ${EDITOR_OPTIONS.map(
        (editor) =>
          `<button type="button" class="editor-picker-option${editor.value === current.value ? " is-active" : ""}" data-agent-native-editor-option="${escapeHtml(editor.value)}" role="menuitemradio" aria-checked="${editor.value === current.value ? "true" : "false"}">
            ${renderEditorIconHtml(editor)}
            <span>${escapeHtml(editor.label)}</span>
          </button>`,
      ).join("")}
    </div>
    <button type="button" class="editor-picker-open" data-agent-native-open-selected-editor data-agent-native-open-file="${escapeHtml(editorPath)}"${editorLine}>Open</button>
  </div>`;
}

function renderImplementationMapHtml(body: string, repoPath?: string | null) {
  const files = parseImplementationFiles(body, repoPath);
  if (files.length === 0) return "";
  const mapId =
    stableDomId(`impl-map-${files.map((file) => file.path).join("-")}`) ||
    "implementation-map";
  return `<div class="implementation-map" data-plan-implementation-map data-plan-tabs>
    <div class="implementation-map-header">
      <span>${files.length} file${files.length === 1 ? "" : "s"}</span>
      <span>select a file to review intent, snippet, and editor link</span>
    </div>
    <div class="implementation-file-tabs">
      <div class="implementation-file-list" role="tablist" aria-label="Files touched">
        ${files
          .map((file, index) =>
            renderImplementationFileTabHtml(file, `${mapId}-${file.id}`, index),
          )
          .join("")}
      </div>
      <div class="implementation-file-panels">
        ${files
          .map((file, index) =>
            renderImplementationFileHtml(file, `${mapId}-${file.id}`, index),
          )
          .join("")}
      </div>
    </div>
  </div>`;
}

function renderImplementationFileTabHtml(
  file: ImplementationFile,
  targetId: string,
  index: number,
) {
  return `<button type="button" class="implementation-file-tab${index === 0 ? " is-active" : ""}" data-tab-target="${escapeHtml(targetId)}" data-file-path="${escapeHtml(file.path)}">
    <span class="file-tab-name">${escapeHtml(fileBasename(file.path))}</span>
    <span class="file-tab-path">${escapeHtml(file.path)}</span>
  </button>`;
}

function renderImplementationFileHtml(
  file: ImplementationFile,
  targetId: string,
  index: number,
) {
  const previewCode =
    file.previewCode ||
    `// No embedded preview yet.\n// Ask the agent to add the exact snippet it plans to modify for ${file.path}.`;
  const editorPath = editorFilePath(file.absolutePath);
  const editorLine = file.line
    ? ` data-agent-native-open-line="${escapeHtml(String(file.line))}"`
    : "";
  return `<article class="implementation-file implementation-file-panel tab-panel${index === 0 ? " is-active" : ""}" data-tab-panel="${escapeHtml(targetId)}" data-file-path="${escapeHtml(file.path)}">
    <div class="file-detail-header">
      <div class="file-title-stack">
        <p class="file-name">${escapeHtml(fileBasename(file.path))}</p>
        <p class="file-path">${escapeHtml(file.path)}</p>
      </div>
      <div class="file-actions">
        ${editorPath ? renderEditorPickerHtml(editorPath, editorLine) : ""}
      </div>
    </div>
    <div class="file-detail-body">
      ${file.summary ? `<p class="file-summary">${escapeHtml(file.summary)}</p>` : ""}
      <div class="code-preview inline-code-preview" data-file-path="${escapeHtml(file.path)}" data-agent-native-open-file="${escapeHtml(editorPath)}"${editorLine}>
        <pre><code>${highlightCodeHtml(previewCode, file.language)}</code></pre>
      </div>
    </div>
  </article>`;
}

function fileBasename(path: string) {
  return path.split("/").filter(Boolean).pop() || path;
}

function highlightCodeHtml(code: string, language: string) {
  const escaped = escapeHtml(code);
  const highlighted = escaped
    .replace(
      /(&quot;[^&]*(?:&quot;)|&#39;[^&]*(?:&#39;)|`[^`]*`)/g,
      '<span class="syntax-string">$1</span>',
    )
    .replace(
      /\b(import|export|from|const|let|var|function|return|type|interface|class|extends|async|await|if|else|for|while|new|throw|try|catch|switch|case|default)\b/g,
      '<span class="syntax-keyword">$1</span>',
    )
    .replace(
      /\b(true|false|null|undefined)\b/g,
      '<span class="syntax-literal">$1</span>',
    );
  if (/(sh|bash|zsh|py|yaml|yml)/.test(language)) {
    return highlighted.replace(
      /(^|\n)(\s*#.*)/g,
      '$1<span class="syntax-comment">$2</span>',
    );
  }
  return highlighted.replace(
    /(^|\n)(\s*\/\/.*)/g,
    '$1<span class="syntax-comment">$2</span>',
  );
}

function markdownishToHtml(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const listLines = lines.filter((line) => /^[-*]\s+/.test(line));
  if (listLines.length >= Math.max(2, Math.ceil(lines.length * 0.5))) {
    return `<ul>${lines
      .map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`)
      .join("")}</ul>`;
  }
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderWireframeHtml(title: string) {
  return `<div class="visual-tabs" data-plan-tabs>
    <div class="tab-list" role="tablist" aria-label="${escapeHtml(title)} visual options">
      <button type="button" class="tab-button is-active" data-tab-target="reader">Reader</button>
      <button type="button" class="tab-button" data-tab-target="comments">Comments</button>
      <button type="button" class="tab-button" data-tab-target="review">Review</button>
    </div>
    <div class="tab-panel is-active" data-tab-panel="reader">
      ${renderWireframeShellHtml(title, "Plan review", "Comment")}
    </div>
    <div class="tab-panel" data-tab-panel="comments">
      ${renderWireframeShellHtml(title, "Inline annotations", "Reply")}
    </div>
    <div class="tab-panel" data-tab-panel="review">
      ${renderWireframeShellHtml(title, "Feedback queue", "Apply")}
    </div>
  </div>`;
}

function renderWireframeShellHtml(
  title: string,
  label: string,
  action: string,
) {
  return `<div class="wireframe-shell" aria-label="${escapeHtml(title)} wireframe">
    <div class="window-bar"><i></i><i></i><i></i><strong>Plan review</strong></div>
    <div class="screen-body">
      <aside>
        <span class="nav-dot"></span>
        <span class="nav-line wide"></span>
        <span class="nav-line"></span>
        <span class="nav-line short"></span>
      </aside>
      <main>
        <div class="toolbar"><span></span><span></span><button>${escapeHtml(action)}</button></div>
        <div class="document-line title"></div>
        <div class="document-line"></div>
        <div class="wide-preview">
          <div aria-label="${escapeHtml(label)} primary area"></div><div></div><div></div>
        </div>
        <div class="detail-row"><i></i><i></i><i></i></div>
      </main>
    </div>
  </div>`;
}

function renderFlowHtml(title: string) {
  return `<div class="visual-tabs" data-plan-tabs>
    <div class="tab-list" role="tablist" aria-label="${escapeHtml(title)} diagram options">
      <button type="button" class="tab-button is-active" data-tab-target="flow">Flow</button>
      <button type="button" class="tab-button" data-tab-target="handoff">Agent handoff</button>
    </div>
    <div class="tab-panel is-active" data-tab-panel="flow">
      <div class="flow-diagram" aria-label="${escapeHtml(title)} flow diagram">
        <div><strong>Intent</strong><span>User asks for a plan</span></div>
        <div><strong>Visualize</strong><span>Agent creates HTML companion</span></div>
        <div><strong>React</strong><span>User annotates visuals</span></div>
        <div><strong>Build</strong><span>Agent follows the revised plan</span></div>
      </div>
    </div>
    <div class="tab-panel" data-tab-panel="handoff">
      <div class="flow-diagram" aria-label="${escapeHtml(title)} handoff diagram">
        <div><strong>Markdown plan</strong><span>Dense text gets skimmed</span></div>
        <div><strong>HTML plan</strong><span>Diagrams and UI make intent concrete</span></div>
        <div><strong>Annotations</strong><span>Feedback is pinned to exact context</span></div>
        <div><strong>Agent loop</strong><span>Agent reads comments before edits</span></div>
      </div>
    </div>
  </div>`;
}

function renderCompanionDiagramHtml(planText: string) {
  const words = planText
    .split(/\s+/)
    .filter((word) => /^[A-Za-z][A-Za-z-]{3,}$/.test(word))
    .slice(0, 4);
  const labels =
    words.length >= 4 ? words : ["Plan", "Visuals", "Review", "Build"];
  return `<div class="flow-diagram">
    ${labels
      .map(
        (label, index) =>
          `<div><strong>${escapeHtml(label)}</strong><span>Step ${index + 1}</span></div>`,
      )
      .join("")}
  </div>`;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DOCUMENT_CSS = `
:root { color-scheme: dark; --bg: #0a0a0b; --paper: #111113; --paper-2: #171719; --line: #28282c; --text: #f2f2f3; --muted: #a4a4aa; --soft: #d7d7da; --accent: #00B5FF; --accent-soft: rgba(0,181,255,.12); --shadow: 0 24px 70px rgba(0,0,0,.28); }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
main { width: min(1120px, calc(100vw - 48px)); margin: 0 auto; padding: 96px 0 96px; }
.hero { max-width: 760px; padding-bottom: 30px; border-bottom: 1px solid var(--line); }
.kicker, .section-type { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(36px, 5vw, 58px); line-height: 1.02; letter-spacing: -.04em; }
.lede { margin: 20px 0 0; color: var(--soft); font-size: clamp(18px, 2vw, 23px); line-height: 1.45; }
.meta { display: grid; gap: 7px; margin: 26px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; }
.meta li::marker { color: var(--accent); }
.plan-section { margin-top: 70px; padding-top: 46px; border-top: 1px solid var(--line); scroll-margin-top: 72px; }
.plan-section h2 { margin: 0; font-size: clamp(26px, 4vw, 42px); letter-spacing: -.035em; }
.copy { max-width: 760px; margin-top: 18px; color: var(--soft); font-size: 17px; }
.copy p { margin: 0 0 14px; }
.copy ul { margin: 0; padding-left: 20px; }
.copy li { margin: 9px 0; }
.visual { margin: 24px 0; }
.visual-tabs { display: grid; gap: 14px; }
.tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 4px; border: 1px solid var(--line); border-radius: 11px; background: var(--paper-2); padding: 4px; overflow-x: auto; }
.tab-button { min-height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); padding: 0 11px; font: 650 12px/30px inherit; white-space: nowrap; cursor: pointer; }
.tab-button:hover { color: var(--text); background: rgba(255,255,255,.05); }
.tab-button.is-active { background: var(--text); color: var(--bg); }
.tab-panel { display: none; }
.tab-panel.is-active { display: block; }
.flow-diagram { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.flow-diagram div { position: relative; min-height: 124px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper-2); padding: 16px; }
.flow-diagram div:not(:last-child)::after { content: ""; position: absolute; top: 50%; right: -10px; width: 10px; height: 1px; background: var(--accent); }
.flow-diagram strong { display: block; margin-bottom: 8px; }
.flow-diagram span { color: var(--muted); font-size: 14px; }
.wireframe-shell { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--paper-2); box-shadow: var(--shadow); }
.window-bar { height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.window-bar i { width: 8px; height: 8px; border-radius: 999px; background: #4a4a50; }
.window-bar strong { margin-left: auto; font-weight: 600; color: var(--soft); }
.screen-body { min-height: 430px; display: grid; grid-template-columns: 190px 1fr; }
.wireframe-shell aside { display: grid; align-content: start; gap: 13px; padding: 18px; border-right: 1px solid var(--line); background: #0d0d0f; }
.nav-dot { width: 34px; height: 34px; border-radius: 11px; background: var(--accent-soft); border: 1px solid rgba(0,181,255,.28); }
.nav-line, .document-line, .toolbar span { display: block; border-radius: 999px; background: #3b3b40; }
.nav-line { height: 9px; width: 72%; }
.nav-line.wide { width: 86%; }
.nav-line.short { width: 52%; }
.wireframe-shell main { width: auto; margin: 0; padding: 18px; }
.toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 24px; }
.toolbar span { width: 34px; height: 30px; }
.toolbar button { border: 0; border-radius: 8px; background: #ececef; color: #111113; padding: 0 18px; font: 700 12px/30px inherit; }
.document-line { height: 13px; width: 46%; margin-bottom: 12px; }
.document-line.title { height: 24px; width: 66%; background: #5b5b62; }
.wide-preview { min-height: 190px; display: grid; grid-template-columns: 1.1fr .85fr .85fr; gap: 12px; margin: 26px 0 14px; }
.wide-preview div { border-radius: 14px; background: var(--accent-soft); border: 1px solid rgba(0,181,255,.26); }
.detail-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.detail-row i { height: 116px; border-radius: 14px; background: #202024; border: 1px solid var(--line); }
.implementation-map { margin: 24px 0; border-top: 1px solid var(--line); }
.implementation-map-header { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; color: var(--muted); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.implementation-file-tabs { min-height: 330px; display: grid; grid-template-columns: minmax(220px, .44fr) minmax(0, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.implementation-file-list { display: grid; align-content: start; border-right: 1px solid var(--line); }
.implementation-file-tab { width: 100%; display: grid; gap: 3px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--muted); padding: 13px 14px; text-align: left; cursor: pointer; }
.implementation-file-tab:hover { background: rgba(255,255,255,.035); color: var(--soft); }
.implementation-file-tab.is-active { background: var(--paper-2); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
.file-tab-name, .file-tab-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-tab-name { font: 700 14px/1.35 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-tab-path { font: 500 12px/1.35 "SFMono-Regular", Consolas, "Liberation Mono", monospace; color: var(--muted); }
.implementation-file-tab.is-active .file-tab-path { color: var(--soft); }
.implementation-file-panels { min-width: 0; }
.implementation-file-panel { display: none; min-height: 100%; padding: 18px 20px 20px; }
.implementation-file-panel.is-active { display: block; }
.file-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
.file-title-stack { min-width: 0; display: grid; gap: 5px; }
.file-name { margin: 0; color: var(--text); font: 750 18px/1.25 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-path { margin: 0; overflow-wrap: anywhere; color: var(--muted); font: 500 12px/1.45 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.file-detail-body { padding-top: 16px; }
.file-summary { max-width: 760px; margin: 0; color: var(--soft); font-size: 15px; }
.inline-code-preview { margin-top: 18px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: #0c0c0e; }
.file-actions { display: flex; align-items: flex-start; gap: 8px; }
.file-actions button { min-height: 32px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--soft); padding: 0 10px; font: 650 12px/30px inherit; cursor: pointer; }
.file-actions button:hover { border-color: rgba(0,181,255,.44); color: var(--text); background: rgba(0,181,255,.08); }
.editor-picker { position: relative; display: inline-flex; min-height: 32px; align-items: stretch; overflow: visible; border: 1px solid var(--line); border-radius: 8px; background: transparent; }
.editor-picker:focus-within, .editor-picker:hover { border-color: rgba(0,181,255,.44); background: rgba(0,181,255,.06); }
.editor-picker button { min-height: 30px; border: 0; border-radius: 0; background: transparent; color: var(--soft); padding: 0 10px; font: 650 12px/30px inherit; cursor: pointer; }
.editor-picker-trigger { display: inline-flex; width: 48px; align-items: center; justify-content: center; gap: 6px; border-right: 1px solid var(--line) !important; border-radius: 7px 0 0 7px !important; }
.editor-picker-open { border-radius: 0 7px 7px 0 !important; color: var(--text) !important; }
.editor-picker-select { display: none; }
.editor-picker-caret { width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-1px) rotate(45deg); opacity: .72; }
.editor-picker-menu { position: absolute; top: calc(100% + 7px); right: 0; z-index: 20; display: none; width: 188px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); padding: 6px; box-shadow: 0 18px 50px rgba(0,0,0,.26); }
.editor-picker[data-open="true"] .editor-picker-menu { display: grid; gap: 2px; }
.editor-picker-option { display: flex !important; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; border-radius: 8px !important; text-align: left; }
.editor-picker-option:hover, .editor-picker-option.is-active { background: rgba(255,255,255,.06); color: var(--text); }
.editor-icon { display: inline-flex; width: 18px; height: 18px; flex: 0 0 auto; align-items: center; justify-content: center; }
.editor-icon svg { width: 18px; height: 18px; stroke-width: 2; }
.editor-icon-vscode { color: #41a6f6; }
.editor-icon-cursor { color: var(--text); }
.editor-icon-finder { color: #4aa9ff; }
.editor-icon-terminal { color: #73d99f; }
.editor-icon-ghostty { color: #a78bfa; }
.editor-icon-xcode { color: #54a7ff; }
.editor-picker-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
:root[data-agent-native-theme="light"] .editor-picker-option:hover, :root[data-agent-native-theme="light"] .editor-picker-option.is-active { background: rgba(0,0,0,.06); }
.code-preview pre { margin: 0; max-height: 420px; overflow: auto; padding: 14px 16px; background: #0c0c0e !important; color: #e9e9ea; font: 12px/1.65 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.code-preview pre code { display: block; min-width: max-content; color: inherit !important; font: inherit; white-space: pre; }
.code-preview pre code, .code-preview pre code *, .inline-code-preview pre code, .inline-code-preview pre code * { margin: 0 !important; border: 0 !important; border-radius: 0 !important; outline: 0 !important; background: transparent !important; background-image: none !important; box-shadow: none !important; padding: 0 !important; text-decoration: none !important; }
.code-preview pre code code, .inline-code-preview pre code code { display: inline !important; }
.syntax-keyword { color: #7cc7ff; }
.syntax-string { color: #a6e3a1; }
.syntax-literal { color: #f7c876; }
.syntax-comment { color: #7a7a83; }
@media (max-width: 760px) { main { width: min(100vw - 24px, 980px); padding-top: 72px; } .flow-diagram, .screen-body, .wide-preview, .detail-row, .implementation-file-tabs { grid-template-columns: 1fr; } .implementation-map-header, .file-detail-header, .file-actions { flex-wrap: wrap; } .implementation-file-list { border-right: 0; } .implementation-file-panels { border-top: 1px solid var(--line); } .flow-diagram div::after { display: none; } .wireframe-shell aside { border-right: 0; border-bottom: 1px solid var(--line); } }
`;
