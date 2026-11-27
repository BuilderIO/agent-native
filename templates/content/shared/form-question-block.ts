import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import { z } from "zod";

export const FORM_QUESTION_BLOCK_TYPE = "form-question";
export const FORM_QUESTION_TAG = "FormQuestion";
export const FORM_TITLE_QUESTION_KEY = "name";
export const FORM_QUESTION_HELP_MAX_LENGTH = 1_000;
export const FORM_QUESTION_PLACEHOLDER_MAX_LENGTH = 200;

export interface FormQuestionData {
  propertyId: string;
  required: boolean;
  help?: string | undefined;
  placeholder?: string | undefined;
}

const PROPERTY_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export const formQuestionSchema = z
  .object({
    propertyId: z.string().regex(PROPERTY_ID),
    required: z.boolean(),
    help: z.string().max(FORM_QUESTION_HELP_MAX_LENGTH).optional(),
    placeholder: z
      .string()
      .max(FORM_QUESTION_PLACEHOLDER_MAX_LENGTH)
      .optional(),
  })
  .strict() as unknown as z.ZodType<FormQuestionData>;

export const formQuestionMdx: BlockMdxConfig<FormQuestionData> = {
  tag: FORM_QUESTION_TAG,
  toAttrs: (data) => ({
    propertyId: data.propertyId,
    required: data.required,
    help: data.help || undefined,
    placeholder: data.placeholder || undefined,
  }),
  fromAttrs: (attrs) => ({
    propertyId: attrs.string("propertyId") ?? "",
    required: attrs.bool("required") ?? false,
    ...(attrs.string("help") ? { help: attrs.string("help") } : {}),
    ...(attrs.string("placeholder")
      ? { placeholder: attrs.string("placeholder") }
      : {}),
  }),
};

const ServerReadStub = () => null;

export const formQuestionBlockConfig: BlockSpec<FormQuestionData> =
  defineBlock<FormQuestionData>({
    type: FORM_QUESTION_BLOCK_TYPE,
    schema: formQuestionSchema,
    mdx: formQuestionMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Question",
    description:
      "One question on a form's page. It asks for the collection property named by propertyId (name is the record's title); the property's name is the question's wording.",
    empty: () => ({ propertyId: "", required: false }),
  });

export function readFormQuestionData(data: unknown): FormQuestionData | null {
  const parsed = formQuestionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function formQuestionBlockRaw(
  blockId: string,
  data: FormQuestionData,
): string {
  return serializeSpecBlock(formQuestionBlockConfig, { id: blockId, data });
}
