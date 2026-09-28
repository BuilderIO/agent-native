import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

const responseInsightSchema = z.object({
  formId: z.string().min(1).describe("Form ID analyzed with response-insights"),
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("Short, evidence-based top signal from the response analysis"),
  detail: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .describe("One line of supporting counts or evidence from the analysis"),
  followUpPrompt: z
    .string()
    .trim()
    .min(1)
    .max(800)
    .describe("A specific prompt to prefill for drafting a follow-up question"),
});

function asInsight(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return typeof result.formId === "string" &&
    typeof result.title === "string" &&
    typeof result.detail === "string" &&
    typeof result.followUpPrompt === "string"
    ? {
        formId: result.formId,
        title: result.title,
        detail: result.detail,
        followUpPrompt: result.followUpPrompt,
      }
    : null;
}

export default defineAction({
  description:
    "Show a concise top-signal card after response-insights when the user asks for an actionable insight. Ground its title, evidence, and follow-up prompt only in the response-insights results; the button prefills the prompt and does not submit it.",
  schema: responseInsightSchema,
  chatUI: {
    renderer: "forms.response-insight",
    when: (args, result) => {
      const insight = asInsight(result);
      return Boolean(
        insight &&
        insight.formId === args.formId &&
        insight.title.trim() &&
        insight.detail.trim() &&
        insight.followUpPrompt.trim(),
      );
    },
    projectResult: (_args, result) => asInsight(result),
  },
  run: async (args) => {
    await assertAccess("form", args.formId, "editor");
    return {
      formId: args.formId,
      title: args.title,
      detail: args.detail,
      followUpPrompt: args.followUpPrompt,
    };
  },
});
