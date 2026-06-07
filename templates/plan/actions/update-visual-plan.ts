import { defineAction } from "@agent-native/core";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  normalizePlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  isLocalPlanRuntime,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import { createPlanVersionSnapshot } from "../server/lib/plan-versions.js";
import { notifyPlanCommentRecipients } from "../server/lib/comment-notifications.js";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import {
  assertPlanEditor,
  buildPlanHtml,
  buildUpdatedPlanCommentRows,
  commentInputSchema,
  commentMetadataForInput,
  commentResolutionFields,
  loadPlanBundle,
  newId,
  nowIso,
  planPath,
  planStatusSchema,
  sectionInputSchema,
} from "../server/plans.js";
import {
  applyPlanContentPatches,
  planContentPatchesSchema,
  planContentSchema,
  type PlanBlock,
  type PlanContent,
  type PlanContentPatch,
} from "../shared/plan-content.js";

const CONTENT_PATCH_EXCERPT_LIMIT = 520;

function compactExcerpt(value: unknown, limit = CONTENT_PATCH_EXCERPT_LIMIT) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  const compacted = text.replace(/\s+/g, " ").trim();
  return compacted.length > limit
    ? `${compacted.slice(0, limit - 3)}...`
    : compacted;
}

function blockDataForExcerpt(block: PlanBlock) {
  if (block.type === "rich-text") return block.data.markdown;
  if (block.type === "callout") return block.data.body;
  if (block.type === "wireframe") {
    return block.data.html ?? block.data.caption ?? block.data.screen;
  }
  if (block.type === "diagram") return block.data;
  if (block.type === "custom-html") return block.data.html;
  return block.data;
}

function blockExcerpt(block: PlanBlock | null) {
  if (!block) return null;
  return {
    id: block.id,
    type: block.type,
    title: block.title ?? null,
    summary: block.summary ?? null,
    excerpt: compactExcerpt(blockDataForExcerpt(block)),
  };
}

function findContentBlock(
  blocks: PlanBlock[],
  blockId: string,
): PlanBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        const match = findContentBlock(tab.blocks, blockId);
        if (match) return match;
      }
    }
  }
  return null;
}

function contentPatchTargetId(patch: PlanContentPatch) {
  if ("blockId" in patch) return patch.blockId;
  if ("screenId" in patch) return patch.screenId;
  if (patch.op === "set-prototype" || patch.op === "remove-prototype") {
    return "prototype";
  }
  if (patch.op === "update-canvas-frame") return patch.frameId;
  if (patch.op === "update-canvas-annotation") return patch.annotationId;
  if (patch.op === "append-canvas-annotation") return patch.annotation.id;
  if (patch.op === "append-block") return patch.block.id;
  return null;
}

function isNewOpenHumanComment(comment: {
  id?: string;
  status: string;
  createdBy: string;
}) {
  return (
    !comment.id && comment.status === "open" && comment.createdBy === "human"
  );
}

function anchorPlanAnnotationId(anchor?: string) {
  if (!anchor) return null;
  try {
    const parsed = JSON.parse(anchor) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = (parsed as { planAnnotationId?: unknown }).planAnnotationId;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

function isCanvasReviewMarkupRequest(args: {
  title?: string;
  brief?: string;
  status?: string;
  currentFocus?: string;
  html?: string;
  content?: PlanContent;
  contentPatches: PlanContentPatch[];
  markdown?: string;
  sections: unknown[];
  consumedCommentIds: string[];
  comments: Array<{
    id?: string;
    status: string;
    createdBy: string;
    kind: string;
    anchor?: string;
  }>;
}) {
  if (
    args.title ||
    args.brief ||
    args.status ||
    args.currentFocus ||
    args.html !== undefined ||
    args.content !== undefined ||
    args.markdown !== undefined ||
    args.sections.length > 0 ||
    args.consumedCommentIds.length > 0 ||
    args.contentPatches.length === 0 ||
    args.comments.length === 0 ||
    args.contentPatches.length !== args.comments.length
  ) {
    return false;
  }
  if (
    !args.contentPatches.every(
      (patch) => patch.op === "append-canvas-annotation",
    ) ||
    !args.comments.every(
      (comment) =>
        isNewOpenHumanComment(comment) && comment.kind === "annotation",
    )
  ) {
    return false;
  }
  const commentAnnotationIds = new Set(
    args.comments
      .map((comment) => anchorPlanAnnotationId(comment.anchor))
      .filter((id): id is string => Boolean(id)),
  );
  if (commentAnnotationIds.size !== args.contentPatches.length) return false;
  return args.contentPatches.every(
    (patch) =>
      patch.op === "append-canvas-annotation" &&
      commentAnnotationIds.has(patch.annotation.id),
  );
}

function isExistingCommentStatusUpdateRequest(args: {
  title?: string;
  brief?: string;
  status?: string;
  currentFocus?: string;
  html?: string;
  content?: PlanContent;
  contentPatches: PlanContentPatch[];
  markdown?: string;
  sections: unknown[];
  consumedCommentIds: string[];
  comments: Array<{ id?: string; status: string }>;
}) {
  return (
    !args.title &&
    !args.brief &&
    !args.status &&
    !args.currentFocus &&
    args.html === undefined &&
    args.content === undefined &&
    args.contentPatches.length === 0 &&
    args.markdown === undefined &&
    args.sections.length === 0 &&
    args.consumedCommentIds.length === 0 &&
    args.comments.length > 0 &&
    args.comments.every(
      (comment) =>
        Boolean(comment.id) &&
        (comment.status === "open" || comment.status === "resolved"),
    )
  );
}

function preservesExistingCommentFields(
  comment: {
    sectionId?: string;
    kind: string;
    anchor?: string;
    message: string;
    resolutionTarget?: string;
    mentions?: unknown[];
  },
  existing: {
    sectionId: string | null;
    kind: string;
    anchor: string | null;
    message: string;
    resolutionTarget: string | null;
  },
) {
  return (
    (comment.sectionId ?? null) === existing.sectionId &&
    comment.kind === existing.kind &&
    (comment.anchor ?? null) === existing.anchor &&
    comment.message === existing.message &&
    (comment.resolutionTarget === undefined ||
      comment.resolutionTarget === existing.resolutionTarget) &&
    comment.mentions === undefined
  );
}

function prototypeItemExcerpt(
  content: PlanContent | null,
  patch: PlanContentPatch,
) {
  if (!content?.prototype) return null;
  if (patch.op === "set-prototype" || patch.op === "remove-prototype") {
    return {
      id: "prototype",
      type: "prototype",
      title: content.prototype.title ?? null,
      excerpt: compactExcerpt({
        screenCount: content.prototype.screens.length,
        transitionCount: content.prototype.transitions?.length ?? 0,
      }),
    };
  }
  if ("screenId" in patch) {
    const screen = content.prototype.screens.find(
      (candidate) => candidate.id === patch.screenId,
    );
    return screen
      ? {
          id: screen.id,
          type: "prototype-screen",
          title: screen.title ?? null,
          excerpt: compactExcerpt(screen.html),
        }
      : null;
  }
  return null;
}

function canvasItemExcerpt(
  content: PlanContent | null,
  patch: PlanContentPatch,
) {
  if (!content?.canvas) return null;
  if (patch.op === "update-canvas-frame") {
    const frame = content.canvas.frames.find(
      (candidate) => candidate.id === patch.frameId,
    );
    return frame
      ? {
          id: frame.id,
          type: "canvas-frame",
          label: frame.label ?? null,
          excerpt: compactExcerpt(frame),
        }
      : null;
  }
  if (patch.op === "update-canvas-annotation") {
    const annotation = content.canvas.annotations?.find(
      (candidate) => candidate.id === patch.annotationId,
    );
    return annotation
      ? {
          id: annotation.id,
          type: "canvas-annotation",
          title: annotation.title ?? null,
          excerpt: compactExcerpt(annotation),
        }
      : null;
  }
  return null;
}

function contentPatchDetails(input: {
  before: PlanContent | null;
  after: PlanContent | null;
  patches: PlanContentPatch[];
}) {
  return input.patches.map((patch, index) => {
    const targetId = contentPatchTargetId(patch);
    const beforeBlock =
      "blockId" in patch && input.before
        ? findContentBlock(input.before.blocks, patch.blockId)
        : null;
    const afterBlock =
      "blockId" in patch && input.after
        ? findContentBlock(input.after.blocks, patch.blockId)
        : patch.op === "append-block"
          ? patch.block
          : null;
    const beforeCanvas = canvasItemExcerpt(input.before, patch);
    const afterCanvas = canvasItemExcerpt(input.after, patch);
    const beforePrototype = prototypeItemExcerpt(input.before, patch);
    const afterPrototype = prototypeItemExcerpt(input.after, patch);
    return {
      index,
      op: patch.op,
      targetId,
      before: blockExcerpt(beforeBlock) ?? beforeCanvas ?? beforePrototype,
      after: blockExcerpt(afterBlock) ?? afterCanvas ?? afterPrototype,
      patch:
        patch.op === "patch-wireframe-html" ||
        patch.op === "patch-prototype-html"
          ? {
              editCount: patch.edits.length,
              edits: patch.edits.map((edit) => ({
                find: compactExcerpt(edit.find, 180),
                replace: compactExcerpt(edit.replace, 180),
                all: Boolean(edit.all),
              })),
            }
          : patch.op === "replace-blocks"
            ? {
                beforeBlockCount: input.before?.blocks.length ?? null,
                afterBlockCount: patch.blocks.length,
              }
            : patch.op === "update-prototype-screen"
              ? { fields: Object.keys(patch.patch) }
              : null,
    };
  });
}

export default defineAction({
  description:
    "Update an Agent-Native Plan's structured content blocks, prototype screens, sections, comments, or status. Prefer contentPatches for targeted edits such as copy changes, one element/text/color inside an html mockup via patch-wireframe-html or patch-prototype-html, one legacy wireframe kit-tree node, a whole wireframe, one canvas frame, one canvas annotation, one block append/remove, or one custom HTML fragment. Use full content only for broad restructuring; HTML updates are legacy import compatibility only.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    title: z.string().optional(),
    brief: z.string().optional(),
    status: planStatusSchema.optional(),
    currentFocus: z.string().optional(),
    html: z.string().optional(),
    content: planContentSchema.optional(),
    contentPatches: planContentPatchesSchema
      .optional()
      .default([])
      .describe(
        "Targeted structured content edits addressed by stable id. Prefer these for small changes: set-prototype / remove-prototype / update-prototype-screen / patch-prototype-html for live prototype plans; update-block / replace-block, update-rich-text, patch-wireframe-html (change one element/text/color inside an html mockup via find/replace edits - read the current html first with get-visual-plan), update-wireframe-node (one legacy kit-tree node), replace-wireframe-screen, update-canvas-frame, update-canvas-annotation / append-canvas-annotation, append-block / remove-block, or update-custom-html. Any agent (Claude, Codex, Cursor) can patch a single mockup, prototype state, or node without regenerating the plan. The renderer owns all visual styling; emit lean content, not pixels - never supply geometry or coordinates.",
      ),
    markdown: z.string().optional(),
    sections: z.array(sectionInputSchema).optional().default([]),
    comments: z.array(commentInputSchema).optional().default([]),
    consumedCommentIds: z.array(z.string()).optional().default([]),
    note: z.string().optional(),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Update Visual Plan",
    description:
      "Patch structured plan content, add visual sections, record comments, or mark feedback consumed.",
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    const onlyAddsNewComments =
      !args.title &&
      !args.brief &&
      !args.status &&
      !args.currentFocus &&
      args.html === undefined &&
      args.content === undefined &&
      args.contentPatches.length === 0 &&
      args.markdown === undefined &&
      args.sections.length === 0 &&
      args.consumedCommentIds.length === 0 &&
      args.comments.length > 0 &&
      args.comments.every((comment) => isNewOpenHumanComment(comment));
    const onlyAddsCanvasReviewMarkup = isCanvasReviewMarkupRequest(args);
    const onlyAddsReviewerFeedback =
      onlyAddsNewComments || onlyAddsCanvasReviewMarkup;
    let onlyUpdatesCommentStatuses = isExistingCommentStatusUpdateRequest(args);
    let onlyReviewerCommentWork =
      onlyAddsReviewerFeedback || onlyUpdatesCommentStatuses;

    const commentRequestEmail =
      onlyReviewerCommentWork && !isAnonymousPublicViewer(requesterEmail)
        ? resolvePlanOwnerEmailForWrite(requesterEmail)
        : requesterEmail;

    if (onlyReviewerCommentWork) {
      // Commenting on a plan (including a public-link plan) requires an
      // agent-native account. The two synthetic anonymous identities must NOT be
      // able to comment — only a real account (or the local single-user identity
      // in local mode) can:
      //   - Anonymous public-link viewers (`public-*@agent-native.local`, minted
      //     by resolvePublicPlanViewerOwner) can read a public plan but not
      //     comment.
      //   - Legacy hosted guest authors (`guest-*@agent-native.guest`) cannot
      //     comment; create/update authoring now requires a real account.
      // This keeps "anyone with the link can view; accounts can create, comment,
      // and share".
      if (isAnonymousPublicViewer(requesterEmail)) {
        throw new ForbiddenError(
          "Commenting on a plan requires an agent-native account. Sign in to leave a comment.",
        );
      }
      if (isGuestAuthorIdentity(requesterEmail)) {
        throw new ForbiddenError(
          "Commenting requires an account. Sign in to comment.",
        );
      }
      if (!commentRequestEmail) {
        throw new ForbiddenError(
          "Commenting on a plan requires an agent-native account. Sign in to leave a comment.",
        );
      }
      const access = await resolveAccess(
        "plan",
        args.planId,
        resolvePlanAccessContext(currentAccess()),
      );
      if (!access) throw new Error(`Plan ${args.planId} not found`);
    } else {
      await assertPlanEditor(args.planId);
    }

    const db = getDb();
    const now = nowIso();
    const insertedCommentIds: string[] = [];
    let nextContent =
      args.content !== undefined ? normalizePlanContent(args.content) : null;
    let versionAtLoad: string | null = null;
    let bundleAtLoad: Awaited<ReturnType<typeof loadPlanBundle>> | null = null;
    if (args.content === undefined && args.contentPatches.length > 0) {
      const bundle = await loadPlanBundle(args.planId);
      bundleAtLoad = bundle;
      versionAtLoad = bundle.plan.updatedAt;
      if (!bundle.plan.content) {
        throw new Error(
          "Targeted content patches require a structured plan. Pass content for a full conversion, or html for legacy artifacts.",
        );
      }
      nextContent = applyPlanContentPatches(
        bundle.plan.content,
        args.contentPatches,
      );
    }
    const sourceBundleForMarkdown =
      nextContent && args.markdown === undefined
        ? (bundleAtLoad ?? (await loadPlanBundle(args.planId)))
        : null;
    const markdownFromContent =
      nextContent && sourceBundleForMarkdown
        ? (
            await exportPlanContentToMdxFolder({
              content: nextContent,
              title:
                args.title ??
                nextContent.title ??
                sourceBundleForMarkdown.plan.title,
              brief:
                args.brief ??
                nextContent.brief ??
                sourceBundleForMarkdown.plan.brief,
              planId: args.planId,
              url: planPath(args.planId),
            })
          )["plan.mdx"]
        : null;
    const planPatch = {
      ...(args.title ? { title: args.title } : {}),
      ...(args.brief ? { brief: args.brief } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.currentFocus ? { currentFocus: args.currentFocus } : {}),
      ...(args.html !== undefined ? { html: args.html } : {}),
      ...(nextContent ? { content: serializePlanContent(nextContent) } : {}),
      ...(args.markdown !== undefined
        ? { markdown: args.markdown }
        : markdownFromContent
          ? { markdown: markdownFromContent }
          : {}),
      ...(args.status === "approved" ? { approvedAt: now } : {}),
      updatedAt: now,
    };

    type CommentInput = (typeof args.comments)[number];
    type ExistingCommentSnapshot = Pick<
      typeof schema.planComments.$inferSelect,
      | "id"
      | "sectionId"
      | "kind"
      | "anchor"
      | "message"
      | "createdBy"
      | "authorEmail"
      | "resolutionTarget"
      | "mentionsJson"
    >;
    const existingCommentUpdates: Array<
      CommentInput & { id: string; existing: ExistingCommentSnapshot }
    > = [];
    const pendingCommentInserts: typeof args.comments = [];
    for (const comment of args.comments) {
      if (comment.id) {
        const [existing] = await db
          .select({
            id: schema.planComments.id,
            sectionId: schema.planComments.sectionId,
            kind: schema.planComments.kind,
            anchor: schema.planComments.anchor,
            message: schema.planComments.message,
            createdBy: schema.planComments.createdBy,
            authorEmail: schema.planComments.authorEmail,
            resolutionTarget: schema.planComments.resolutionTarget,
            mentionsJson: schema.planComments.mentionsJson,
          })
          .from(schema.planComments)
          .where(
            and(
              eq(schema.planComments.id, comment.id),
              eq(schema.planComments.planId, args.planId),
            ),
          );
        if (existing) {
          existingCommentUpdates.push({
            ...comment,
            id: comment.id,
            existing,
          });
          continue;
        }
      }
      pendingCommentInserts.push(comment);
    }
    if (onlyUpdatesCommentStatuses && pendingCommentInserts.length > 0) {
      throw new Error("Comment status update target was not found.");
    }
    if (
      onlyUpdatesCommentStatuses &&
      !existingCommentUpdates.every((comment) =>
        preservesExistingCommentFields(comment, comment.existing),
      )
    ) {
      onlyUpdatesCommentStatuses = false;
      onlyReviewerCommentWork = onlyAddsReviewerFeedback;
      if (!onlyAddsReviewerFeedback) {
        await assertPlanEditor(args.planId);
      }
    }

    const commentsBeforeInserts =
      pendingCommentInserts.length > 0
        ? (await loadPlanBundle(args.planId)).comments
        : [];
    const commentRows = buildUpdatedPlanCommentRows({
      planId: args.planId,
      comments: pendingCommentInserts,
      existingComments: commentsBeforeInserts,
      requestEmail: commentRequestEmail,
      requestName: requesterName,
      now,
    });
    const reviewEventPayload = {
      titleChanged: args.title !== undefined,
      briefChanged: args.brief !== undefined,
      statusChangedTo: args.status ?? null,
      currentFocusChanged: args.currentFocus !== undefined,
      htmlChanged: args.html !== undefined,
      markdownChanged:
        args.markdown !== undefined || Boolean(markdownFromContent),
      contentReplaced: args.content !== undefined,
      contentPatchOps: args.contentPatches.map((patch) => patch.op),
      contentPatchDetails: contentPatchDetails({
        before: bundleAtLoad?.plan.content ?? null,
        after: nextContent,
        patches: args.contentPatches,
      }),
      sectionCount: args.sections.length,
      existingCommentIdsUpdated: existingCommentUpdates.map(
        (comment) => comment.id,
      ),
      insertedCommentIds: commentRows.map((comment) => comment.id),
      consumedCommentIds: args.consumedCommentIds,
      note: args.note ?? null,
    };
    const hasPlanAuthoringChanges =
      args.title !== undefined ||
      args.brief !== undefined ||
      args.status !== undefined ||
      args.currentFocus !== undefined ||
      args.html !== undefined ||
      args.content !== undefined ||
      args.contentPatches.length > 0 ||
      args.markdown !== undefined ||
      args.sections.length > 0;
    if (!onlyReviewerCommentWork && hasPlanAuthoringChanges) {
      await createPlanVersionSnapshot(args.planId, {
        force: true,
        label: args.note ?? "Before plan update",
        createdBy: "agent",
      });
    }

    // The local better-sqlite3 driver rejects async transaction callbacks
    // ("Transaction function cannot return a promise"), so the multi-statement
    // write runs sequentially rather than inside `db.transaction`. The leading
    // optimistic-lock UPDATE still guards concurrent writes; the libsql (prod)
    // driver executes these awaits identically. (A driver-aware atomic helper is
    // the proper long-term fix.)
    await (async (tx: typeof db) => {
      // guard:allow-unscoped -- gated above by editor access, or by public
      // viewer access plus new-open-human-comment / canvas-review-markup validation.
      const updatedRows = await tx
        .update(schema.plans)
        .set(planPatch)
        .where(
          versionAtLoad
            ? and(
                eq(schema.plans.id, args.planId),
                eq(schema.plans.updatedAt, versionAtLoad),
              )
            : eq(schema.plans.id, args.planId),
        )
        .returning({ id: schema.plans.id });

      if (updatedRows.length === 0) {
        throw new Error(
          "Plan changed while content patches were being applied. Reload the plan and retry your patch.",
        );
      }

      for (const [index, section] of args.sections.entries()) {
        const id = section.id ?? newId("sec");
        if (section.id) {
          const [existing] = await tx
            .select({ id: schema.planSections.id })
            .from(schema.planSections)
            .where(
              and(
                eq(schema.planSections.id, section.id),
                eq(schema.planSections.planId, args.planId),
              ),
            );
          if (existing) {
            await tx
              .update(schema.planSections)
              .set({
                type: section.type,
                title: section.title,
                body: section.body,
                html: section.html ?? null,
                order: section.order ?? index,
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.planSections.id, section.id),
                  eq(schema.planSections.planId, args.planId),
                ),
              );
            continue;
          }
        }
        await tx.insert(schema.planSections).values({
          id,
          planId: args.planId,
          type: section.type,
          title: section.title,
          body: section.body,
          html: section.html ?? null,
          order: section.order ?? index,
          createdBy: section.createdBy,
          createdAt: now,
          updatedAt: now,
        });
      }

      for (const comment of existingCommentUpdates) {
        const metadata = onlyUpdatesCommentStatuses
          ? null
          : commentMetadataForInput(comment);
        const resolution = commentResolutionFields({
          status: comment.status,
          createdBy: onlyUpdatesCommentStatuses
            ? comment.existing.createdBy
            : comment.createdBy,
          authorEmail: onlyUpdatesCommentStatuses
            ? comment.existing.authorEmail
            : comment.authorEmail,
          requestEmail: commentRequestEmail,
          now,
        });
        await tx
          .update(schema.planComments)
          .set(
            onlyUpdatesCommentStatuses
              ? {
                  sectionId: comment.existing.sectionId,
                  kind: comment.existing.kind,
                  status: comment.status,
                  anchor: comment.existing.anchor,
                  message: comment.existing.message,
                  resolutionTarget: comment.existing.resolutionTarget,
                  mentionsJson: comment.existing.mentionsJson,
                  resolvedBy: resolution.resolvedBy,
                  resolvedAt: resolution.resolvedAt,
                  updatedAt: now,
                }
              : {
                  sectionId: comment.sectionId ?? null,
                  kind: comment.kind,
                  status: comment.status,
                  anchor: metadata?.anchor,
                  message: comment.message,
                  resolutionTarget: metadata?.resolutionTarget,
                  mentionsJson: metadata?.mentionsJson,
                  resolvedBy: comment.resolvedBy ?? resolution.resolvedBy,
                  resolvedAt: comment.resolvedAt ?? resolution.resolvedAt,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(schema.planComments.id, comment.id),
              eq(schema.planComments.planId, args.planId),
            ),
          );
      }

      for (const row of commentRows) {
        await tx.insert(schema.planComments).values(row);
        insertedCommentIds.push(row.id);
      }

      if (args.consumedCommentIds.length > 0) {
        await tx
          .update(schema.planComments)
          .set({ consumedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.planComments.planId, args.planId),
              inArray(schema.planComments.id, args.consumedCommentIds),
            ),
          );
      }

      await tx.insert(schema.planEvents).values({
        id: newId("evt"),
        planId: args.planId,
        type: "plan.updated",
        message:
          !onlyReviewerCommentWork && args.note
            ? args.note
            : `Updated ${args.sections.length} section(s), ${args.comments.length} comment(s).`,
        payload: JSON.stringify(reviewEventPayload),
        createdBy: onlyReviewerCommentWork ? "human" : "agent",
        createdAt: now,
      });
    })(db);
    const bundle = await loadPlanBundle(args.planId);
    await notifyPlanCommentRecipients({
      bundle,
      insertedCommentIds,
      priorComments: commentsBeforeInserts,
    }).catch((error) => {
      console.warn("[update-visual-plan] comment notification failed:", error);
    });
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: bundle.plan.id,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          content: bundle.plan.content,
          url: `/plans/${encodeURIComponent(bundle.plan.id)}`,
        })
      : null;
    return {
      ...bundle,
      planId: bundle.plan.id,
      html: buildPlanHtml(bundle),
      ...(local?.written ? { localFiles: local } : {}),
    };
  },
});
