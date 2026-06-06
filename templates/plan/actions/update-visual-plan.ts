import { defineAction } from "@agent-native/core";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
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
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
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
} from "../shared/plan-content.js";

export default defineAction({
  description:
    "Update an Agent-Native Plan's structured content blocks, sections, comments, or status. Prefer contentPatches for targeted edits such as copy changes, one element/text/color inside an html mockup via patch-wireframe-html, one legacy wireframe kit-tree node, a whole wireframe, one canvas frame, one canvas annotation, one block append/remove, or one custom HTML fragment. Use full content only for broad restructuring; HTML updates are legacy import compatibility only.",
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
        "Targeted structured content edits addressed by stable id. Prefer these for small changes: update-block / replace-block, update-rich-text, patch-wireframe-html (change one element/text/color inside an html mockup via find/replace edits — read the current html first with get-visual-plan), update-wireframe-node (one legacy kit-tree node), replace-wireframe-screen, update-canvas-frame, update-canvas-annotation / append-canvas-annotation, append-block / remove-block, or update-custom-html. Any agent (Claude, Codex, Cursor) can patch a single mockup or node without regenerating the plan. The renderer owns all visual styling; emit lean content, not pixels — never supply geometry or coordinates.",
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
      args.comments.every(
        (comment) =>
          !comment.id &&
          comment.status === "open" &&
          comment.createdBy === "human",
      );

    const commentRequestEmail =
      onlyAddsNewComments && !isAnonymousPublicViewer(requesterEmail)
        ? resolvePlanOwnerEmailForWrite(requesterEmail)
        : requesterEmail;

    if (onlyAddsNewComments) {
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
      const access = await resolveAccess("plan", args.planId);
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
    const existingCommentUpdates: Array<CommentInput & { id: string }> = [];
    const pendingCommentInserts: typeof args.comments = [];
    for (const comment of args.comments) {
      if (comment.id) {
        const [existing] = await db
          .select({ id: schema.planComments.id })
          .from(schema.planComments)
          .where(
            and(
              eq(schema.planComments.id, comment.id),
              eq(schema.planComments.planId, args.planId),
            ),
          );
        if (existing) {
          existingCommentUpdates.push({ ...comment, id: comment.id });
          continue;
        }
      }
      pendingCommentInserts.push(comment);
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

    await db.transaction(async (tx) => {
      // guard:allow-unscoped -- gated above by editor access, or by public
      // viewer access plus new-open-human-comment-only validation.
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
        await tx
          .update(schema.planComments)
          .set({
            sectionId: comment.sectionId ?? null,
            kind: comment.kind,
            status: comment.status,
            anchor: comment.anchor ?? null,
            message: comment.message,
            updatedAt: now,
          })
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
          !onlyAddsNewComments && args.note
            ? args.note
            : `Updated ${args.sections.length} section(s), ${args.comments.length} comment(s).`,
        payload: null,
        createdBy: onlyAddsNewComments ? "human" : "agent",
        createdAt: now,
      });
    });
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
