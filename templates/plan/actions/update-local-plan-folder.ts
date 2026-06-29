import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { buildLocalPlanBundleResult } from "../server/lib/local-plan-bundle.js";
import {
  readLocalPlanComments,
  readPlanLocalFolder,
  writePlanLocalFolder,
} from "../server/lib/local-plan-files.js";
import { normalizePlanContent } from "../server/plan-content.js";
import { referencedBlockIdsForPlanComments } from "../server/plan-mdx.js";
import {
  applyPlanContentPatches,
  planContentPatchesSchema,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import type { PlanKind } from "../shared/types.js";

const localPlanKindSchema = z.enum(["plan", "recap"]);

export default defineAction({
  description:
    "Update a DB-free local Agent-Native Plan MDX folder from PLAN_LOCAL_DIR or an optional repo-relative path. Applies the same structured contentPatches used by update-visual-plan, writes plan.mdx/canvas.mdx/prototype.mdx back to the same local folder, and never writes to the database.",
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
    title: z.string().optional().describe("Plan title."),
    brief: z
      .string()
      .optional()
      .describe("One-line plan summary shown under the title."),
    kind: localPlanKindSchema.optional(),
    content: planContentSchema
      .optional()
      .describe(
        "Full structured content replacement. Prefer contentPatches for targeted edits.",
      ),
    contentPatches: planContentPatchesSchema
      .optional()
      .default([])
      .describe(
        "Targeted structured content edits addressed by stable block/prototype/canvas ids.",
      ),
    note: z.string().optional().describe("Short audit note for callers."),
  }),
  requiresAuth: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    isConsequential: true,
    title: "Update Local Plan Folder",
    description:
      "Edit a local MDX-backed plan folder by slug or repo-relative path without touching the Plan app database.",
  },
  run: async (args) => {
    if (!isLocalPlanRuntime()) {
      throw new Error(
        "Local plan folder editing is only available in local Plan runtime.",
      );
    }

    const current = await readPlanLocalFolder({
      slug: args.slug,
      path: args.path,
    });
    const currentComments = await readLocalPlanComments(current.folder);
    const kind = resolveLocalPlanKind(args.kind, current.mdx) as PlanKind;
    if (kind === "recap") {
      throw new Error("Local recap folders are read-only in the browser.");
    }

    let nextContent: PlanContent =
      args.content !== undefined
        ? (normalizePlanContent(args.content) ?? current.content)
        : current.content;
    if (args.contentPatches.length > 0) {
      nextContent = applyPlanContentPatches(nextContent, args.contentPatches);
    }

    const metadataPatch = args.contentPatches.find(
      (patch) => patch.op === "set-metadata",
    );
    const title =
      args.title ??
      metadataPatch?.title ??
      nextContent.title ??
      current.content.title ??
      current.slug;
    const brief =
      args.brief ??
      metadataPatch?.brief ??
      nextContent.brief ??
      current.content.brief ??
      "Local files preview.";
    nextContent =
      normalizePlanContent({ ...nextContent, title, brief }) ?? nextContent;

    const planId = `local-${current.slug}`;
    const localFiles = await writePlanLocalFolder({
      slug: current.slug,
      path: current.repoPath,
      planId,
      title,
      brief,
      content: nextContent,
      url: current.routePath,
      referencedBlockIds: referencedBlockIdsForPlanComments(currentComments),
    });
    if (!localFiles.written) {
      throw new Error("Local plan folder could not be written.");
    }

    const updated = await readPlanLocalFolder({
      slug: current.slug,
      path: current.repoPath,
    });
    // Editing prose must not blank the persisted review comments, so the
    // returned bundle carries the same comments.json the reader would load.
    const result = await buildLocalPlanBundleResult({
      local: updated,
      kind,
      role: "editor",
      comments: currentComments,
      currentFocus: "local-files editing",
      title,
      brief,
    });
    return { ...result, localFiles, note: args.note };
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

function resolveLocalPlanKind(
  explicit: "plan" | "recap" | undefined,
  mdx: { "plan.mdx": string; ".plan-state.json"?: string },
): "plan" | "recap" {
  if (explicit) return explicit;
  const frontmatterMatch = mdx["plan.mdx"].match(
    /^---[\s\S]*?^kind:\s*["']?(plan|recap)["']?\s*$/m,
  );
  if (frontmatterMatch) return frontmatterMatch[1] as "plan" | "recap";
  try {
    const state = mdx[".plan-state.json"]
      ? (JSON.parse(mdx[".plan-state.json"]) as { kind?: unknown })
      : null;
    if (state?.kind === "plan" || state?.kind === "recap") return state.kind;
  } catch {
    // Optional state file.
  }
  return "plan";
}
