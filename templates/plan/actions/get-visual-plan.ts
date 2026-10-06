import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  exportPlanContentToMdxFolder,
  referencedBlockIdsForPlanComments,
} from "../server/plan-mdx.js";
import {
  buildPlanHtml,
  loadPlanBundle,
  planDeepLink,
  planPath,
} from "../server/plans.js";

const queryBooleanSchema = z.preprocess((value) => {
  if (value === "false") return false;
  if (value === "true") return true;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Get an Agent-Native Plan bundle, including structured editable content with stable block IDs, source-control friendly MDX, exported HTML, sections, comments, and recent activity. Call this before targeted contentPatches, source patches, or resolving feedback on a specific plan. For full content replacement, replace-blocks, or replace-file, pass the returned plan.updatedAt exactly as expectedUpdatedAt and reread after the write.",
  schema: z.object({
    id: z.string().describe("Plan ID"),
    includeMdx: queryBooleanSchema
      .optional()
      .describe(
        "Flat GET flag for browser callers. Set false to skip the Prettier-formatted MDX export.",
      ),
    includeHtml: queryBooleanSchema
      .optional()
      .describe(
        "Flat GET flag for browser callers. Set false to skip the exported HTML bundle.",
      ),
    include: z
      .object({
        mdx: z
          .boolean()
          .optional()
          .describe(
            "Include the exported MDX folder in the response. Defaults to false for agent reads; set true for an explicit source-control workflow.",
          ),
        html: z
          .boolean()
          .optional()
          .describe(
            "Include the exported HTML bundle in the response. Defaults to false for agent reads; set true when you explicitly need the rendered legacy artifact.",
          ),
      })
      .optional()
      .describe(
        "Control which expensive fields are included in the response. Defaults match the existing behaviour so nothing breaks.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Visual Plan",
    description: "Read the current visual plan content and annotations.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args, ctx) => {
    const bundle = await loadPlanBundle(args.id);
    const isFrontend = ctx?.caller === "frontend";
    const isModern = Boolean(bundle.plan.content);
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";
    const wantMdx = args.includeMdx ?? args.include?.mdx ?? !isAgentCaller;
    const wantHtml = args.includeHtml ?? args.include?.html ?? !isAgentCaller;
    const includeStoredPlanExportFields = wantHtml || wantMdx;
    return {
      ...bundle,
      planId: bundle.plan.id,
      plan: includeStoredPlanExportFields
        ? bundle.plan
        : { ...bundle.plan, html: undefined, markdown: undefined },
      html:
        !wantHtml || (isFrontend && isModern)
          ? undefined
          : buildPlanHtml(bundle),
      mdx:
        !wantMdx || isFrontend
          ? undefined
          : await exportPlanContentToMdxFolder({
              content: bundle.plan.content,
              title: bundle.plan.title,
              brief: bundle.plan.brief,
              planId: bundle.plan.id,
              url: planPath(bundle.plan.id, bundle.plan.kind),
              referencedBlockIds: referencedBlockIdsForPlanComments(
                bundle.comments,
              ),
            }),
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.id),
    label: "Open Plan",
    view: "plan",
  }),
});
