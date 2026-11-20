import { z } from "zod";

export const QUESTION_TYPES = [
  "INPUT_TEXT",
  "TEXTAREA",
  "INPUT_EMAIL",
  "INPUT_NUMBER",
  "INPUT_PHONE_NUMBER",
  "INPUT_LINK",
  "INPUT_DATE",
  "INPUT_TIME",
  "MULTIPLE_CHOICE",
  "CHECKBOXES",
  "DROPDOWN",
  "MULTI_SELECT",
  "RATING",
  "LINEAR_SCALE",
  "RANKING",
  "MATRIX",
  "FILE_UPLOAD",
  "SIGNATURE",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Named values stored with a submission but never asked of the respondent. */
export const FIELD_QUESTION_TYPES = [
  "HIDDEN_FIELD",
  "CALCULATED_FIELD",
] as const;
export type FieldQuestionType = (typeof FIELD_QUESTION_TYPES)[number];
/** Everything a submission column can hold. */
export const ANSWER_TYPES = [
  ...QUESTION_TYPES,
  ...FIELD_QUESTION_TYPES,
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const CHOICE_QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "CHECKBOXES",
  "DROPDOWN",
  "MULTI_SELECT",
] as const;

/** Block type of the one-block-per-option input of each choice question. */
export const OPTION_BLOCK_TYPES = {
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE_OPTION",
  CHECKBOXES: "CHECKBOX",
  DROPDOWN: "DROPDOWN_OPTION",
  MULTI_SELECT: "MULTI_SELECT_OPTION",
  RANKING: "RANKING_OPTION",
} as const;

/** Media and embed blocks: standalone content, not questions. */
export const MEDIA_BLOCK_TYPES = [
  "IMAGE",
  "EMBED_VIDEO",
  "EMBED_AUDIO",
  "EMBED_MAP",
  "EMBED_LINK",
] as const;
export type MediaBlockType = (typeof MEDIA_BLOCK_TYPES)[number];

export const BLOCK_TYPES = [
  "FORM_TITLE",
  "TEXT",
  "TITLE",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "DIVIDER",
  "PAGE_BREAK",
  "THANK_YOU_PAGE",
  "INPUT_TEXT",
  "TEXTAREA",
  "INPUT_EMAIL",
  "INPUT_NUMBER",
  "INPUT_PHONE_NUMBER",
  "INPUT_LINK",
  "INPUT_DATE",
  "INPUT_TIME",
  "MULTIPLE_CHOICE_OPTION",
  "CHECKBOX",
  "DROPDOWN_OPTION",
  "MULTI_SELECT_OPTION",
  "RATING",
  "LINEAR_SCALE",
  "RANKING_OPTION",
  "MATRIX_ROW",
  "MATRIX_COLUMN",
  "FILE_UPLOAD",
  "SIGNATURE",
  ...MEDIA_BLOCK_TYPES,
  "CONDITIONAL_LOGIC",
  "HIDDEN_FIELDS",
  "CALCULATED_FIELDS",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** `QUESTION` groups a question title with its input blocks. */
export type GroupType =
  | "FORM_TITLE"
  | "QUESTION"
  | "TEXT"
  | "HEADING_1"
  | "HEADING_2"
  | "HEADING_3"
  | "DIVIDER"
  | "PAGE_BREAK"
  | "THANK_YOU_PAGE"
  | "CONDITIONAL_LOGIC"
  | "HIDDEN_FIELDS"
  | "CALCULATED_FIELDS"
  | MediaBlockType
  | QuestionType;

export const COMPARISONS = [
  "is",
  "is_not",
  "is_any_of",
  "is_not_any_of",
  "is_every_of",
  "contains",
  "does_not_contain",
  "starts_with",
  "does_not_start_with",
  "ends_with",
  "does_not_end_with",
  "is_empty",
  "is_not_empty",
  "equal",
  "not_equal",
  "greater_than",
  "less_than",
  "greater_or_equal",
  "less_or_equal",
  "is_before",
  "is_after",
] as const;
export type Comparison = (typeof COMPARISONS)[number];

export type ConditionValue = string | number | string[];

export type Condition =
  | {
      type: "single";
      questionId: string;
      comparison: Comparison;
      value?: ConditionValue | undefined;
    }
  | { type: "group"; operator: "and" | "or"; conditions: Condition[] };

export const CALCULATE_OPERATORS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "set",
  "formula",
] as const;
export type CalculateOperator = (typeof CALCULATE_OPERATORS)[number];

/** `target` is a PAGE_BREAK or THANK_YOU_PAGE block uuid, or `"end"`. */
export type LogicAction =
  | { type: "jump_to_page"; target: string }
  | { type: "require_answer"; targets: string[] }
  | { type: "show_blocks"; targets: string[] }
  | { type: "hide_blocks"; targets: string[] }
  | { type: "hide_button_to_disable_completion" }
  /** `value` is a literal, a mention token, or for `formula` an expression. */
  | {
      type: "calculate";
      fieldId: string;
      operator: CalculateOperator;
      value?: string | number | undefined;
    };

const conditionValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.array(z.string().max(200)).max(200),
]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("single"),
      questionId: z.string().min(1).max(64),
      comparison: z.enum(COMPARISONS),
      value: conditionValueSchema.optional(),
    }),
    z.object({
      type: z.literal("group"),
      operator: z.enum(["and", "or"]),
      conditions: z.array(conditionSchema).max(50),
    }),
  ]),
);

const targets = z.array(z.string().min(1).max(64)).max(200);

export const logicActionSchema: z.ZodType<LogicAction> = z.union([
  z.object({ type: z.literal("jump_to_page"), target: z.string().max(64) }),
  z.object({ type: z.literal("require_answer"), targets }),
  z.object({ type: z.literal("show_blocks"), targets }),
  z.object({ type: z.literal("hide_blocks"), targets }),
  z.object({ type: z.literal("hide_button_to_disable_completion") }),
  z.object({
    type: z.literal("calculate"),
    fieldId: z.string().max(64),
    operator: z.enum(CALCULATE_OPERATORS),
    value: z.union([z.string().max(2000), z.number()]).optional(),
  }),
]);

/** Hard ceiling for one uploaded file; a question can only set it lower. */
export const MAX_UPLOAD_MB = 25;

const text = z
  .string({
    error: (issue) =>
      issue.input === undefined
        ? "payload.text is required on text blocks (FORM_TITLE, TEXT, TITLE, HEADING_*, and every option block). To add content use compose-form instead of hand-writing blocks."
        : undefined,
  })
  .max(10_000);
const placeholder = z.string().max(500).optional();
const flag = z.boolean().optional();
const count = z.number().int().min(0).max(1_000_000).optional();

const textLike = { text };
const textInput = {
  placeholder,
  isRequired: flag,
  hasDefaultAnswer: flag,
  defaultAnswer: z.string().max(5000).optional(),
};
const optionPayload = {
  text,
  index: z.number().int().min(0).optional(),
  isFirst: flag,
  isLast: flag,
  isOtherOption: flag,
  isRequired: flag,
  allowMultiple: flag,
  randomize: flag,
  hasMinChoices: flag,
  minChoices: count,
  hasMaxChoices: flag,
  maxChoices: count,
  hasDefaultAnswer: flag,
};

const matrixLine = {
  text,
  index: z.number().int().min(0).optional(),
  isFirst: flag,
  isLast: flag,
  isRequired: flag,
  allowMultiple: flag,
};
const mediaUrl = z.string().max(2000).optional();

export const payloadSchemas = {
  FORM_TITLE: z.looseObject(textLike),
  TEXT: z.looseObject(textLike),
  TITLE: z.looseObject(textLike),
  HEADING_1: z.looseObject(textLike),
  HEADING_2: z.looseObject(textLike),
  HEADING_3: z.looseObject(textLike),
  DIVIDER: z.looseObject({}),
  PAGE_BREAK: z.looseObject({}),
  THANK_YOU_PAGE: z.looseObject({
    title: z.string().max(500).optional(),
    message: z.string().max(5000).optional(),
  }),
  INPUT_TEXT: z.looseObject({
    ...textInput,
    hasMinCharacters: flag,
    minCharacters: count,
    hasMaxCharacters: flag,
    maxCharacters: count,
  }),
  TEXTAREA: z.looseObject({
    ...textInput,
    hasMinCharacters: flag,
    minCharacters: count,
    hasMaxCharacters: flag,
    maxCharacters: count,
  }),
  INPUT_EMAIL: z.looseObject(textInput),
  INPUT_PHONE_NUMBER: z.looseObject(textInput),
  INPUT_LINK: z.looseObject(textInput),
  INPUT_NUMBER: z.looseObject({
    placeholder,
    isRequired: flag,
    hasDefaultAnswer: flag,
    defaultAnswer: z.number().optional(),
    hasMinNumber: flag,
    minNumber: z.number().optional(),
    hasMaxNumber: flag,
    maxNumber: z.number().optional(),
  }),
  INPUT_DATE: z.looseObject({
    placeholder,
    isRequired: flag,
    hasDefaultAnswer: flag,
    defaultAnswer: z.string().max(10).optional(),
    hasMinDate: flag,
    minDate: z.string().max(10).optional(),
    hasMaxDate: flag,
    maxDate: z.string().max(10).optional(),
  }),
  INPUT_TIME: z.looseObject({
    placeholder,
    isRequired: flag,
    hasDefaultAnswer: flag,
    defaultAnswer: z.string().max(5).optional(),
  }),
  MULTIPLE_CHOICE_OPTION: z.looseObject(optionPayload),
  CHECKBOX: z.looseObject(optionPayload),
  DROPDOWN_OPTION: z.looseObject(optionPayload),
  MULTI_SELECT_OPTION: z.looseObject(optionPayload),
  RATING: z.looseObject({
    stars: z.number().int().min(1).max(10).optional(),
    isRequired: flag,
    hasDefaultAnswer: flag,
  }),
  LINEAR_SCALE: z.looseObject({
    start: z.number().int().min(0).max(1).optional(),
    end: z.number().int().min(2).max(10).optional(),
    step: z.number().int().min(1).max(10).optional(),
    hasLeftLabel: flag,
    leftLabel: z.string().max(200).optional(),
    hasCenterLabel: flag,
    centerLabel: z.string().max(200).optional(),
    hasRightLabel: flag,
    rightLabel: z.string().max(200).optional(),
    isRequired: flag,
    hasDefaultAnswer: flag,
  }),
  RANKING_OPTION: z.looseObject(optionPayload),
  MATRIX_ROW: z.looseObject(matrixLine),
  MATRIX_COLUMN: z.looseObject(matrixLine),
  FILE_UPLOAD: z.looseObject({
    isRequired: flag,
    allowMultiple: flag,
    maxFiles: z.number().int().min(1).max(20).optional(),
    maxSizeMb: z.number().min(0.1).max(MAX_UPLOAD_MB).optional(),
    /** MIME types or `image/*` style wildcards; empty means any. */
    allowedTypes: z.array(z.string().max(100)).max(20).optional(),
  }),
  SIGNATURE: z.looseObject({ isRequired: flag }),
  IMAGE: z.looseObject({ url: mediaUrl, alt: z.string().max(500).optional() }),
  EMBED_VIDEO: z.looseObject({ url: mediaUrl }),
  EMBED_AUDIO: z.looseObject({ url: mediaUrl }),
  EMBED_MAP: z.looseObject({ url: mediaUrl }),
  EMBED_LINK: z.looseObject({ url: mediaUrl }),
  HIDDEN_FIELDS: z.looseObject({
    fields: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          name: z.string().max(200),
        }),
      )
      .max(50),
  }),
  CALCULATED_FIELDS: z.looseObject({
    fields: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          name: z.string().max(200),
          type: z.enum(["number", "text"]).optional(),
          initialValue: z.string().max(2000).optional(),
        }),
      )
      .max(50),
  }),
  CONDITIONAL_LOGIC: z.looseObject({
    condition: conditionSchema.nullable().optional(),
    actions: z.array(logicActionSchema).max(20).optional(),
  }),
} satisfies Record<BlockType, z.ZodType>;

export type PayloadByType = {
  [T in BlockType]: z.infer<(typeof payloadSchemas)[T]>;
};

export type Block<T extends BlockType = BlockType> = {
  [K in T]: {
    uuid: string;
    type: K;
    groupUuid: string;
    groupType: GroupType;
    payload: PayloadByType[K];
  };
}[T];

const groupTypeSchema = z.enum([
  "FORM_TITLE",
  "QUESTION",
  "TEXT",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "DIVIDER",
  "PAGE_BREAK",
  "THANK_YOU_PAGE",
  "CONDITIONAL_LOGIC",
  "HIDDEN_FIELDS",
  "CALCULATED_FIELDS",
  ...MEDIA_BLOCK_TYPES,
  ...QUESTION_TYPES,
]);

const blockEnvelope = {
  uuid: z.string().min(1).max(64),
  groupUuid: z.string().min(1).max(64),
  groupType: groupTypeSchema,
};

export const blockSchema = z
  .object({
    ...blockEnvelope,
    type: z.enum(BLOCK_TYPES),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((block, ctx) => {
    const result = payloadSchemas[block.type].safeParse(block.payload);
    if (result.success) return;
    for (const issue of result.error.issues)
      ctx.addIssue({
        code: "custom",
        path: ["payload", ...issue.path],
        message: issue.message,
      });
  }) as unknown as z.ZodType<Block>;

export const MAX_BLOCKS = 2000;

export const blockListSchema = z
  .array(blockSchema)
  .max(MAX_BLOCKS)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    blocks.forEach((block, index) => {
      if (seen.has(block.uuid))
        ctx.addIssue({
          code: "custom",
          path: [index, "uuid"],
          message: "Block uuids must be unique.",
        });
      seen.add(block.uuid);
    });
  });

export type ChoiceAnswer = { selected: string[]; other?: string | undefined };
/** Matrix: row block uuid to the column block uuids picked in that row. */
export type MatrixAnswer = { matrix: Record<string, string[]> };
/**
 * File upload: hosted URLs in upload order, plus the name each respondent
 * chose when the upload recorded one. `names[i]` belongs to `files[i]`.
 */
export type FileAnswer = { files: string[]; names?: string[] | undefined };
export type AnswerValue =
  | string
  | number
  | ChoiceAnswer
  | MatrixAnswer
  | FileAnswer
  | null
  | undefined;
/** Keyed by question id, which is the question's block group uuid. */
export type Answers = Record<string, AnswerValue>;

export const answerValueSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.object({
    selected: z.array(z.string().max(64)).max(500),
    other: z.string().max(5000).optional(),
  }),
  z.object({
    matrix: z.record(z.string().max(64), z.array(z.string().max(64)).max(100)),
  }),
  z.object({
    files: z.array(z.string().max(2000)).max(20),
    names: z.array(z.string().max(300)).max(20).optional(),
  }),
  z.null(),
]);
export const answersSchema = z.record(z.string().max(64), answerValueSchema);

export type QuestionOption = { id: string; text: string; isOther: boolean };

export type DerivedQuestion = {
  /** The block group uuid. Stored as `questions.blockGroupId`. */
  id: string;
  type: AnswerType;
  title: string;
  /** Order of appearance across the whole form, from 0. */
  position: number;
  /** 1-based input page the question sits on. */
  pageNumber: number;
  isRequired: boolean;
  /** Choices; for a matrix, its columns. */
  options: QuestionOption[];
  /** Matrix rows; empty for every other type. */
  rows: QuestionOption[];
  /** Input block carrying the settings, which is the first of the group. */
  settings: Block;
};
