import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  buildPlanHtml,
  commentInputSchema,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
  planSourceSchema,
  planStatusSchema,
  sectionInputSchema,
  writeEvent,
} from "../server/plans.js";

export default defineAction({
  description:
    "Create an Agent-Native plan for a coding-agent task. Use this before implementation to open a bespoke visual plan with tabbed diagrams, wireframes, prototypes, file/symbol implementation maps, code previews, options, and annotations.",
  schema: z
    .object({
      title: z.string().optional().describe("Short plan title"),
      brief: z.string().optional().describe("Plain-language plan brief"),
      goal: z
        .string()
        .optional()
        .describe("Compatibility alias for brief; prefer brief"),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z.string().optional().describe("Current plan focus"),
      status: planStatusSchema.optional().default("review"),
      html: z
        .string()
        .optional()
        .describe(
          "Full bespoke HTML document to render in the plan iframe. Use data-plan-tabs for multiple diagrams, wireframes, mockups, or design options.",
        ),
      markdown: z
        .string()
        .optional()
        .describe("Markdown/text fallback or source plan"),
      sections: z
        .array(sectionInputSchema)
        .optional()
        .default([])
        .describe("Readable plan sections and visual blocks"),
      comments: z
        .array(commentInputSchema)
        .optional()
        .default([])
        .describe("Initial annotations or review prompts"),
    })
    .refine((args) => Boolean(args.brief || args.goal), {
      message: "Either brief or goal is required.",
    }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Plan",
    description:
      "Create a plan where a person can scan visuals, annotate, and respond before the agent builds.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan",
      description:
        "Open the Agent-Native Plans review surface for diagrams, wireframes, mockups, prototypes, and comments.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Creating a visual plan requires an authenticated user.");
    }

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const sections =
      args.sections.length > 0
        ? args.sections
        : [
            {
              type: "summary" as const,
              title: "What we are planning",
              body: brief,
              order: 0,
              createdBy: "agent" as const,
            },
            {
              type: "diagram" as const,
              title: "Review flow",
              body: "The plan is meant to be scanned, annotated, revised, then used for implementation.",
              order: 1,
              createdBy: "agent" as const,
            },
            {
              type: "implementation" as const,
              title: "Files and symbols to review",
              body: "Add file references here once the agent has inspected the repo, for example `app/routes/example.tsx` - symbols: `ExampleRoute`; update the route behavior and include a short code preview.",
              order: 2,
              createdBy: "agent" as const,
            },
          ];

    await getDb()
      .insert(schema.plans)
      .values({
        id,
        title: args.title || "Untitled visual plan",
        brief,
        status: args.status,
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "visual review",
        html: args.html ?? null,
        markdown: args.markdown ?? null,
        createdAt: now,
        updatedAt: now,
        approvedAt: args.status === "approved" ? now : null,
        ownerEmail,
        orgId: getRequestOrgId(),
        visibility: "private",
      });

    await getDb()
      .insert(schema.planSections)
      .values(
        sections.map((section, index) => ({
          id: section.id ?? newId("sec"),
          planId: id,
          type: section.type,
          title: section.title,
          body: section.body,
          html: section.html ?? null,
          order: section.order ?? index,
          createdBy: section.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
      );

    if (args.comments.length > 0) {
      await getDb()
        .insert(schema.planComments)
        .values(
          args.comments.map((comment) => ({
            id: comment.id ?? newId("cmt"),
            planId: id,
            sectionId: comment.sectionId ?? null,
            kind: comment.kind,
            status: comment.status,
            anchor: comment.anchor ?? null,
            message: comment.message,
            createdBy: comment.createdBy,
            consumedAt: null,
            createdAt: now,
            updatedAt: now,
          })),
        );
    }

    await writeEvent({
      planId: id,
      type: "plan.created",
      message: "Visual plan created.",
      createdBy: "agent",
    });

    const bundle = await loadPlanBundle(id);
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      path: planPath(id),
      url: planPath(id),
      fallbackInstructions:
        "Open the Agent-Native Plans link, scan the HTML plan, add comments or corrections, then I will call get-plan-feedback before continuing. If this host cannot read live feedback, paste the feedback summary back into chat.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Plan",
      view: "plan",
    };
  },
});
