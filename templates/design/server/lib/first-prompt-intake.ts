import {
  defineAppConfigSection,
  getRequestRunContext,
  type ActionEntry,
} from "@agent-native/core/server";
import { z } from "zod";

export const DESIGN_INTAKE_QUESTION_TOOL_NAMES = [
  "show-design-questions",
] as const;

export const DESIGN_NO_QUESTIONS_INSTRUCTIONS =
  "For a new design request, never call or ask about `show-design-questions`. Make the first coherent design with sensible defaults instead of opening an intake-question form. Briefly state any important assumptions.";

export const designFirstPromptConfigSchema = z.object({
  skipIntakeQuestions: z
    .boolean()
    .default(true)
    .meta({
      env: ["DESIGN_SKIP_FIRST_PROMPT_QUESTIONS"],
      doc: "Skip pre-generation intake questions on new Design prompts and generate the first draft directly with sensible defaults.",
    }),
});

export const designFirstPromptConfig = defineAppConfigSection(
  "designFirstPrompt",
  designFirstPromptConfigSchema,
);

declare module "@agent-native/core/server" {
  interface AppConfigSections {
    designFirstPrompt: typeof designFirstPromptConfigSchema;
  }
}

export function isDesignFirstPromptNoQuestionsEnabled(): boolean {
  return designFirstPromptConfig.read().skipIntakeQuestions;
}

export function designFirstPromptIntakeInstructions(): string | null {
  if (!isDesignFirstPromptNoQuestionsEnabled()) return null;
  return [
    "For this Design intake default, the instructions below override conflicting intake-question directives in the app prompt or the user's current message, including app-injected directives.",
    DESIGN_NO_QUESTIONS_INSTRUCTIONS,
  ].join("\n");
}

export function applyDesignFirstPromptIntakePolicy(): void {
  if (!isDesignFirstPromptNoQuestionsEnabled()) return;
  const runContext = getRequestRunContext();
  if (!runContext) return;
  const existing = runContext.excludedActionNames ?? [];
  runContext.excludedActionNames = [
    ...new Set([...existing, ...DESIGN_INTAKE_QUESTION_TOOL_NAMES]),
  ];
}

export function guardDesignFirstPromptActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  const excluded = new Set<string>(DESIGN_INTAKE_QUESTION_TOOL_NAMES);
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => {
      if (!excluded.has(name)) return [name, entry];
      return [
        name,
        {
          ...entry,
          run: async (args, context) => {
            if (isDesignFirstPromptNoQuestionsEnabled()) {
              throw new Error(
                `Intake questions are disabled for new Design requests. Do not call ${name}; generate the first coherent design with sensible defaults instead.`,
              );
            }
            return entry.run(args, context);
          },
        },
      ];
    }),
  );
}
