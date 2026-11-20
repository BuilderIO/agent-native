import { z } from "zod";

import {
  CALCULATE_OPERATORS,
  COMPARISONS,
  OPTION_BLOCK_TYPES,
  createBlock,
  deriveQuestions,
  newId,
  questionBlocks,
  resolveEmbed,
  splitPages,
  type Block,
  type Comparison,
  type Condition,
  type DerivedQuestion,
  type LogicAction,
  type QuestionType,
} from "../shared/form-model/index.js";
import { firstRow, formsErrors } from "./_access.js";

/** An item type is a free string from the caller, so the lookup may miss. */
const named = <T extends string>(
  table: Record<string, T>,
  name: string,
): T | undefined => table[name];

const QUESTION_TYPE_BY_NAME = {
  short_answer: "INPUT_TEXT",
  long_answer: "TEXTAREA",
  email: "INPUT_EMAIL",
  number: "INPUT_NUMBER",
  phone: "INPUT_PHONE_NUMBER",
  link: "INPUT_LINK",
  date: "INPUT_DATE",
  time: "INPUT_TIME",
  multiple_choice: "MULTIPLE_CHOICE",
  checkboxes: "CHECKBOXES",
  dropdown: "DROPDOWN",
  multi_select: "MULTI_SELECT",
  rating: "RATING",
  linear_scale: "LINEAR_SCALE",
  ranking: "RANKING",
  matrix: "MATRIX",
  file_upload: "FILE_UPLOAD",
  signature: "SIGNATURE",
} as const satisfies Record<string, QuestionType>;

const questionRef = z
  .union([z.string(), z.number().int().min(0)])
  .describe(
    "A question: its exact title, or the 0-based index of a question item in this call's items array",
  );

const questionItem = z.object({
  kind: z.literal("question"),
  type: z
    .enum(Object.keys(QUESTION_TYPE_BY_NAME) as [string, ...string[]])
    .describe(
      "short_answer, long_answer, email, number, phone, link, date, time, multiple_choice, checkboxes, dropdown, multi_select, rating, linear_scale, ranking, matrix, file_upload, or signature",
    ),
  title: z
    .string()
    .min(1)
    .max(500)
    .describe("The question as respondents read it"),
  required: z
    .boolean()
    .optional()
    .describe("Respondent must answer. Default false"),
  placeholder: z
    .string()
    .max(500)
    .optional()
    .describe("Hint inside text-like inputs"),
  options: z
    .array(z.string().min(1).max(500))
    .max(100)
    .optional()
    .describe(
      "Choice labels, in order. Required for multiple_choice, checkboxes, dropdown, multi_select and ranking; ignored otherwise",
    ),
  rows: z
    .array(z.string().min(1).max(500))
    .max(50)
    .optional()
    .describe("matrix only: row labels. Required for matrix"),
  columns: z
    .array(z.string().min(1).max(500))
    .max(20)
    .optional()
    .describe("matrix only: column labels. Required for matrix"),
  multiple: z
    .boolean()
    .optional()
    .describe(
      "matrix: several picks per row; file_upload: several files. Default false",
    ),
  stars: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("rating only: number of stars. Default 5"),
  scaleStart: z
    .number()
    .int()
    .min(0)
    .max(1)
    .optional()
    .describe("linear_scale only: first value, 0 or 1. Default 1"),
  scaleEnd: z
    .number()
    .int()
    .min(2)
    .max(10)
    .optional()
    .describe("linear_scale only: last value, 2 to 10. Default 5"),
  leftLabel: z
    .string()
    .max(200)
    .optional()
    .describe("linear_scale only: label at the low end"),
  centerLabel: z
    .string()
    .max(200)
    .optional()
    .describe("linear_scale only: label in the middle"),
  rightLabel: z
    .string()
    .max(200)
    .optional()
    .describe("linear_scale only: label at the high end"),
});

const logicItem = z.object({
  kind: z.literal("logic"),
  when: z
    .object({
      question: questionRef,
      op: z
        .enum(COMPARISONS)
        .describe(
          "Comparison, such as is, is_not, is_any_of, contains, is_empty, greater_than",
        ),
      value: z
        .union([z.string(), z.number(), z.array(z.string())])
        .optional()
        .describe(
          "For choice questions use the option labels. Omit for is_empty and is_not_empty",
        ),
    })
    .describe("Condition on one earlier question"),
  then: z.object({
    action: z.enum([
      "jump_to_page",
      "show_blocks",
      "hide_blocks",
      "require_answer",
      "calculate",
    ]),
    target: z
      .union([z.string(), z.number().int().min(0)])
      .optional()
      .describe(
        'jump_to_page: the 1-based page number to go to, or "end". show_blocks, hide_blocks, require_answer: a question title or item index. Not used by calculate',
      ),
    field: z
      .string()
      .optional()
      .describe("calculate only: the name of a calculated_field item"),
    operator: z
      .enum(CALCULATE_OPERATORS)
      .optional()
      .describe(
        "calculate only: add, subtract, multiply, divide, set or formula. Text fields support add (joins text), set and formula",
      ),
    operand: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        "calculate only: the literal value, or for formula an expression using + - * / parentheses, numbers, quoted text and {{answer:<id>}} references",
      ),
  }),
});

const MEDIA_TYPE_BY_NAME = {
  image: "IMAGE",
  video: "EMBED_VIDEO",
  audio: "EMBED_AUDIO",
  map: "EMBED_MAP",
  embed: "EMBED_LINK",
} as const;

export const composeItemSchema = z.discriminatedUnion("kind", [
  questionItem,
  z.object({
    kind: z.literal("media"),
    type: z
      .enum(Object.keys(MEDIA_TYPE_BY_NAME) as [string, ...string[]])
      .describe(
        "image, video, audio, map or embed. Video, audio and map accept YouTube/Vimeo/Loom, Spotify/SoundCloud and Google/OpenStreetMap links; embed takes any https link",
      ),
    url: z.string().max(2000).describe("http(s) link to the media"),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().max(10_000).describe("A paragraph"),
  }),
  z.object({
    kind: z.literal("heading"),
    level: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .describe("1 is largest"),
    text: z.string().max(10_000),
  }),
  z.object({ kind: z.literal("divider") }),
  z.object({
    kind: z.literal("hidden_field"),
    names: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(50)
      .describe(
        "URL query parameter names to store with each submission; respondents never see them",
      ),
  }),
  z.object({
    kind: z.literal("calculated_field"),
    name: z.string().min(1).max(200).describe("Name used by calculate logic"),
    type: z.enum(["number", "text"]),
    initialValue: z
      .string()
      .max(2000)
      .optional()
      .describe("Starting value; numbers default to 0"),
  }),
  z.object({ kind: z.literal("page_break").describe("Starts a new page") }),
  logicItem,
]);

export type ComposeItem = z.infer<typeof composeItemSchema>;
type LogicItem = z.infer<typeof logicItem>;

const invalid = (message: string) =>
  formsErrors.noWrite(message, "invalid_input");

/** The logic block for `item`, resolved against `base`: every block except logic blocks. */
function buildLogic(
  item: LogicItem,
  base: Block[],
  groupByItemIndex: Map<number, string>,
): Block {
  const questions = deriveQuestions(base);
  const resolve = (ref: string | number): DerivedQuestion => {
    const found =
      typeof ref === "number"
        ? questions.find((q) => q.id === groupByItemIndex.get(ref))
        : questions.find(
            (q) => q.title.trim().toLowerCase() === ref.trim().toLowerCase(),
          );
    return (
      found ??
      invalid(`Logic refers to a question that does not exist: ${ref}.`)
    );
  };
  const source = resolve(item.when.question);
  const toOptionId = (label: string) =>
    source.options.find(
      (o) => o.text.trim().toLowerCase() === label.trim().toLowerCase(),
    )?.id ?? invalid(`"${label}" is not an option of "${source.title}".`);
  const { value } = item.when;
  const condition: Condition = {
    type: "single",
    questionId: source.id,
    comparison: item.when.op as Comparison,
    ...(value === undefined
      ? {}
      : {
          value:
            source.options.length === 0 || typeof value === "number"
              ? value
              : Array.isArray(value)
                ? value.map(toOptionId)
                : toOptionId(value),
        }),
  };
  const { action, target } = item.then;
  let logicAction: LogicAction;
  if (action === "calculate") {
    const { field, operator, operand } = item.then;
    if (!field || !operator)
      return invalid("calculate needs a field and an operator.");
    const calculated = resolve(field);
    if (calculated.type !== "CALCULATED_FIELD")
      return invalid(`"${field}" is not a calculated field.`);
    logicAction = {
      type: action,
      fieldId: calculated.id,
      operator,
      value: operand,
    };
  } else if (target === undefined) {
    return invalid(`${action} needs a target.`);
  } else if (action === "jump_to_page") {
    if (target === "end") logicAction = { type: action, target: "end" };
    else {
      const page = splitPages(base).find((p) => p.number === Number(target));
      if (!page?.breakBlock)
        return invalid(
          `jump_to_page target ${target} is not a page after page 1.`,
        );
      logicAction = { type: action, target: page.breakBlock.uuid };
    }
  } else logicAction = { type: action, targets: [resolve(target).id] };
  return createBlock("CONDITIONAL_LOGIC", {
    condition,
    actions: [logicAction],
  });
}

function itemBlocks(item: Exclude<ComposeItem, LogicItem>): Block[] {
  switch (item.kind) {
    case "question": {
      const type = named(QUESTION_TYPE_BY_NAME, item.type);
      if (!type) return invalid(`Unknown question type: ${item.type}.`);
      if (type in OPTION_BLOCK_TYPES && !item.options?.length)
        return invalid(
          `"${item.title}" is a ${item.type} question and needs options.`,
        );
      if (type === "MATRIX" && (!item.rows?.length || !item.columns?.length))
        return invalid(
          `"${item.title}" is a matrix question and needs rows and columns.`,
        );
      const settings: Record<string, unknown> =
        type === "RATING"
          ? { stars: item.stars ?? 5 }
          : type === "LINEAR_SCALE"
            ? {
                start: item.scaleStart ?? 1,
                end: item.scaleEnd ?? 5,
                step: 1,
                ...(item.leftLabel
                  ? { hasLeftLabel: true, leftLabel: item.leftLabel }
                  : {}),
                ...(item.centerLabel
                  ? { hasCenterLabel: true, centerLabel: item.centerLabel }
                  : {}),
                ...(item.rightLabel
                  ? { hasRightLabel: true, rightLabel: item.rightLabel }
                  : {}),
              }
            : type === "MATRIX" || type === "FILE_UPLOAD"
              ? { allowMultiple: item.multiple ?? false }
              : {};
      return questionBlocks({
        type,
        title: item.title,
        isRequired: item.required,
        placeholder: item.placeholder,
        options: item.options,
        rows: item.rows,
        columns: item.columns,
        settings,
      });
    }
    case "media": {
      const type = named(MEDIA_TYPE_BY_NAME, item.type);
      if (!type) return invalid(`Unknown media type: ${item.type}.`);
      if (!/^https?:\/\//.test(item.url))
        return invalid(`"${item.url}" is not an http(s) link.`);
      if (
        type !== "IMAGE" &&
        type !== "EMBED_LINK" &&
        !resolveEmbed(type, item.url)
      )
        return invalid(`${item.type} does not support "${item.url}".`);
      return [createBlock(type, { url: item.url })];
    }
    case "text":
      return [createBlock("TEXT", { text: item.text })];
    case "heading":
      return [
        createBlock(`HEADING_${item.level}` as const, { text: item.text }),
      ];
    case "divider":
      return [createBlock("DIVIDER", {})];
    case "hidden_field":
      return [
        createBlock("HIDDEN_FIELDS", {
          fields: item.names.map((name) => ({ id: newId(), name })),
        }),
      ];
    case "calculated_field":
      return [
        createBlock("CALCULATED_FIELDS", {
          fields: [
            {
              id: newId(),
              name: item.name,
              type: item.type,
              ...(item.initialValue === undefined
                ? {}
                : { initialValue: item.initialValue }),
            },
          ],
        }),
      ];
    case "page_break":
      return [createBlock("PAGE_BREAK", {})];
  }
}

/**
 * The block list after composing: `existing` (kept when appending) with the new
 * blocks inserted before its thank-you page, or after only the title when replacing.
 */
export function composeBlocks(
  existing: Block[],
  items: ComposeItem[],
  mode: "replace" | "append",
  title?: string,
): Block[] {
  const formTitle =
    existing[0]?.type === "FORM_TITLE"
      ? existing[0]
      : createBlock("FORM_TITLE", { text: "" });
  const withTitle: Block = title
    ? { ...formTitle, payload: { ...formTitle.payload, text: title } }
    : formTitle;
  const rest =
    existing[0]?.type === "FORM_TITLE" ? existing.slice(1) : existing;
  const thankYouAt = rest.findIndex((b) => b.type === "THANK_YOU_PAGE");
  const head =
    mode === "replace"
      ? []
      : rest.slice(0, thankYouAt < 0 ? rest.length : thankYouAt);
  const tail =
    mode === "replace" || thankYouAt < 0 ? [] : rest.slice(thankYouAt);

  const groupByItemIndex = new Map<number, string>();
  const parts = items.map((item, index): Block[] | LogicItem => {
    if (item.kind === "logic") return item;
    const blocks = itemBlocks(item);
    const first = firstRow(blocks);
    if (item.kind === "question" && first)
      groupByItemIndex.set(index, first.groupUuid);
    return blocks;
  });
  const base = [
    withTitle,
    ...head,
    ...parts.filter(Array.isArray).flat(),
    ...tail,
  ];
  const added = parts.flatMap((part) =>
    Array.isArray(part) ? part : [buildLogic(part, base, groupByItemIndex)],
  );
  return [withTitle, ...head, ...added, ...tail];
}
