import type { BlockMdxConfig } from "@agent-native/core/blocks/server";
import {
  questionFormDataSchema,
  type PlanQuestionFormBlock,
  type PlanVisualQuestionsBlock,
} from "../plan-content.js";

/**
 * Pure (React-free) part of the general-purpose question form block. The data
 * shape intentionally mirrors the legacy `visual-questions` block so existing
 * visual intake rendering can be reused while normal plans get a clearer,
 * reusable block type for Open Questions sections.
 */

export type QuestionFormData = PlanQuestionFormBlock["data"];
export type VisualQuestionsData = PlanVisualQuestionsBlock["data"];

export const questionFormSchema =
  questionFormDataSchema as unknown as import("zod").ZodType<QuestionFormData>;

export const visualQuestionsSchema =
  questionFormDataSchema as unknown as import("zod").ZodType<VisualQuestionsData>;

export const questionFormMdx: BlockMdxConfig<QuestionFormData> = {
  tag: "QuestionForm",
  toAttrs: (data) => ({
    questions: data.questions,
    submitLabel: data.submitLabel,
  }),
  fromAttrs: (attrs) => ({
    questions: attrs.array("questions") ?? [],
    submitLabel: attrs.string("submitLabel"),
  }),
};

export const visualQuestionsMdx: BlockMdxConfig<VisualQuestionsData> = {
  tag: "VisualQuestions",
  toAttrs: (data) => ({
    questions: data.questions,
    submitLabel: data.submitLabel,
  }),
  fromAttrs: (attrs) => ({
    questions: attrs.array("questions") ?? [],
    submitLabel: attrs.string("submitLabel"),
  }),
};
