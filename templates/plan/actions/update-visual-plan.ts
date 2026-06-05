import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  normalizePlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  commentInputSchema,
  loadPlanBundle,
  newId,
  nowIso,
  planStatusSchema,
  sectionInputSchema,
  writeEvent,
} from "../server/plans.js";
import {
  applyPlanContentPatches,
  planContentPatchesSchema,
  planContentSchema,
} from "../shared/plan-content.js";

export default defineAction({
  description:
    "Update an Agent-Native Plan's structured content blocks, sections, comments, or status. Prefer contentPatches for targeted edits such as copy changes, one wireframe kit-tree node, a whole wireframe screen, one canvas frame, one canvas annotation, one block append/remove, or one custom HTML fragment. Use full content only for broad restructuring; HTML updates are legacy import compatibility only.",
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
        "Targeted structured content edits addressed by stable id. Prefer these for small changes: update-block / replace-block, update-rich-text, update-wireframe-node (one kit-tree node), replace-wireframe-screen, update-canvas-frame, update-canvas-annotation, append-block / remove-block, or update-custom-html. Any agent (Claude, Codex, Cursor) can patch a single node without regenerating the plan.",
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

    if (onlyAddsNewComments) {
      const access = await resolveAccess("plan", args.planId);
      if (!access) throw new Error(`Plan ${args.planId} not found`);
    } else {
      await assertPlanEditor(args.planId);
    }

    const db = getDb();
    const now = nowIso();
    let nextContent =
      args.content !== undefined ? normalizePlanContent(args.content) : null;
    if (args.content === undefined && args.contentPatches.length > 0) {
      const bundle = await loadPlanBundle(args.planId);
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
    const planPatch = {
      ...(args.title ? { title: args.title } : {}),
      ...(args.brief ? { brief: args.brief } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.currentFocus ? { currentFocus: args.currentFocus } : {}),
      ...(args.html !== undefined ? { html: args.html } : {}),
      ...(nextContent ? { content: serializePlanContent(nextContent) } : {}),
      ...(args.markdown !== undefined ? { markdown: args.markdown } : {}),
      ...(args.status === "approved" ? { approvedAt: now } : {}),
      updatedAt: now,
    };

    // guard:allow-unscoped -- gated above by editor access, or by public
    // viewer access plus new-open-human-comment-only validation.
    await db
      .update(schema.plans)
      .set(planPatch)
      .where(eq(schema.plans.id, args.planId));

    for (const [index, section] of args.sections.entries()) {
      const id = section.id ?? newId("sec");
      if (section.id) {
        const [existing] = await db
          .select({ id: schema.planSections.id })
          .from(schema.planSections)
          .where(
            and(
              eq(schema.planSections.id, section.id),
              eq(schema.planSections.planId, args.planId),
            ),
          );
        if (existing) {
          await db
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
      await db.insert(schema.planSections).values({
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
          await db
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
          continue;
        }
      }
      await db.insert(schema.planComments).values({
        id: comment.id ?? newId("cmt"),
        planId: args.planId,
        sectionId: comment.sectionId ?? null,
        kind: comment.kind,
        status: comment.status,
        anchor: comment.anchor ?? null,
        message: comment.message,
        createdBy: comment.createdBy,
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (args.consumedCommentIds.length > 0) {
      await db
        .update(schema.planComments)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.planComments.planId, args.planId),
            inArray(schema.planComments.id, args.consumedCommentIds),
          ),
        );
    }

    await writeEvent({
      planId: args.planId,
      type: "plan.updated",
      message:
        args.note ||
        `Updated ${args.sections.length} section(s), ${args.comments.length} comment(s).`,
      createdBy: onlyAddsNewComments ? "human" : "agent",
    });
    const bundle = await loadPlanBundle(args.planId);
    return { ...bundle, planId: bundle.plan.id, html: buildPlanHtml(bundle) };
  },
});
