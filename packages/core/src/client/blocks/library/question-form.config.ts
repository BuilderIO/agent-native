import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

export type QuestionMode = "single" | "multi" | "freeform";

export interface QuestionFormOption {
  id: string;
  label: string;
  detail?: string;
  recommended?: boolean;
  wireframe?: unknown;
  diagram?: unknown;
}

export interface QuestionFormQuestion {
  id: string;
  title: string;
  subtitle?: string;
  mode: QuestionMode;
  options?: QuestionFormOption[];
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface QuestionFormData {
  questions: QuestionFormQuestion[];
  submitLabel?: string;
}

export type VisualQuestionsData = QuestionFormData;

const idSchema = z.string().trim().min(1).max(120);

const questionOptionSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(220),
  detail: z.string().trim().max(800).optional(),
  recommended: z.boolean().optional(),
  wireframe: z.unknown().optional(),
  diagram: z.unknown().optional(),
}) as z.ZodType<QuestionFormOption>;

const questionSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(260),
  subtitle: z.string().trim().max(700).optional(),
  mode: z.enum(["single", "multi", "freeform"]),
  options: z.array(questionOptionSchema).max(40).optional(),
  allowOther: z.boolean().optional(),
  placeholder: z.string().trim().max(240).optional(),
  required: z.boolean().optional(),
}) as z.ZodType<QuestionFormQuestion>;

export const questionFormSchema = z.object({
  questions: z.array(questionSchema).min(1).max(40),
  submitLabel: z.string().trim().max(80).optional(),
}) as unknown as z.ZodType<QuestionFormData>;

export const visualQuestionsSchema =
  questionFormSchema as unknown as z.ZodType<VisualQuestionsData>;

export const questionFormMdx: BlockMdxConfig<QuestionFormData> = {
  tag: "QuestionForm",
  toAttrs: (data) => ({
    questions: data.questions,
    submitLabel: data.submitLabel,
  }),
  fromAttrs: (attrs) => ({
    questions: attrs.array<QuestionFormQuestion>("questions") ?? [],
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
    questions: attrs.array<QuestionFormQuestion>("questions") ?? [],
    submitLabel: attrs.string("submitLabel"),
  }),
};
