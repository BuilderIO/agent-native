import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createPlanDesignContent,
  normalizePlanDesignContent,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  isLocalPlanRuntime,
  requirePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { assertGuestCreateWithinLimits } from "../server/lib/guest-abuse.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  buildPlanHtml,
  commentInputSchema,
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

const designSurfaceSchema = z.enum([
  "desktop",
  "mobile",
  "popover",
  "panel",
  "browser",
]);

const designScreenSchema = z.object({
  id: z.string().trim().min(1).max(120).optional().describe("Stable screen id"),
  title: z.string().min(1).max(180).describe("Design screen title"),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe("What the reviewer should inspect on this screen"),
  surface: designSurfaceSchema.optional().default("browser"),
  html: z
    .string()
    .max(40_000)
    .optional()
    .describe(
      "Bounded full-fidelity HTML fragment for this design screen. Use real content, semantic structure, Tailwind-like class names if helpful, and `data-design-id` attributes on editable elements. Never include html/body/script/style tags.",
    ),
  css: z
    .string()
    .max(20_000)
    .optional()
    .describe(
      "Scoped CSS for the design screen. Prefer CSS variables and brand tokens; never include style tags, imports, scripts, or executable URLs.",
    ),
  state: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120).optional(),
        label: z.string().min(1).max(80),
        value: z.string().max(180),
      }),
    )
    .max(24)
    .optional(),
});

const designTransitionSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  label: z.string().max(120).optional(),
  trigger: z.string().max(240).optional(),
});

const DESIGN_CONTEXT_JSON_MAX = 20_000;

const designContextRecordSchema = z.record(z.string(), z.unknown()).refine(
  (value) => {
    try {
      return JSON.stringify(value).length <= DESIGN_CONTEXT_JSON_MAX;
    } catch {
      return false;
    }
  },
  { message: "Design context metadata is too large." },
);

export default defineAction({
  description:
    "Create a /plan-design Agent-Native plan: a full-fidelity Design tab on a Figma-style canvas, plus a matching Prototype tab when interaction or flow review is useful. Use design.md, parsed .fig brand kits, and codebase CSS/Tailwind/token evidence when available. Design screens are bounded HTML/CSS fragments with `data-design-id` targets for specific style edits.",
  schema: z
    .object({
      title: z.string().optional().describe("Short design plan title"),
      brief: z.string().optional().describe("Plain-language design brief"),
      goal: z
        .string()
        .optional()
        .describe("Compatibility alias for brief; prefer brief"),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z
        .string()
        .optional()
        .describe("Current design review focus"),
      status: planStatusSchema.optional().default("review"),
      content: planContentSchema
        .optional()
        .describe(
          "Full structured content when the caller has already authored the design/prototype. Prefer screens/transitions for normal /plan-design creation.",
        ),
      screens: z
        .array(designScreenSchema)
        .max(6)
        .optional()
        .default([])
        .describe(
          "Full-fidelity design screens. Include one to six substantial screens/states with real labels, brand styling, and data-design-id attributes on editable elements. Use CSS for Tailwind-like utility classes because the Plan renderer does not load arbitrary CDN scripts.",
        ),
      transitions: z
        .array(designTransitionSchema)
        .max(24)
        .optional()
        .default([])
        .describe(
          "Expected screen transitions for the Prototype tab. Use data-goto attributes in screen HTML for true route/step changes.",
        ),
      designMd: z
        .string()
        .max(100_000)
        .optional()
        .describe("Optional design.md content used as design direction"),
      brandKit: designContextRecordSchema
        .optional()
        .describe("Optional parsed brand kit or .fig design-system data"),
      codebaseStyles: designContextRecordSchema
        .optional()
        .describe(
          "Optional parsed CSS vars, Tailwind tokens, fonts, and colors",
        ),
      designNotes: z
        .string()
        .max(20_000)
        .optional()
        .describe("Concise notes about brand/style assumptions"),
      implementationNotes: z
        .string()
        .max(20_000)
        .optional()
        .describe("Concise notes for the implementation map section"),
      markdown: z
        .string()
        .max(100_000)
        .optional()
        .describe("Markdown/text fallback or source design plan"),
      sections: z
        .array(sectionInputSchema)
        .optional()
        .default([])
        .describe("Optional legacy plan sections"),
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
    title: "Create Plan Design",
    description:
      "Create a plan whose primary review surface is a full-fidelity design canvas.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan Design",
      description:
        "Open the Agent-Native Plans design review surface for full-fidelity screens, prototype behavior, comments, and implementation notes.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Plan Design",
      height: 860,
    }),
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    const ownerEmail = requirePlanOwnerEmailForWrite(
      requesterEmail,
      "Creating a plan design",
    );
    await assertGuestCreateWithinLimits(ownerEmail);

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const title = args.title || "Untitled plan design";
    const sections =
      args.sections.length > 0
        ? args.sections
        : [
            {
              type: "summary" as const,
              title: "Design objective",
              body: brief,
              order: 0,
              createdBy: "agent" as const,
            },
            {
              type: "prototype" as const,
              title: "Design and prototype",
              body: "The Design tab is a full-fidelity, brand-aware canvas. The Prototype tab uses the same screen HTML/CSS when interaction review is useful.",
              order: 1,
              createdBy: "agent" as const,
            },
            {
              type: "implementation" as const,
              title: "Implementation map",
              body:
                args.implementationNotes ||
                "Add file references, symbols, and short code previews once the design direction is approved.",
              order: 2,
              createdBy: "agent" as const,
            },
          ];
    const content = (() => {
      try {
        return args.content
          ? normalizePlanDesignContent(args.content, {
              title,
              brief,
              source: args.source,
              repoPath: args.repoPath,
              screens: args.screens,
              transitions: args.transitions,
              designMd: args.designMd,
              brandKit: args.brandKit,
              codebaseStyles: args.codebaseStyles,
              designNotes: args.designNotes,
              implementationNotes: args.implementationNotes,
            })
          : createPlanDesignContent({
              title,
              brief,
              source: args.source,
              repoPath: args.repoPath,
              screens: args.screens,
              transitions: args.transitions,
              designMd: args.designMd,
              brandKit: args.brandKit,
              codebaseStyles: args.codebaseStyles,
              designNotes: args.designNotes,
              implementationNotes: args.implementationNotes,
            });
      } catch (error) {
        throw Object.assign(
          new Error(
            `Invalid plan design content: ${(error as Error)?.message ?? "validation failed"}`,
          ),
          { statusCode: 400 },
        );
      }
    })();

    await getDb()
      .insert(schema.plans)
      .values({
        id,
        title,
        brief,
        status: args.status,
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "design review",
        html: null,
        markdown: args.markdown ?? null,
        content: content ? serializePlanContent(content) : null,
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

    await insertInitialPlanComments({
      planId: id,
      comments: args.comments,
      requestEmail: requesterEmail,
      requestName: requesterName,
      now,
    });

    await writeEvent({
      planId: id,
      type: "plan.design_created",
      message: "Full-fidelity plan design created.",
      payload: {
        screens: args.screens.map((screen) => screen.title),
        hasDesignMd: Boolean(args.designMd),
        hasBrandKit: Boolean(args.brandKit),
        hasCodebaseStyles: Boolean(args.codebaseStyles),
      },
      createdBy: "agent",
    });

    const bundle = await loadPlanBundle(id);
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
        "Open the Agent-Native Plans link, review the full-fidelity Design tab first, click through the Prototype tab when present, add comments or targeted style edits, then I will call get-plan-feedback before continuing.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Plan Design",
      view: "plan",
    };
  },
});
