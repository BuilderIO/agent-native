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
import { buildUiPlanHtml } from "../server/ui-plan-html.js";

const uiPlanStateSchema = z.object({
  name: z.string().min(1).describe("State or screen name"),
  description: z
    .string()
    .min(1)
    .describe("What the reviewer should inspect in this state"),
});

const uiPlanComponentSchema = z.object({
  name: z.string().min(1).describe("Component or interaction name"),
  description: z
    .string()
    .min(1)
    .describe("Intent, constraints, and details for this UI part"),
});

export default defineAction({
  description:
    "Create a UI-first Agent-Native plan. Use this for /ui-plan when the work needs a top pan/zoom wireframe or diagram canvas plus a refined Notion-like document with tabs, diagrams, code tabs, comments, share/export, and agent handoff.",
  schema: z
    .object({
      title: z.string().optional().describe("Short UI plan title"),
      brief: z.string().optional().describe("Plain-language UI plan brief"),
      goal: z
        .string()
        .optional()
        .describe("Compatibility alias for brief; prefer brief"),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z.string().optional().describe("Current UI plan focus"),
      status: planStatusSchema.optional().default("review"),
      html: z
        .string()
        .optional()
        .describe(
          "Optional full bespoke HTML document. If omitted, Plans generates a UI-first hybrid document with an optional top visual canvas.",
        ),
      markdown: z
        .string()
        .optional()
        .describe("Markdown/text fallback or source UI plan"),
      states: z
        .array(uiPlanStateSchema)
        .optional()
        .default([])
        .describe(
          "Screens or states to show in the optional top pan/zoom canvas and in document tabs, such as Default, Empty, Loading, Error, Mobile, or Agent handoff. Omit when visual states would not help.",
        ),
      components: z
        .array(uiPlanComponentSchema)
        .optional()
        .default([])
        .describe(
          "Focused UI parts to show in rich component tabs and optional canvas notes.",
        ),
      sketchiness: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "Sketchiness for generated wireframes and diagrams, from 0 for crisp to 100 for very hand-drawn.",
        ),
      implementationNotes: z
        .string()
        .optional()
        .describe("Concise notes for the implementation map section"),
      sections: z
        .array(sectionInputSchema)
        .optional()
        .default([])
        .describe("Optional additional plan sections"),
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
    title: "Create UI Plan",
    description:
      "Create a UI-first HTML plan with full-width mockups, states, annotations, and agent feedback handoff.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "UI Plan",
      description:
        "Open the Agent-Native Plans UI review surface for high-fidelity mockups, states, annotations, and implementation notes.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open UI Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Creating a UI plan requires an authenticated user.");
    }

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const title = args.title || "Untitled UI plan";
    const html =
      args.html ??
      buildUiPlanHtml({
        title,
        brief,
        source: args.source,
        repoPath: args.repoPath,
        states: args.states,
        components: args.components,
        sketchiness: args.sketchiness,
        implementationNotes: args.implementationNotes,
      });
    const sections =
      args.sections.length > 0
        ? args.sections
        : [
            {
              type: "summary" as const,
              title: "UI goal",
              body: brief,
              order: 0,
              createdBy: "agent" as const,
            },
            {
              type: "mockup" as const,
              title: "UI flow and rich document",
              body: "The generated HTML uses a top pan/zoom visual canvas when states or diagrams are useful, then continues as a refined interactive document.",
              order: 1,
              createdBy: "agent" as const,
            },
            {
              type: "implementation" as const,
              title: "Implementation map",
              body:
                args.implementationNotes ||
                "Add file references, symbols, and short code previews once the UI direction is approved.",
              order: 2,
              createdBy: "agent" as const,
            },
          ];

    await getDb()
      .insert(schema.plans)
      .values({
        id,
        title,
        brief,
        status: args.status,
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "ui plan review",
        html,
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
      type: "plan.ui_created",
      message: "UI-first visual plan created.",
      payload: {
        states: args.states.map((state) => state.name),
        components: args.components.map((component) => component.name),
        topCanvas: args.states.length > 0 || args.components.length > 0,
      },
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
        "Open the Agent-Native UI plan, review the top pan/zoom wireframe canvas when present, continue through the Notion-like document blocks, add comments or drawings directly on the plan, then I will call get-plan-feedback before implementing. The live link is private until shared; use the Share panel for reviewer access or export-visual-plan for an HTML/Markdown/JSON receipt to check into source.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open UI Plan",
      view: "plan",
    };
  },
});
