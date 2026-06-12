import { defineAction, embedApp } from "@agent-native/core";
import setResourceVisibilityAction from "@agent-native/core/sharing/actions/set-resource-visibility";
import { eq } from "drizzle-orm";
import { z } from "zod";
import importVisualPlanSourceAction from "./import-visual-plan-source.js";
import { planMdxFileSchema } from "../server/plan-mdx.js";
import {
  planDeepLink,
  planSourceSchema,
  planStatusSchema,
} from "../server/plans.js";
import { getDb, schema } from "../server/db/index.js";

const sourceUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "sourceUrl must be an http or https URL",
  })
  .optional();

export default defineAction({
  description:
    "Create a visual code-review recap from an existing PR, commit, branch, or git diff. For a forward plan before implementation use create-visual-plan; for a UI-first plan use create-ui-plan; for a running prototype use create-prototype-plan. Derive all content from the real diff — never invent schema, API, file, or contract facts. Publish via this tool; never deliver the recap as inline chat text.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing recap plan ID to replace on a subsequent push."),
    title: z.string().optional().describe("Recap title override."),
    brief: z
      .string()
      .optional()
      .describe(
        "Optional one-line recap summary shown under the title. Keep it to a single short sentence.",
      ),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .default("org")
      .describe(
        "Visibility for the published recap. Defaults to 'org' (login-gated to the publishing org) so the recap is never accidentally public. Pass 'private' to keep it owner-only.",
      ),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the recap."),
    sourceUrl: sourceUrlSchema.describe(
      "URL of the pull request, issue, or commit that this recap covers. Must be an http(s) URL. When set, the hosted recap page shows a 'View PR' link back to the source.",
    ),
    currentFocus: z
      .string()
      .optional()
      .default("visual recap review")
      .describe("Current focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    mdx: planMdxFileSchema.describe(
      "Recap source files. Call the get-plan-blocks tool FIRST for the authoritative block catalog, authoring rules, and style tokens — do not author from memory. Key rules: derive all blocks from the real diff only; use diff blocks with line-anchored annotations on key hunks; for UI changes include realistic WireframeBlock before/after in a Columns block (labels: Before / After); use .diagram-* primitives and --wf-* tokens in diagrams (no hex/rgb/hsl, no custom fonts); keep API endpoint blocks in single-column flow unless it is an explicit before/after contract comparison.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Recap",
    description:
      "Create a visual code-review recap from a real PR, branch, commit, or git diff.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Recap",
      description:
        "Open the Agent-Native Plan review surface for a visual code-review recap.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Recap",
      height: 860,
    }),
  },
  run: async (args) => {
    const result = await importVisualPlanSourceAction.run({
      ...args,
      kind: "recap",
      source: args.source ?? "imported",
      currentFocus: args.currentFocus ?? "visual recap review",
      status: args.status ?? "review",
    });
    // Apply requested visibility server-side so the recap is never left private
    // (the import action always creates with visibility='private'). Route this
    // through the shared visibility action instead of updating the row directly:
    // when visibility is "org", that action also binds the current org onto
    // older/unscoped plans so org-scoped recap links are actually readable.
    const planId = (result as { planId?: string } | null)?.planId;
    const visibility = args.visibility ?? "org";
    if (planId) {
      if (args.sourceUrl !== undefined) {
        const db = getDb();
        await db
          .update(schema.plans)
          .set({ sourceUrl: args.sourceUrl ?? null })
          .where(eq(schema.plans.id, planId));
      }
      await setResourceVisibilityAction.run({
        resourceType: "plan",
        resourceId: planId,
        visibility,
      });
    }
    return result;
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id, "recap"),
      label: "Open Recap",
      view: "plan",
    };
  },
});
