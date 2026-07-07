import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { buildLocalPlanBundleResult } from "../server/lib/local-plan-bundle.js";
import {
  readLocalPlanComments,
  readPlanLocalFolder,
} from "../server/lib/local-plan-files.js";
import {
  localPlanKindSchema,
  resolveLocalPlanKind,
} from "../server/lib/local-plan-kind.js";
import type { PlanKind } from "../shared/types.js";

export default defineAction({
  description:
    "Read a DB-free local Agent-Native Plan MDX folder from PLAN_LOCAL_DIR or an optional repo-relative path for privacy-focused local-files preview. This never reads schema.plans and never writes to the database.",
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
    kind: localPlanKindSchema.optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "Get Local Plan Folder",
    description:
      "Read a local MDX plan folder by slug or repo-relative path without touching the Plan app database.",
  },
  run: async (args) => {
    if (!isLocalPlanRuntime()) {
      throw new Error(
        "Local plan folder preview is only available in local Plan runtime.",
      );
    }

    const local = await readPlanLocalFolder({
      slug: args.slug,
      path: args.path,
    });
    const comments = await readLocalPlanComments(local.folder);
    const kind = resolveLocalPlanKind(args.kind, local.mdx) as PlanKind;
    return buildLocalPlanBundleResult({
      local,
      kind,
      role: "viewer",
      comments,
      currentFocus: "local-files preview",
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
