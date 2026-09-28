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
  roleSatisfies,
} from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
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
  agentPlanIncrementalContentPatchesSchema,
  applyPlanContentPatches,
  findBlock,
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

function contentPatchTargetId(patch: PlanContentPatch) {
  if ("blockId" in patch) return patch.blockId;
  if ("screenId" in patch) return patch.screenId;
  if (patch.op === "set-metadata") return "plan-metadata";
  if (patch.op === "set-visual-render-mode") return "visual-render-mode";
  if (patch.op === "set-prototype" || patch.op === "remove-prototype") {
    return "prototype";
  }
  if (patch.op === "update-canvas-frame") return patch.frameId;
  if (patch.op === "update-canvas-annotation") return patch.annotationId;
  if (patch.op === "append-canvas-annotation") return patch.annotation.id;
  if (patch.op === "append-block") return patch.block.id;
  return null;
}

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

function collectPlanBlockIds(blocks: PlanBlock[], ids = new Set<string>()) {
  for (const block of blocks) {
    ids.add(block.id);
    if (block.type === "tabs") {
      for (const tab of block.data.tabs) {
        collectPlanBlockIds(tab.blocks, ids);
      }
    }
  }
  return ids;
}

function destructiveStructuredReplacementWarnings(
  before: PlanContent,
  after: PlanContent,
) {
  const afterBlockIds = collectPlanBlockIds(after.blocks);
  const removedBlockIds = Array.from(collectPlanBlockIds(before.blocks)).filter(
    (id) => !afterBlockIds.has(id),
  );
  const warnings: string[] = [];
  if (removedBlockIds.length > 0) {
    const excerpt = removedBlockIds.slice(0, 8).join(", ");
    const remaining = removedBlockIds.length - 8;
    warnings.push(
      `remove ${removedBlockIds.length} existing block ID${removedBlockIds.length === 1 ? "" : "s"} (${excerpt}${remaining > 0 ? `, and ${remaining} more` : ""})`,
    );
  }
  if (
    (before.canvas?.frames.length ?? 0) > 0 &&
    (after.canvas?.frames.length ?? 0) === 0
  ) {
    warnings.push("collapse a nonempty canvas to zero frames");
  }
  if (
    (before.prototype?.screens.length ?? 0) > 0 &&
    (after.prototype?.screens.length ?? 0) === 0
  ) {
    warnings.push("collapse a nonempty prototype to zero screens");
  }
  return warnings;
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
        ? findBlock(input.before.blocks, patch.blockId)
        : null;
    const afterBlock =
      "blockId" in patch && input.after
        ? findBlock(input.after.blocks, patch.blockId)
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

function canvasSurfaceProjection(content: PlanContent) {
  return (content.canvas?.frames ?? []).flatMap((frame) => {
    const referencedBlock = frame.blockId
      ? findBlock(content.blocks, frame.blockId)
      : null;
    const wireframe =
      frame.wireframe ??
      (referencedBlock?.type === "wireframe" ? referencedBlock.data : null);
    const legacyWireframe =
      frame.legacyWireframe ??
      (referencedBlock?.type === "legacy-wireframe"
        ? referencedBlock.data
        : null);
    if (!wireframe && !legacyWireframe) return [];
    return {
      label: frame.label ?? referencedBlock?.title ?? null,
      surface:
        frame.surface ??
        wireframe?.surface ??
        (legacyWireframe?.viewport === "phone" ? "mobile" : undefined) ??
        "desktop",
      wireframe,
      legacyWireframe,
    };
  });
}

function surfaceParityWarnings(
  before: PlanContent | null,
  after: PlanContent | null,
) {
  const beforeProjection = before ? canvasSurfaceProjection(before) : [];
  const afterProjection = after ? canvasSurfaceProjection(after) : [];
  if (beforeProjection.length === 0 && afterProjection.length === 0) {
    return [];
  }
  const prototypeChanged =
    JSON.stringify(before?.prototype) !== JSON.stringify(after?.prototype);
  if (
    !prototypeChanged ||
    JSON.stringify(beforeProjection) !== JSON.stringify(afterProjection)
  ) {
    return [];
  }
  return [
    "This update changes the prototype while leaving the visible canvas unchanged. Patch the matching canvas frame(s) too, or pass allowSurfaceMismatch: true only for an intentional single-surface edit.",
  ];
}

const CONTENT_DESCRIPTION =
  "Destructive full structured content replacement. Read the latest plan first and pass its updatedAt as expectedUpdatedAt. Prefer granular contentPatches for ordinary edits; use this only for intentional broad restructuring.";
const CONTENT_PATCHES_DESCRIPTION =
  "Targeted structured content edits addressed by stable id. Prefer granular operations for live plans. The destructive replace-blocks operation requires expectedUpdatedAt from a fresh read. patch-visual-plan-source is only for exported MDX folders. Supported ops: set-metadata for title/brief; set-visual-render-mode to persist `design` (high fidelity, authored CSS, no rough.js for any viewer) or `wireframe` across canvas, linked blocks, and prototype screens; set-prototype / remove-prototype / update-prototype-screen / patch-prototype-html for live prototype surfaces; update-block / replace-block, update-rich-text, patch-wireframe-html, patch-diagram-html, update-wireframe-node, replace-wireframe-screen, update-canvas-frame, update-canvas-annotation / append-canvas-annotation, append-block / remove-block, update-custom-html. A fidelity upgrade must also replace or patch the existing screen HTML/CSS with deliberate branded design; changing render mode alone only removes the sketch treatment.";

function compactAgentWriteResult(
  bundle: Awaited<ReturnType<typeof loadPlanBundle>>,
  changed: Record<string, unknown>,
) {
  return {
    planId: bundle.plan.id,
    plan: {
      id: bundle.plan.id,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      kind: bundle.plan.kind,
      status: bundle.plan.status,
      currentFocus: bundle.plan.currentFocus,
      updatedAt: bundle.plan.updatedAt,
      surfaces: {
        blocks: bundle.plan.content?.blocks.length ?? 0,
        canvasFrames: bundle.plan.content?.canvas?.frames.length ?? 0,
        prototypeScreens: bundle.plan.content?.prototype?.screens.length ?? 0,
      },
    },
    changed,
    path: planPath(bundle.plan.id, bundle.plan.kind),
    url: planPath(bundle.plan.id, bundle.plan.kind),
  };
}

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
  expectedUpdatedAt: z
    .string()
    .optional()
    .describe(
      "Required optimistic-concurrency base revision for full content replacement and replace-blocks. Read the latest plan, copy plan.updatedAt exactly, and do not reuse a revision after another write succeeds. Granular patches do not require it.",
    ),
  allowDestructive: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Explicit confirmation for a full content replacement or replace-blocks call that removes existing block IDs, collapses a nonempty canvas to zero frames, or collapses a nonempty prototype to zero screens. Keep false for normal rewrites. Set true only after reviewing the latest plan and intentionally accepting those losses; expectedUpdatedAt is still required.",
    ),
  allowSurfaceMismatch: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Explicit confirmation for an intentional single-surface prototype edit when a visible canvas also exists. Keep false for normal UI revisions so stale canvas content is rejected before writing.",
    ),
  html: z
    .string()
    .optional()
    .describe(
      "Legacy-only standalone HTML. Allowed only while the current plan has no structured content. Structured plans reject this field because it would shadow blocks, inline editing, and MDX round-trip. Never use it for new plans.",
    ),
  content: planContentSchema.optional().describe(CONTENT_DESCRIPTION),
  contentPatches: planContentPatchesSchema
    .optional()
    .default([])
    .describe(CONTENT_PATCHES_DESCRIPTION),
  markdown: z
    .string()
    .optional()
    .describe(
      "Legacy-only markdown source. Allowed only while the current plan has no structured content. Structured plans reject explicit markdown, including calls that also carry contentPatches; structured edits generate their MDX projection automatically.",
    ),
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
      "Legacy comment array. Comment messages support inline Markdown for emphasis, inline code, links, and line breaks; headings are flattened. Prefer reply-to-plan-comment / resolve-plan-comment for new comments.",
    ),
  consumedCommentIds: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Prefer consume-plan-feedback for marking feedback consumed. WARNING: consuming feedback does not resolve or hide its comments; after the requested change is verified, resolve handled comments with resolve-plan-comment.",
    ),
  note: z
    .string()
    .optional()
    .describe("Short label saved as the version-history snapshot label."),
});

const agentUpdateVisualPlanSchema = updateVisualPlanSchema
  .omit({ content: true, html: true, markdown: true, sections: true })
  .extend({
    contentPatches: agentPlanIncrementalContentPatchesSchema
      .optional()
      .default([])
      .describe(
        "Small targeted edits only. Do not send full content or replace-blocks; " +
          "append or patch one existing block at a time.",
      ),
  });

export default defineAction({
  description:
    "Update an Agent-Native Plan's structured content blocks, prototype screens, visual fidelity, sections, comments, or status. For an existing plan, use small contentPatches such as append-block, update-rich-text, or a text patch; do not resend the full document for an incremental edit. When a user asks for higher fidelity on an existing plan, update that same plan in place: use set-visual-render-mode with design and provide polished screen HTML/CSS in the same call instead of creating a duplicate plan or only toggling the viewer-local clean style. Use a full replacement only for an explicit broad rebuild. Works on plans and recaps alike when you have editor access; with viewer access (common on PR recaps published by CI) only comment-only calls succeed - to change a recap you cannot edit, publish a replacement with create-visual-recap instead of retrying this call.",
  schema: updateVisualPlanSchema,
  agentInputSchema: agentUpdateVisualPlanSchema,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Update Visual Plan",
    description:
      "Patch structured plan content, add visual sections, record comments, or mark feedback consumed. When canvas and prototype coexist, patch both visible surfaces; mismatches are rejected before writing unless allowSurfaceMismatch is explicitly true.",
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
      if (!roleSatisfies(access.role, "commenter")) {
        throw new ForbiddenError(
          "Commenting on this plan requires commenter access or higher.",
        );
      }
    } else {
      await assertPlanEditor(args.planId);
    }

    const db = getDb();
    const now = nowIso();
    const insertedCommentIds: string[] = [];
    const hasReplaceBlocksPatch = args.contentPatches.some(
      (patch) => patch.op === "replace-blocks",
    );
    const isDestructiveStructuredWrite =
      args.content !== undefined || hasReplaceBlocksPatch;
    let nextContent =
      args.content !== undefined ? normalizePlanContent(args.content) : null;
    let surfaceWarnings: string[] = [];
    let versionAtLoad: string | null = null;
    let bundleAtLoad: Awaited<ReturnType<typeof loadPlanBundle>> | null = null;

    if (
      args.status !== undefined ||
      args.content !== undefined ||
      args.contentPatches.length > 0 ||
      args.html !== undefined ||
      args.markdown !== undefined
    ) {
      bundleAtLoad = await loadPlanBundle(args.planId);
      versionAtLoad = bundleAtLoad.plan.updatedAt;
    }

    if (
      bundleAtLoad?.plan.content &&
      (args.html !== undefined || args.markdown !== undefined)
    ) {
      const legacyFields = [
        args.html !== undefined ? "html" : null,
        args.markdown !== undefined ? "markdown" : null,
      ].filter((field): field is string => Boolean(field));
      throw new Error(
        `Structured plans do not accept explicit legacy ${legacyFields.join(" or ")} writes. Use granular contentPatches; the structured content's markdown projection is generated automatically.`,
      );
    }

    if (isDestructiveStructuredWrite) {
      if (!args.expectedUpdatedAt) {
        throw new Error(
          "expectedUpdatedAt is required for full content replacement and replace-blocks. Read the latest plan, pass its plan.updatedAt, and retry.",
        );
      }
      if (bundleAtLoad?.plan.updatedAt !== args.expectedUpdatedAt) {
        throw new Error(
          "This destructive update was prepared from an outdated plan revision. Reload the plan and retry with the latest expectedUpdatedAt.",
        );
      }
      versionAtLoad = args.expectedUpdatedAt;
    }

    if (args.content === undefined && args.contentPatches.length > 0) {
      if (!bundleAtLoad?.plan.content) {
        throw new Error(
          "Targeted content patches require a structured plan. Pass content for a full conversion, or html for legacy artifacts.",
        );
      }
      nextContent = applyPlanContentPatches(
        bundleAtLoad.plan.content,
        args.contentPatches,
      );
    }
    const normalizedContentAtLoad = bundleAtLoad?.plan.content
      ? planContentSchema.parse(bundleAtLoad.plan.content)
      : null;
    if (
      isDestructiveStructuredWrite &&
      !args.allowDestructive &&
      bundleAtLoad?.plan.content &&
      nextContent
    ) {
      const warnings = destructiveStructuredReplacementWarnings(
        bundleAtLoad.plan.content,
        nextContent,
      );
      if (warnings.length > 0) {
        throw new Error(
          `Destructive structured replacement would ${warnings.join(" and ")}. Reload and review the latest plan, then pass allowDestructive: true with its expectedUpdatedAt only if those losses are intentional.`,
        );
      }
    }
    surfaceWarnings = nextContent
      ? surfaceParityWarnings(normalizedContentAtLoad, nextContent)
      : [];
    if (surfaceWarnings.length > 0 && !args.allowSurfaceMismatch) {
      throw new Error(surfaceWarnings.join(" "));
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
    const contentChanged =
      nextContent !== null &&
      JSON.stringify(nextContent) !== JSON.stringify(normalizedContentAtLoad);
    const contentPatchChanged =
      args.contentPatches.length > 0 &&
      (contentChanged ||
        (nextTitle !== undefined && nextTitle !== bundleAtLoad?.plan.title) ||
        (nextBrief !== undefined && nextBrief !== bundleAtLoad?.plan.brief));
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
      (args.content !== undefined && contentChanged) ||
      contentPatchChanged ||
      args.markdown !== undefined ||
      args.sections.length > 0;
    const hasPersistedPlanChanges =
      hasPlanAuthoringChanges ||
      pendingCommentInserts.length > 0 ||
      existingCommentUpdates.length > 0 ||
      args.consumedCommentIds.length > 0;
    const diffCount =
      args.contentPatches.length +
      args.sections.length +
      [
        args.title,
        args.brief,
        args.status,
        args.currentFocus,
        args.html,
        args.content,
        args.markdown,
      ].filter((value) => value !== undefined).length;
    if (!onlyReviewerCommentWork && hasPlanAuthoringChanges) {
      await createPlanVersionSnapshot(args.planId, {
        force: true,
        label: args.note ?? "Before plan update",
        createdBy: "agent",
      });
    }

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

      if (hasPersistedPlanChanges) {
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
      }
    });

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
    if (hasPlanAuthoringChanges) {
      track(
        "plan_updated",
        {
          app_name: "plan",
          template_name: "plan",
          output_id: bundle.plan.id,
          output_type: bundle.plan.kind,
          diff_count: diffCount,
        },
        ctx,
      );
    }
    await notifyPlanCommentRecipients({
      bundle,
      insertedCommentIds,
      priorComments: commentsBeforeInserts,
    }).catch((error) => {
      console.warn("[update-visual-plan] comment notification failed:", error);
    });
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
    if (
      args.status &&
      bundleAtLoad?.plan.status !== undefined &&
      args.status !== bundleAtLoad.plan.status
    ) {
      emitPlanStatusChanged({
        planId: bundle.plan.id,
        title: bundle.plan.title,
        kind: bundle.plan.kind,
        oldStatus: bundleAtLoad.plan.status,
        newStatus: bundle.plan.status,
        changedBy: requesterEmail,
        ownerEmail: bundle.access.ownerEmail,
      });
    }
    const local = isLocalPlanRuntime()
      ? hasPersistedPlanChanges
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
        : null
      : null;
    if (isAgentCaller) {
      return {
        ...compactAgentWriteResult(bundle, {
          titleChanged: args.title !== undefined,
          briefChanged: args.brief !== undefined,
          statusChanged: args.status !== undefined,
          contentPatchOps: args.contentPatches.map((patch) => patch.op),
          commentCount: insertedCommentIds.length,
          ...(surfaceWarnings.length > 0 ? { warnings: surfaceWarnings } : {}),
        }),
        ...(local?.written ? { localFiles: local } : {}),
      };
    }
    return {
      ...bundle,
      planId: bundle.plan.id,
      html: buildPlanHtml(bundle),
      ...(local?.written ? { localFiles: local } : {}),
    };
  },
});
