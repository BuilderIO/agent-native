import {
  MEDIA_BLOCK_TYPES,
  OPTION_BLOCK_TYPES,
  type Block,
  type BlockType,
  type GroupType,
  type PayloadByType,
  type QuestionType,
} from "./types.js";

export function newId(): string {
  return crypto.randomUUID();
}

const QUESTION_TYPE_BY_BLOCK_TYPE: Partial<Record<BlockType, QuestionType>> = {
  INPUT_TEXT: "INPUT_TEXT",
  TEXTAREA: "TEXTAREA",
  INPUT_EMAIL: "INPUT_EMAIL",
  INPUT_NUMBER: "INPUT_NUMBER",
  INPUT_PHONE_NUMBER: "INPUT_PHONE_NUMBER",
  INPUT_LINK: "INPUT_LINK",
  INPUT_DATE: "INPUT_DATE",
  INPUT_TIME: "INPUT_TIME",
  MULTIPLE_CHOICE_OPTION: "MULTIPLE_CHOICE",
  CHECKBOX: "CHECKBOXES",
  DROPDOWN_OPTION: "DROPDOWN",
  MULTI_SELECT_OPTION: "MULTI_SELECT",
  RATING: "RATING",
  LINEAR_SCALE: "LINEAR_SCALE",
  RANKING_OPTION: "RANKING",
  MATRIX_ROW: "MATRIX",
  MATRIX_COLUMN: "MATRIX",
  FILE_UPLOAD: "FILE_UPLOAD",
  SIGNATURE: "SIGNATURE",
};

/** The question type an input block answers, or null for non-input blocks. */
export function questionTypeOfBlock(block: Block): QuestionType | null {
  return QUESTION_TYPE_BY_BLOCK_TYPE[block.type] ?? null;
}

export function isOptionBlock(block: Block): boolean {
  return (Object.values(OPTION_BLOCK_TYPES) as string[]).includes(block.type);
}

/** Blocks a question lists one per entry: options, matrix rows and columns. */
export function isListItemBlock(block: Block): boolean {
  return (
    isOptionBlock(block) ||
    block.type === "MATRIX_ROW" ||
    block.type === "MATRIX_COLUMN"
  );
}

export function isMediaBlock(block: Block): boolean {
  return (MEDIA_BLOCK_TYPES as readonly string[]).includes(block.type);
}

export function createBlock<T extends BlockType>(
  type: T,
  payload: PayloadByType[T],
  ids: { uuid?: string; groupUuid?: string; groupType?: GroupType } = {},
): Block<T> {
  const uuid = ids.uuid ?? newId();
  return {
    uuid,
    type,
    groupUuid: ids.groupUuid ?? uuid,
    groupType: ids.groupType ?? questionTypeOfBlock({ type } as Block) ?? type,
    payload,
  } as Block<T>;
}

export function blankFormBlocks(): Block[] {
  return [createBlock("FORM_TITLE", { text: "" })];
}

export type QuestionSpec = {
  type: QuestionType;
  title: string;
  /** Stable group id; block uuids derive from it so fixtures stay diffable. */
  id?: string;
  isRequired?: boolean | undefined;
  placeholder?: string | undefined;
  /** Option labels, for the choice and ranking question types. */
  options?: string[] | undefined;
  /** Matrix row and column labels. */
  rows?: string[] | undefined;
  columns?: string[] | undefined;
  /** Extra payload keys for the input blocks, such as `stars` or `minNumber`. */
  settings?: Record<string, unknown>;
};

/** A TITLE block followed by the input block, or one block per option. */
export function questionBlocks(spec: QuestionSpec): Block[] {
  const groupUuid = spec.id ?? newId();
  const uuidFor = (suffix: string) =>
    spec.id ? `${spec.id}:${suffix}` : newId();
  const title = createBlock(
    "TITLE",
    { text: spec.title },
    { uuid: uuidFor("title"), groupUuid, groupType: "QUESTION" },
  );
  const shared = {
    isRequired: spec.isRequired ?? false,
    ...spec.settings,
  };
  if (spec.type in OPTION_BLOCK_TYPES) {
    const optionType =
      OPTION_BLOCK_TYPES[spec.type as keyof typeof OPTION_BLOCK_TYPES];
    const labels = spec.options ?? [];
    const multiple = spec.type === "CHECKBOXES" || spec.type === "MULTI_SELECT";
    return [
      title,
      ...labels.map((text, index) =>
        createBlock(
          optionType,
          {
            ...shared,
            text,
            index,
            isFirst: index === 0,
            isLast: index === labels.length - 1,
            isOtherOption: false,
            allowMultiple: multiple,
          },
          { uuid: uuidFor(`option-${index}`), groupUuid, groupType: spec.type },
        ),
      ),
    ];
  }
  if (spec.type === "MATRIX") {
    const line = (type: "MATRIX_ROW" | "MATRIX_COLUMN", labels: string[]) =>
      labels.map((text, index) =>
        createBlock(
          type,
          {
            ...shared,
            text,
            index,
            isFirst: index === 0,
            isLast: index === labels.length - 1,
          },
          { uuid: uuidFor(`${type}-${index}`), groupUuid, groupType: "MATRIX" },
        ),
      );
    return [
      title,
      ...line("MATRIX_ROW", spec.rows ?? []),
      ...line("MATRIX_COLUMN", spec.columns ?? []),
    ];
  }
  const inputType = spec.type as Exclude<
    QuestionType,
    keyof typeof OPTION_BLOCK_TYPES | "MATRIX"
  >;
  const defaults = inputType === "RATING" ? { stars: 5 } : {};
  const payload = {
    ...defaults,
    ...shared,
    ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
  };
  return [
    title,
    createBlock(inputType, payload as PayloadByType[typeof inputType], {
      uuid: uuidFor("input"),
      groupUuid,
      groupType: inputType,
    }),
  ];
}

export function blockText(block: Block): string {
  const text = (block.payload as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/** The form title as typed; empty when the author has not named it yet. */
export function formTitleOf(blocks: readonly Block[]): string {
  const title = blocks.find((block) => block.type === "FORM_TITLE");
  return title ? blockText(title).trim() : "";
}

const TEXT_BLOCK_TYPES: readonly BlockType[] = [
  "FORM_TITLE",
  "TEXT",
  "TITLE",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
];

/** True when nothing has been authored: no content, only an empty title. */
export function isFormEmpty(blocks: readonly Block[]): boolean {
  return blocks.every(
    (block) =>
      TEXT_BLOCK_TYPES.includes(block.type) && blockText(block).trim() === "",
  );
}
