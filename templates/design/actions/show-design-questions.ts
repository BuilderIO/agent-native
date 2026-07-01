import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

function designQuestionsStateKey(designId: string): string {
  return `show-questions:${designId}`;
}

const questionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  recommended: z.boolean().optional(),
});

const questionSchema = z.object({
  id: z.string().min(1).describe("Stable answer key, e.g. 'form_factor'"),
  type: z
    .enum(["text-options", "color-options", "slider", "file", "freeform"])
    .describe("Question renderer type"),
  header: z.string().optional().describe("Short category label"),
  question: z.string().min(1).describe("User-facing question text"),
  description: z.string().optional().describe("Short helper text"),
  options: z.array(questionOptionSchema).optional(),
  choices: z.array(questionOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  allowOther: z.boolean().optional(),
  includeExplore: z.boolean().optional(),
  includeDecide: z.boolean().optional(),
});

function normalizeDesignQuestions(
  questions: z.infer<typeof questionSchema>[],
): z.infer<typeof questionSchema>[] {
  return questions.map((question) => ({
    ...question,
    // The agent supplies Explore/Decide choices explicitly when needed.
    // Default injection duplicates cards on every question in the form.
    includeExplore: question.includeExplore ?? false,
    includeDecide: question.includeDecide ?? false,
  }));
}

export default defineAction({
  description:
    "Show a Claude Design-style question form in the Design editor before " +
    "generating a new design. Use this as the first step for non-trivial new " +
    "design prompts: create/open the design shell, call show-design-questions " +
    "with tailored questions, then stop and wait for the user's answers before " +
    "calling generate-design or present-design-variants.",
  schema: z.object({
    designId: z.string().describe("Design project ID to show questions for"),
    title: z
      .string()
      .optional()
      .describe("Question form title shown in the main canvas"),
    description: z
      .string()
      .optional()
      .describe("Short intro text shown under the title"),
    skipLabel: z.string().optional(),
    submitLabel: z.string().optional(),
    questions: z
      .array(questionSchema)
      .min(1)
      .max(8)
      .describe(
        "1-8 focused design-intake questions. Prefer 4-6 concise questions " +
          "with useful choices, Other enabled, and Decide for me where appropriate.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design questions",
      description: "Open the Design editor with the intake questions visible.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design questions",
      height: 680,
    }),
  },
  run: async ({
    designId,
    title,
    description,
    skipLabel,
    submitLabel,
    questions,
  }) => {
    await assertAccess("design", designId, "editor");

    const normalizedQuestions = normalizeDesignQuestions(questions);

    await writeAppState(designQuestionsStateKey(designId), {
      designId,
      title: title ?? "Quick questions before I design",
      description:
        description ??
        "Pick what matters. Use Other for specifics, or let the agent decide.",
      skipLabel: skipLabel ?? "Decide for me",
      submitLabel: submitLabel ?? "Continue",
      questions: normalizedQuestions,
    });
    await writeAppState("navigate", {
      view: "editor",
      designId,
      editorView: "overview",
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
    });

    return {
      designId,
      count: questions.length,
      path: `/design/${encodeURIComponent(designId)}`,
      embed: true,
      nextRequiredAction:
        "Wait for the user's answers before generating design files or variants.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design questions",
      view: "editor",
    };
  },
});
