import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the shared `question-form` and `visual-questions`
 * blocks: their data schema and MDX round-trip config. Lives in core so any
 * app's server/shared registry and the client spec (`question-form.tsx`)
 * consume one definition. Keeping it React-free means importing it into a server
 * module never pulls React into the Nitro/SSR bundle.
 *
 * `question-form` is the general-purpose respondent-facing form (Open Questions,
 * single/multi/freeform answers, recommended options, optional inline
 * wireframe/diagram previews). `visual-questions` is the same data shape and UI,
 * branded for an explicit visual-intake flow before a plan. Both originated in
 * the plan template (the data shape mirrors the legacy `visual-questions` block)
 * before moving here, so their MDX `tag` + attribute encoding MUST match the
 * historical `<QuestionForm questions submitLabel />` / `<VisualQuestions … />`
 * forms so stored `.mdx` round-trips byte-compatibly.
 *
 * The per-option `wireframe`/`diagram` previews stay opaque (`unknown`) at the
 * core layer: the core block renders them through `ctx.renderBlock` (the same
 * nested-block seam tabs/columns use) so core never imports an app's wireframe
 * or diagram renderer. Each app supplies the matching `wireframe`/`diagram`
 * block spec and shape.
 */

export type QuestionMode = "single" | "multi" | "freeform";

export interface QuestionFormOption {
  id: string;
  label: string;
  detail?: string;
  /** Authored recommendation only (not a runtime answer). */
  recommended?: boolean;
  /**
   * Optional inline visual previews for this option. Kept opaque at the core
   * layer; rendered via `ctx.renderBlock` as a nested `wireframe`/`diagram`
   * block so core stays app-agnostic. Apps validate the concrete shape with
   * their own wireframe/diagram schemas.
   */
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

/** `visual-questions` shares the exact `question-form` data shape. */
export type VisualQuestionsData = QuestionFormData;

const idSchema = z.string().trim().min(1).max(120);

const questionOptionSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(220),
  detail: z.string().trim().max(800).optional(),
  recommended: z.boolean().optional(),
  // Opaque at the core layer — the inline preview renders via `ctx.renderBlock`
  // with the app's own wireframe/diagram block spec; the app validates the shape.
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

/** `visual-questions` validates with the same schema as `question-form`. */
export const visualQuestionsSchema =
  questionFormSchema as unknown as z.ZodType<VisualQuestionsData>;

/**
 * MDX config: `questions` and `submitLabel` are both attributes (the questions
 * array is JSON-encoded by the shared `prop()` encoder). Mirrors the legacy
 * `<QuestionForm questions={[…]} submitLabel="…" />` encoding so stored `.mdx`
 * round-trips byte-compatibly.
 */
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

/** `visual-questions` uses the historical `<VisualQuestions … />` tag. */
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
