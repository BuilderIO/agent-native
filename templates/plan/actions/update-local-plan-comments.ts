import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getLocalPlanOwnerEmail,
  isLocalPlanRuntime,
} from "../server/lib/local-identity.js";
import { buildLocalPlanBundleResult } from "../server/lib/local-plan-bundle.js";
import {
  readLocalPlanComments,
  readPlanLocalFolder,
  writeLocalPlanComments,
} from "../server/lib/local-plan-files.js";
import {
  buildUpdatedPlanCommentRows,
  commentInputSchema,
  nowIso,
} from "../server/plans.js";
import type { PlanComment, PlanKind } from "../shared/types.js";

export default defineAction({
  description:
    "Add, reply to, resolve, or delete agent-targeted review comments on a DB-free local Agent-Native Plan folder. Comments persist to comments.json beside plan.mdx so they survive a refresh; they are always addressed to the coding agent and never touch the database.",
  schema: z.object({
    slug: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/)
      .describe(
        "Folder name under PLAN_LOCAL_DIR, for example checkout-review.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Optional repo-relative folder path, for example plans/checkout-review.",
      ),
    comments: z
      .array(commentInputSchema)
      .optional()
      .default([])
      .describe(
        "Comments to add (new id) or update by id (status/message). New comments are forced to resolutionTarget 'agent'.",
      ),
    deletedCommentIds: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Comment ids to remove (also removes their replies)."),
  }),
  requiresAuth: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    isConsequential: true,
    title: "Update Local Plan Comments",
    description:
      "Persist agent-targeted review comments to a local MDX plan folder's comments.json without touching the Plan app database.",
  },
  run: async (args) => {
    if (!isLocalPlanRuntime()) {
      throw new Error(
        "Local plan comments are only available in local Plan runtime.",
      );
    }

    const local = await readPlanLocalFolder({
      slug: args.slug,
      path: args.path,
    });
    const planId = `local-${local.slug}`;
    const now = nowIso();
    const requestEmail = getLocalPlanOwnerEmail();
    const existing = await readLocalPlanComments(local.folder);
    const existingById = new Map(
      existing.map((comment) => [comment.id, comment]),
    );

    // New comments (and replies) reuse the hosted row-builder for id minting,
    // thread linkage, and metadata; existing ids fall through to the edit path.
    const inserts = args.comments.filter(
      (comment) => !comment.id || !existingById.has(comment.id),
    );
    const updates = args.comments.filter(
      (comment) => comment.id && existingById.has(comment.id),
    );

    const merged = new Map(existingById);
    const insertedRows = buildUpdatedPlanCommentRows({
      planId,
      comments: inserts,
      existingComments: existing,
      requestEmail,
      now,
    });
    for (const row of insertedRows) {
      // Local comments are always a one-way note to the agent.
      merged.set(row.id, {
        id: row.id,
        planId: row.planId,
        parentCommentId: row.parentCommentId ?? null,
        sectionId: row.sectionId ?? null,
        kind: row.kind,
        status: row.status,
        anchor: row.anchor ?? null,
        message: row.message,
        createdBy: "human",
        authorEmail: row.authorEmail ?? requestEmail,
        authorName: row.authorName ?? null,
        resolutionTarget: "agent",
        mentions: [],
        mentionsJson: row.mentionsJson ?? null,
        resolvedBy: row.resolvedBy ?? null,
        resolvedAt: row.resolvedAt ?? null,
        consumedAt: row.consumedAt ?? null,
        deletedAt: null,
        deletedBy: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } satisfies PlanComment);
    }

    for (const update of updates) {
      const prev = merged.get(update.id as string);
      if (!prev) continue;
      const status = update.status ?? prev.status;
      merged.set(prev.id, {
        ...prev,
        status,
        message: update.message ?? prev.message,
        resolvedAt:
          status === "resolved"
            ? now
            : status === "open"
              ? null
              : (prev.resolvedAt ?? null),
        resolvedBy:
          status === "resolved"
            ? requestEmail
            : status === "open"
              ? null
              : (prev.resolvedBy ?? null),
        resolutionTarget: "agent",
        updatedAt: now,
      });
    }

    let next = [...merged.values()];
    if (args.deletedCommentIds.length > 0) {
      const removed = new Set(args.deletedCommentIds);
      next = next.filter(
        (comment) =>
          !removed.has(comment.id) &&
          !(comment.parentCommentId && removed.has(comment.parentCommentId)),
      );
    }

    await writeLocalPlanComments(local.folder, next);

    const fresh = await readPlanLocalFolder({
      slug: local.slug,
      path: local.repoPath,
    });
    return buildLocalPlanBundleResult({
      local: fresh,
      kind: "plan" as PlanKind,
      role: "editor",
      comments: next,
      currentFocus: "local-files commenting",
    });
  },
  link: ({ args }) => ({
    url: args.path
      ? `/local-plans/${encodeURIComponent(args.slug)}?${new URLSearchParams({
          path: args.path,
        }).toString()}`
      : `/local-plans/${encodeURIComponent(args.slug)}`,
    label: "Open Local Plan",
    view: "plan",
  }),
});
