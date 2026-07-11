import { defineAction, embedApp } from "@agent-native/core";
import { agentTouchDocument } from "@agent-native/core/collab";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyPlanCommentRecipients } from "../server/lib/comment-notifications.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  isLocalPlanRuntime,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import { createPlanVersionSnapshot } from "../server/lib/plan-versions.js";
import {
  normalizePlanContent,
  sanitizeStoredPlanHtml,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  referencedBlockIdsForPlanComments,
} from "../server/plan-mdx.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  buildUpdatedPlanCommentRows,
  commentInputSchema,
  commentMetadataForInput,
  commentResolutionFields,
  emitPlanCommented,
  emitPlanStatusChanged,
  loadPlanBundle,
  newId,
  nowIso,
  planPath,
  planStatusSchema,
  sectionInputSchema,
} from "../server/plans.js";
import {
  agentPlanContentPatchesSchema,
  agentPlanContentSchema,
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
  if (patch.op === "set-metadata") return "plan-metadata";
  if (patch.op === "set-prototype" || patch.op === "remove-prototype") {
    return "prototype";
  }
  if (patch.op === "update-canvas-frame") return patch.frameId;
  if (patch.op === "update-canvas-annotation") return patch.annotationId;
  if (patch.op === "append-canvas-annotation") return patch.annotation.id;
  if (patch.op === "append-block") return patch.block.id;
  return null;
}

/**
 * Real block ids an agent content edit touched, for the plan-presence recent-edit
 * highlight (`{ kind: "paths", paths }`). Prefers per-patch targets; for a
 * whole-content or `replace-blocks` rewrite it falls back to the resulting
 * top-level block ids. Deduped, capped so the awareness payload stays small.
 */
function affectedPlanBlockIds(
  patches: PlanContentPatch[],
  nextContent: PlanContent | null,
): string[] {
  const ids = new Set<string>();
  for (const patch of patches) {
    if (patch.op === "replace-blocks") {
      for (const block of patch.blocks) ids.add(block.id);
      continue;
    }
    const target = contentPatchTargetId(patch);
    if (target) ids.add(target);
  }
  if (ids.size === 0 && nextContent) {
    for (const block of nextContent.blocks) ids.add(block.id);
  }
  return Array.from(ids).slice(0, 12);
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

const CONTENT_DESCRIPTION =
  "Full structured content replacement. Prefer contentPatches for targeted edits; use this only for broad restructuring.";
const CONTENT_PATCHES_DESCRIPTION =
  "Targeted structured content edits addressed by stable id. For live plans this is the preferred edit path; patch-visual-plan-source is only for exported MDX folders. Supported ops: set-metadata for title/brief, set-prototype / remove-prototype / update-prototype-screen / patch-prototype-html for live prototype surfaces; update-block / replace-block, update-rich-text, patch-wireframe-html, patch-diagram-html, update-wireframe-node, replace-wireframe-screen, update-canvas-frame, update-canvas-annotation / append-canvas-annotation, append-block / remove-block, update-custom-html.";

// Named so `agentInputSchema` below can `.extend()` it with compact
// `content`/`contentPatches` fields instead of duplicating every other key.
const updateVisualPlanSchema = z.object({
  planId: z.string().describe("Plan ID"),
  title: z.string().optional().describe("Plan title."),
  brief: z
    .string()
    .optional()
    .describe("One-line plan summary shown under the title."),
  status: planStatusSchema
    .optional()
    .describe(
      'Plan status. Setting "approved" also records approvedAt timestamp.',
    ),
  currentFocus: z
    .string()
    .optional()
    .describe("Current agent focus label shown in the review surface."),
  html: z
    .string()
    .optional()
    .describe(
      "Legacy: a standalone HTML document. Setting this NULLS structured content — blocks, contentPatches, inline editing, and MDX round-trip all stop working for this plan. Only for preserving a pre-existing HTML artifact; never author new plans this way.",
    ),
  content: planContentSchema.optional().describe(CONTENT_DESCRIPTION),
  contentPatches: planContentPatchesSchema
    .optional()
    .default([])
    .describe(CONTENT_PATCHES_DESCRIPTION),
  markdown: z
    .string()
    .optional()
    .describe("Legacy markdown source. Prefer content blocks."),
  sections: z
    .array(sectionInputSchema)
    .optional()
    .default([])
    .describe("Legacy section array. Prefer content blocks."),
  comments: z
    .array(commentInputSchema)
    .optional()
    .default([])
    .describe(
      "Legacy comment array. Prefer reply-to-plan-comment / resolve-plan-comment for new comments.",
    ),
  consumedCommentIds: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Prefer consume-plan-feedback for marking feedback consumed."),
  note: z
    .string()
    .optional()
    .describe("Short label saved as the version-history snapshot label."),
});

export default defineAction({
  description:
    "Update an Agent-Native Plan's structured content blocks, prototype screens, sections, comments, or status. Prefer contentPatches for targeted edits. Use full content only for broad restructuring. Works on plans and recaps alike when you have editor access; with viewer access (common on PR recaps published by CI) only comment-only calls succeed — to change a recap you cannot edit, publish a replacement with create-visual-recap instead of retrying this call.",
  schema: updateVisualPlanSchema,
  // ADVERTISED-ONLY: same top-level shape, but `content`/`contentPatches`
  // swap the deep per-block-type union for a compact `type`-enum stand-in.
  // Runtime validation always runs the full schema above — see the `actions`
  // skill.
  agentInputSchema: updateVisualPlanSchema.extend({
    content: agentPlanContentSchema.optional().describe(CONTENT_DESCRIPTION),
    contentPatches: agentPlanContentPatchesSchema
      .optional()
      .default([])
      .describe(CONTENT_PATCHES_DESCRIPTION),
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
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Update Plan",
      description:
        "Open the Agent-Native Plan editor for structured content, comments, and status changes.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plan",
      height: 900,
    }),
  },
  run: async (args, ctx) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    // Only surface AI presence for genuine agent invocations (in-app tool loop /
    // A2A → "tool"; external MCP agents → "mcp"). The browser editor autosaves
    // through this same action as "frontend" and must NOT light the agent flag.
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";
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
      if ((access.resource as typeof schema.plans.$inferSelect).deletedAt) {
        throw new ForbiddenError(`Plan ${args.planId} not found`);
      }
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
              url: planPath(args.planId, sourceBundleForMarkdown.plan.kind),
              referencedBlockIds: referencedBlockIdsForPlanComments(
                sourceBundleForMarkdown.comments,
              ),
            })
          )["plan.mdx"]
        : null;
    const metadataPatch = args.contentPatches.find(
      (patch) => patch.op === "set-metadata",
    );
    const nextTitle = args.title ?? metadataPatch?.title;
    const nextBrief = args.brief ?? metadataPatch?.brief;
    const planPatch = {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(nextBrief !== undefined ? { brief: nextBrief } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.currentFocus ? { currentFocus: args.currentFocus } : {}),
      ...(args.html !== undefined
        ? { html: args.html != null ? sanitizeStoredPlanHtml(args.html) : null }
        : {}),
      ...(nextContent ? { content: serializePlanContent(nextContent) } : {}),
      ...(args.markdown !== undefined
        ? { markdown: args.markdown }
        : markdownFromContent
          ? { markdown: markdownFromContent }
          : {}),
      ...(args.status === "approved"
        ? { approvedAt: now }
        : args.status
          ? { approvedAt: null }
          : {}),
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
              isNull(schema.planComments.deletedAt),
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
      // A client-minted id with status "open" is a new insert, not a missing
      // resolve target. Only throw when the caller tried to close/reopen a
      // comment that does not exist in the DB.
      if (pendingCommentInserts.some((c) => c.status !== "open")) {
        throw new Error("Comment status update target was not found.");
      }
      onlyUpdatesCommentStatuses = false;
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

    const bundleForCommentInserts =
      pendingCommentInserts.length > 0
        ? await loadPlanBundle(args.planId)
        : null;
    const commentsBeforeInserts = bundleForCommentInserts?.comments ?? [];

    // Validate that any sectionId referenced by a new comment actually exists on
    // this plan. A bogus or cross-plan sectionId would silently store a dangling
    // FK; reject early with a clear message instead.
    if (bundleForCommentInserts) {
      const validSectionIds = new Set(
        (bundleForCommentInserts.sections ?? []).map((s) => s.id),
      );
      for (const comment of pendingCommentInserts) {
        if (comment.sectionId && !validSectionIds.has(comment.sectionId)) {
          throw new Error(
            `Section ${comment.sectionId} was not found on plan ${args.planId}.`,
          );
        }
      }
    }

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

    // Async transactions are safe on every driver here: better-sqlite3's
    // normally-sync-only transaction() is patched to support async callbacks
    // in packages/core/src/db/create-get-db.ts (patchBetterSqliteTransactions,
    // wired into createGetDb for local sqlite urls), matching libsql/Postgres.
    // See restore-plan-version.ts for the same pattern. The leading
    // optimistic-lock UPDATE still guards concurrent writes; a thrown error
    // (e.g. the zero-rows-affected conflict below) rolls back the whole block.
    await db.transaction(async (tx) => {
      // guard:allow-unscoped -- gated above by editor access, or by public
      // viewer access plus new-open-human-comment / canvas-review-markup validation.
      //
      // Skip the plans row UPDATE entirely when there are no plan-authoring
      // changes (pure comments and/or consumedCommentIds). This prevents
      // comment activity from bumping plans.updatedAt, which would:
      //   1. break a concurrent agent's optimistic-lock check (false "Plan
      //      changed" conflict when the agent read the plan before a reviewer
      //      commented and then posts contentPatches), and
      //   2. reorder the plan list by updatedAt-desc even though no authored
      //      content changed.
      // Comments still propagate to the polling UI because get-visual-plan /
      // loadPlanBundle queries planComments independently (not via plans.updatedAt)
      // and planEvents still gets a row written below.
      if (hasPlanAuthoringChanges) {
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
            "This plan was updated by someone else while your change was being saved. Reload the plan and retry.",
          );
        }
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
                  // Preserve stored anchor/resolutionTarget/mentionsJson when the
                  // caller omits them (e.g. a mixed resolve+consume request that
                  // only carries { id, status, message }). Only overwrite when the
                  // input explicitly provides a value.
                  anchor:
                    comment.anchor !== undefined
                      ? (metadata?.anchor ?? null)
                      : comment.existing.anchor,
                  message: comment.message,
                  resolutionTarget:
                    comment.resolutionTarget !== undefined
                      ? (metadata?.resolutionTarget ?? null)
                      : comment.existing.resolutionTarget,
                  mentionsJson:
                    comment.mentions !== undefined ||
                    comment.anchor !== undefined
                      ? (metadata?.mentionsJson ?? null)
                      : comment.existing.mentionsJson,
                  resolvedBy: comment.resolvedBy ?? resolution.resolvedBy,
                  resolvedAt: comment.resolvedAt ?? resolution.resolvedAt,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(schema.planComments.id, comment.id),
              eq(schema.planComments.planId, args.planId),
              isNull(schema.planComments.deletedAt),
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
              isNull(schema.planComments.deletedAt),
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
    });

    // Make an agent content edit visible on the plan-presence doc: light the AI
    // avatar in the header PresenceBar and glow the patched block(s) for ~6s.
    // Best-effort — never fail the save on presence. Gated to authoring changes
    // and agent callers (a human editor's autosave routes through here too).
    if (isAgentCaller && hasPlanAuthoringChanges) {
      try {
        const blockIds = affectedPlanBlockIds(args.contentPatches, nextContent);
        const ops = args.contentPatches.map((patch) => patch.op);
        const label =
          ops.length > 0
            ? `Edited ${ops.length} block${ops.length === 1 ? "" : "s"}`
            : "Updated plan";
        agentTouchDocument(`plan:${args.planId}`, {
          edit: {
            descriptor: { kind: "paths", paths: blockIds },
            label,
          },
          metadata: { blockIds },
        });
      } catch (error) {
        console.error(
          "[update-visual-plan] agent presence publish failed",
          error,
        );
      }
    }

    const bundle = await loadPlanBundle(args.planId);
    await notifyPlanCommentRecipients({
      bundle,
      insertedCommentIds,
      priorComments: commentsBeforeInserts,
    }).catch((error) => {
      console.warn("[update-visual-plan] comment notification failed:", error);
    });
    // Emit plan.commented for any newly inserted comments
    if (insertedCommentIds.length > 0) {
      const newComments = bundle.comments.filter((c) =>
        insertedCommentIds.includes(c.id),
      );
      emitPlanCommented({
        planId: bundle.plan.id,
        title: bundle.plan.title,
        kind: bundle.plan.kind,
        comments: newComments.map((c) => ({
          id: c.id,
          message: c.message,
          resolutionTarget: c.resolutionTarget,
          authorEmail: c.authorEmail,
          createdBy: c.createdBy,
        })),
        ownerEmail: bundle.access.ownerEmail,
      });
    }
    // Emit plan.status.changed when the status was explicitly changed
    if (args.status) {
      emitPlanStatusChanged({
        planId: bundle.plan.id,
        title: bundle.plan.title,
        kind: bundle.plan.kind,
        oldStatus: null, // status before update is not re-fetched here; use null as unknown-prior
        newStatus: bundle.plan.status,
        changedBy: requesterEmail,
        ownerEmail: bundle.access.ownerEmail,
      });
    }
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: bundle.plan.id,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          content: bundle.plan.content,
          url: planPath(bundle.plan.id, bundle.plan.kind),
          referencedBlockIds: referencedBlockIdsForPlanComments(
            bundle.comments,
          ),
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
