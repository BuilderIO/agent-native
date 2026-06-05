import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createVisualQuestionsContent,
  normalizePlanContent,
  serializePlanContent,
  type VisualQuestionBuilderInput,
} from "../server/plan-content.js";
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
import { planContentSchema } from "../shared/plan-content.js";

const visualQuestionOptionSchema = z.object({
  value: z.string().optional(),
  label: z.string().min(1).describe("Option label"),
  description: z.string().optional().describe("Short helper text"),
  recommended: z.boolean().optional().describe("Marks a suggested option"),
  preview: z
    .enum(["desktop", "mobile", "split", "flow", "diagram"])
    .optional()
    .describe("Optional visual preview style for visual questions"),
  bullets: z.array(z.string()).optional().describe("Option detail bullets"),
});

const visualQuestionSchema = z.object({
  id: z.string().min(1).describe("Stable answer key"),
  type: z
    .enum(["single", "multi", "freeform", "visual"])
    .describe("Question input type"),
  title: z.string().min(1).describe("Question title"),
  subtitle: z.string().optional().describe("Question helper text"),
  options: z
    .array(visualQuestionOptionSchema)
    .optional()
    .describe("Choice options for chip or visual questions"),
  allowOther: z.boolean().optional().describe("Show an Other freeform input"),
  placeholder: z.string().optional().describe("Freeform placeholder"),
  required: z.boolean().optional().describe("Whether the answer matters"),
});

const visualQuestionsSchema = z
  .array(visualQuestionSchema)
  .superRefine((questions, ctx) => {
    const seen = new Set<string>();
    questions.forEach((question, index) => {
      if (seen.has(question.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Question IDs must be unique: ${question.id}`,
          path: [index, "id"],
        });
      }
      seen.add(question.id);
    });
  });

export default defineAction({
  description:
    "Create a visual intake questionnaire as an Agent-Native Plan. Use this as the /visual-plan preflight or /visual-questions manual override when the user should answer rich visual questions with chips, mockup options, diagrams, and freeform notes before the final plan.",
  schema: z
    .object({
      title: z.string().optional().describe("Short questionnaire title"),
      brief: z
        .string()
        .optional()
        .describe("What the questions are trying to clarify"),
      goal: z
        .string()
        .optional()
        .describe("Compatibility alias for brief; prefer brief"),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z
        .string()
        .optional()
        .describe("Current visual-question focus"),
      status: planStatusSchema.optional().default("review"),
      questions: visualQuestionsSchema
        .optional()
        .default([])
        .describe(
          "Optional custom question schema. Omit for the default UI intake flow.",
        ),
      html: z
        .string()
        .optional()
        .describe(
          "Legacy standalone questionnaire HTML. Prefer content blocks for new visual question plans.",
        ),
      content: planContentSchema
        .optional()
        .describe(
          "Structured editable visual-question content. Prefer this for rich intake questions, visual options, semantic kit-tree wireframe previews, diagrams, and follow-up notes.",
        ),
      markdown: z
        .string()
        .optional()
        .describe("Markdown/text fallback or source intake notes"),
      sections: z
        .array(sectionInputSchema)
        .optional()
        .default([])
        .describe("Optional fallback sections for the question plan"),
      comments: z
        .array(commentInputSchema)
        .optional()
        .default([])
        .describe("Initial review prompts or annotations"),
    })
    .refine((args) => Boolean(args.brief || args.goal), {
      message: "Either brief or goal is required.",
    }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Questions",
    description:
      "Create a rich visual intake form that feeds answers into a UI or visual plan prompt.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Questions",
      description:
        "Open an interactive visual intake form with chips, mockup options, diagrams, freeform answers, and agent handoff.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Visual Questions",
      height: 860,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error(
        "Creating visual questions requires an authenticated user.",
      );
    }

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const title = args.title || "Visual questions";
    const questions = args.questions as VisualQuestionBuilderInput[];
    const sections =
      args.sections.length > 0
        ? args.sections
        : [
            {
              type: "questions" as const,
              title: "Visual intake",
              body: brief,
              order: 0,
              createdBy: "agent" as const,
            },
            {
              type: "mockup" as const,
              title: "Visual answer options",
              body: "The generated HTML includes single-choice chips, multi-select chips, freeform notes, visual mockup choices, and sketchy diagrams.",
              order: 1,
              createdBy: "agent" as const,
            },
            {
              type: "implementation" as const,
              title: "Agent handoff",
              body: "Use the generated answer summary to create a UI-first visual plan with create-ui-plan, a general visual plan with create-visual-plan, or to update the current plan.",
              order: 2,
              createdBy: "agent" as const,
            },
          ];
    const content = args.content
      ? normalizePlanContent(args.content)
      : args.html
        ? null
        : createVisualQuestionsContent({
            title,
            brief,
            questions,
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
        currentFocus: args.currentFocus ?? "visual questions",
        html: args.html ?? null,
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
      type: "plan.visual_questions_created",
      message: "Visual questions created.",
      payload: {
        questionCount: args.questions.length || "default",
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
        "Open the visual questions plan, answer the chips, freeform fields, mockup choices, and diagram options, then use Copy prompt or Send to agent to feed the summary into a UI/visual plan. The live link is private until shared.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Visual Questions",
      view: "plan",
    };
  },
});
