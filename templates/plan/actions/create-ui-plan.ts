import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createUiPlanContent,
  normalizePlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  isLocalPlanRuntime,
  resolvePlanOrgIdForWrite,
  requirePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { assertGuestCreateWithinLimits } from "../server/lib/guest-abuse.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  buildPlanHtml,
  commentInputSchema,
  emitPlanCreated,
  insertInitialPlanComments,
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
import { planContentSchema } from "../shared/plan-content.js";

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
    "Create a UI-first plan whose centerpiece is wireframed screens/states on a canvas. For a document-first plan use create-visual-plan; for a recap of an existing diff use create-visual-recap; for a running interactive prototype use create-prototype-plan; for a full-fidelity branded design use create-plan-design. Publish via this tool; never deliver the plan as inline chat text.",
  schema: z
    .object({
      title: z.string().optional().describe("Short UI plan title"),
      brief: z
        .string()
        .optional()
        .describe(
          "One short sentence summarizing the UI plan, shown as the lede under the title. Keep it to a single tight line; the document carries the detail.",
        ),
      goal: z.string().optional().describe("Alias for brief."),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z.string().optional().describe("Current UI plan focus"),
      status: planStatusSchema.optional().default("review"),
      content: planContentSchema
        .optional()
        .describe(
          "Structured editable UI plan content. Prefer this for app-owned top canvas wireframes (HTML mockups: set the wireframe's data.html to a semantic HTML fragment of the screen and pick a surface — the renderer owns the theme, footprint/aspect, hand-drawn font, and sketch overlay; use --wf-* CSS tokens for any custom color, never hex), sketch diagrams, rich text, code blocks (grouped in a vertical tabs block for a file map), annotated code for key files, validation checklists, and bounded custom HTML fragments. Diagram data.html/data.css should use renderer-owned .diagram-* primitives plus --wf-* tokens, not custom fonts or hard-coded hex/rgb/hsl colors, so light/dark and sketchy Excalifont/rough.js modes remain correct. The canvas should carry Claude-style flex/grid wireframe artboards and designer annotations; the document should add implementation substance instead of duplicating the same wireframes. The renderer owns all visual styling; emit lean content, not pixels.",
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
          "Screens or states to show primarily on the optional top pan/zoom canvas, such as Default, Empty, Loading, Error, Mobile, or Agent handoff. For component/widget work, prefer focused component variants and one real product-context frame over fake desktop/mobile journeys. Omit when visual states would not help.",
        ),
      components: z
        .array(uiPlanComponentSchema)
        .optional()
        .default([])
        .describe(
          "Focused UI parts and constraints for canvas annotations and the implementation document. Do not use these to create redundant wireframe tabs when the top canvas already shows the UI.",
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
      "Create a UI-first visual plan with a review canvas, non-redundant implementation document, annotations, and agent feedback handoff.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "UI Plan",
      description:
        "Open the Agent-Native Plan UI review surface for sketch mockups, state annotations, implementation maps, snippets, and validation notes.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open UI Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    const ownerEmail = requirePlanOwnerEmailForWrite(
      requesterEmail,
      "Creating a UI plan",
    );
    const ownerOrgId = resolvePlanOrgIdForWrite(
      requesterEmail,
      getRequestOrgId(),
    );
    await assertGuestCreateWithinLimits(ownerEmail);

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const title = args.title || "Untitled UI plan";
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
              body: "The generated plan uses a top pan/zoom visual canvas when states or diagrams are useful, then continues as a refined implementation document instead of restating the same mockups.",
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
    const content = args.content
      ? normalizePlanContent(args.content)
      : createUiPlanContent({
          title,
          brief,
          source: args.source,
          repoPath: args.repoPath,
          states: args.states,
          components: args.components,
          implementationNotes: args.implementationNotes,
        });

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
        html: null,
        markdown: args.markdown ?? null,
        content: content ? serializePlanContent(content) : null,
        createdAt: now,
        updatedAt: now,
        approvedAt: args.status === "approved" ? now : null,
        ownerEmail,
        orgId: ownerOrgId,
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

    await insertInitialPlanComments({
      planId: id,
      comments: args.comments,
      requestEmail: requesterEmail,
      requestName: requesterName,
      now,
    });

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
    emitPlanCreated({
      planId: id,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      status: bundle.plan.status,
      ownerEmail: bundle.access.ownerEmail,
    });
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: id,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          content: bundle.plan.content,
          url: planPath(id),
        })
      : null;
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      path: planPath(id),
      url: planPath(id),
      ...(local?.written ? { localFiles: local } : {}),
      fallbackInstructions:
        "Open the Agent-Native UI plan, review the top pan/zoom sketch canvas when present, continue through the implementation-focused document blocks, add comments or drawings directly on the plan, then I will call get-plan-feedback before implementing. The live link is private until shared; use the Share panel for reviewer access or export-visual-plan for an HTML/Markdown/JSON receipt to check into source.",
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
