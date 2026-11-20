import type { useT } from "@agent-native/core/client/i18n";
import {
  blankFormBlocks,
  createBlock,
  deriveQuestions,
  isListItemBlock,
  newId,
  questionBlocks,
  questionTypeOfBlock,
  type Block,
  type BlockType,
  type Condition,
  type MediaBlockType,
  type QuestionType,
} from "@shared/form-model";

export type T = ReturnType<typeof useT>;

/** What the editor lays out: a whole question, or one standalone block. */
export type Item =
  | { kind: "question"; id: string; blocks: Block[] }
  | { kind: "block"; id: string; block: Block };

function isQuestionPart(block: Block): boolean {
  return block.type === "TITLE" || questionTypeOfBlock(block) !== null;
}

export function toItems(blocks: readonly Block[]): Item[] {
  const items: Item[] = [];
  const questions = new Map<string, Extract<Item, { kind: "question" }>>();
  for (const block of blocks) {
    if (!isQuestionPart(block)) {
      items.push({ kind: "block", id: block.uuid, block });
      continue;
    }
    const existing = questions.get(block.groupUuid);
    if (existing) existing.blocks.push(block);
    else {
      const item = {
        kind: "question" as const,
        id: block.groupUuid,
        blocks: [block],
      };
      questions.set(block.groupUuid, item);
      items.push(item);
    }
  }
  return items;
}

function fromItems(items: readonly Item[]): Block[] {
  return items.flatMap((item) =>
    item.kind === "question" ? item.blocks : [item.block],
  );
}

/** The item a block belongs to: its question group, or itself. */
export function itemIdOf(blocks: readonly Block[], uuid: string): string {
  const block = blocks.find((candidate) => candidate.uuid === uuid);
  return block && isQuestionPart(block) ? block.groupUuid : uuid;
}

export function withFormTitle(blocks: readonly Block[]): Block[] {
  return blocks[0]?.type === "FORM_TITLE"
    ? [...blocks]
    : [...blankFormBlocks(), ...blocks];
}

export type InsertKind =
  | QuestionType
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
  | MediaBlockType;

export function isMediaKind(kind: InsertKind): kind is MediaBlockType {
  return (
    kind === "IMAGE" ||
    kind === "EMBED_VIDEO" ||
    kind === "EMBED_AUDIO" ||
    kind === "EMBED_MAP" ||
    kind === "EMBED_LINK"
  );
}

export function emptyText(): Block {
  return createBlock("TEXT", { text: "" });
}

/** The previous question on the same page, so a new rule starts on it. */
function previousQuestionId(
  blocks: readonly Block[],
  index: number,
): string | null {
  let found: string | null = null;
  for (const block of blocks.slice(0, index)) {
    if (block.type === "PAGE_BREAK" || block.type === "THANK_YOU_PAGE")
      found = null;
    else if (block.type === "TITLE") found = block.groupUuid;
  }
  return found;
}

/** `before` is how many blocks precede the insertion point. */
export function makeBlocks(
  kind: InsertKind,
  blocks: readonly Block[] = [],
  before = blocks.length,
): Block[] {
  switch (kind) {
    case "TEXT":
      return [emptyText()];
    case "HEADING_1":
    case "HEADING_2":
    case "HEADING_3":
      return [createBlock(kind, { text: "" })];
    case "DIVIDER":
      return [createBlock("DIVIDER", {})];
    case "PAGE_BREAK":
      return [createBlock("PAGE_BREAK", {})];
    case "THANK_YOU_PAGE":
      return [createBlock("THANK_YOU_PAGE", {})];
    case "HIDDEN_FIELDS":
      return [
        createBlock("HIDDEN_FIELDS", { fields: [{ id: newId(), name: "" }] }),
      ];
    case "CALCULATED_FIELDS":
      return [
        createBlock("CALCULATED_FIELDS", {
          fields: [{ id: newId(), name: "" }],
        }),
      ];
    case "CONDITIONAL_LOGIC": {
      const questionId = previousQuestionId(blocks, before);
      const condition: Condition | null = questionId
        ? { type: "single", questionId, comparison: "is" }
        : null;
      return [createBlock("CONDITIONAL_LOGIC", { condition, actions: [] })];
    }
    case "LINEAR_SCALE":
      return questionBlocks({
        type: kind,
        title: "",
        settings: { start: 1, end: 5, step: 1 },
      });
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
    case "DROPDOWN":
    case "MULTI_SELECT":
    case "RANKING":
      return questionBlocks({ type: kind, title: "", options: [""] });
    case "MATRIX":
      return questionBlocks({
        type: kind,
        title: "",
        rows: ["", "", ""],
        columns: ["", "", ""],
      });
    case "IMAGE":
    case "EMBED_VIDEO":
    case "EMBED_AUDIO":
    case "EMBED_MAP":
    case "EMBED_LINK":
      return [createBlock(kind, {})];
    case "INPUT_TEXT":
    case "TEXTAREA":
    case "INPUT_EMAIL":
    case "INPUT_NUMBER":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
    case "INPUT_DATE":
    case "INPUT_TIME":
    case "RATING":
    case "FILE_UPLOAD":
    case "SIGNATURE":
      return questionBlocks({ type: kind, title: "" });
  }
}

/** Index just past the item that holds `uuid`; 0 when `uuid` is null. */
export function indexAfterItem(
  blocks: readonly Block[],
  uuid: string | null,
): number {
  if (!uuid) return 0;
  const id = itemIdOf(blocks, uuid);
  let last = -1;
  blocks.forEach((block, index) => {
    if (block.uuid === id || (isQuestionPart(block) && block.groupUuid === id))
      last = index;
  });
  return last + 1;
}

export function insertAt(
  blocks: readonly Block[],
  index: number,
  added: readonly Block[],
): Block[] {
  return [...blocks.slice(0, index), ...added, ...blocks.slice(index)];
}

export function replaceBlock(
  blocks: readonly Block[],
  uuid: string,
  added: readonly Block[],
): Block[] {
  const index = blocks.findIndex((block) => block.uuid === uuid);
  if (index < 0) return [...blocks];
  return [...blocks.slice(0, index), ...added, ...blocks.slice(index + 1)];
}

export function removeBlock(blocks: readonly Block[], uuid: string): Block[] {
  return blocks.filter((block) => block.uuid !== uuid);
}

export function removeItem(blocks: readonly Block[], id: string): Block[] {
  return blocks.filter(
    (block) =>
      block.uuid !== id && !(isQuestionPart(block) && block.groupUuid === id),
  );
}

/** Moves a whole item one slot; the form title never moves. */
export function moveItem(
  blocks: readonly Block[],
  id: string,
  delta: -1 | 1,
): Block[] {
  const [title, ...rest] = blocks;
  if (title?.type !== "FORM_TITLE") return [...blocks];
  const items = toItems(rest);
  const from = items.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return [...blocks];
  const moved = items[from];
  const swapped = items[to];
  if (!moved || !swapped) return [...blocks];
  items[from] = swapped;
  items[to] = moved;
  return [title, ...fromItems(items)];
}

/** Drag-and-drop move: puts item `id` before or after item `targetId`. */
export function moveItemTo(
  blocks: readonly Block[],
  id: string,
  targetId: string,
  side: "before" | "after",
): Block[] {
  const [title, ...rest] = blocks;
  if (title?.type !== "FORM_TITLE" || id === targetId) return [...blocks];
  const items = toItems(rest);
  const moved = items.find((item) => item.id === id);
  if (!moved) return [...blocks];
  const others = items.filter((item) => item.id !== id);
  const at = others.findIndex((item) => item.id === targetId);
  if (at < 0) return [...blocks];
  others.splice(side === "before" ? at : at + 1, 0, moved);
  return [title, ...fromItems(others)];
}

export function patchBlock(
  blocks: readonly Block[],
  uuid: string,
  patch: Record<string, unknown>,
): Block[] {
  return blocks.map((block) =>
    block.uuid === uuid
      ? ({ ...block, payload: { ...block.payload, ...patch } } as Block)
      : block,
  );
}

export function setText(
  blocks: readonly Block[],
  uuid: string,
  text: string,
): Block[] {
  return patchBlock(blocks, uuid, { text });
}

/** Settings live on every input block of the group; the first one is read. */
export function patchQuestion(
  blocks: readonly Block[],
  groupId: string,
  patch: Record<string, unknown>,
): Block[] {
  return blocks.map((block) =>
    block.groupUuid === groupId && questionTypeOfBlock(block)
      ? ({ ...block, payload: { ...block.payload, ...patch } } as Block)
      : block,
  );
}

export function questionSettings(
  blocks: readonly Block[],
  groupId: string,
): { type: QuestionType; payload: Record<string, unknown> } | null {
  const input = blocks.find(
    (block) => block.groupUuid === groupId && questionTypeOfBlock(block),
  );
  const type = input ? questionTypeOfBlock(input) : null;
  return input && type ? { type, payload: input.payload } : null;
}

/** Re-numbers each kind of list entry in the group (options, rows, columns) from 0. */
function reindexOptions(blocks: Block[], groupId: string): Block[] {
  return blocks.map((block) => {
    if (block.groupUuid !== groupId || !isListItemBlock(block)) return block;
    const siblings = siblingsOf(blocks, block);
    const position = siblings.indexOf(block);
    return {
      ...block,
      payload: {
        ...block.payload,
        index: position,
        isFirst: position === 0,
        isLast: position === siblings.length - 1,
      },
    } as Block;
  });
}

/** A new empty option after `optionUuid`, carrying the group's settings. */
export function addOptionAfter(
  blocks: readonly Block[],
  optionUuid: string,
): { blocks: Block[]; added: string } {
  const index = blocks.findIndex((block) => block.uuid === optionUuid);
  const base = blocks[index];
  if (!base) return { blocks: [...blocks], added: optionUuid };
  const added = createBlock(
    base.type as BlockType,
    { ...base.payload, text: "", isOtherOption: false } as never,
    { groupUuid: base.groupUuid, groupType: base.groupType },
  );
  const next = [
    ...blocks.slice(0, index + 1),
    added,
    ...blocks.slice(index + 1),
  ];
  return { blocks: reindexOptions(next, base.groupUuid), added: added.uuid };
}

export function removeOption(
  blocks: readonly Block[],
  optionUuid: string,
): Block[] {
  const option = blocks.find((block) => block.uuid === optionUuid);
  if (!option) return [...blocks];
  return reindexOptions(removeBlock(blocks, optionUuid), option.groupUuid);
}

/** Every list entry of a question, in order: options, or a matrix's rows then columns. */
export function optionsOf(blocks: readonly Block[], groupId: string): Block[] {
  return blocks.filter(
    (block) => block.groupUuid === groupId && isListItemBlock(block),
  );
}

/** The entries of the same kind as `block` in its question: the options, rows or columns. */
export function siblingsOf(blocks: readonly Block[], block: Block): Block[] {
  return blocks.filter(
    (other) => other.groupUuid === block.groupUuid && other.type === block.type,
  );
}

/** Turns a page break into the thank-you page and back, keeping its uuid. */
export function toggleThankYou(
  blocks: readonly Block[],
  uuid: string,
): Block[] {
  return blocks.map((block) => {
    if (block.uuid !== uuid) return block;
    if (block.type === "THANK_YOU_PAGE")
      return { ...block, type: "PAGE_BREAK", groupType: "PAGE_BREAK" } as Block;
    if (block.type === "PAGE_BREAK")
      return {
        ...block,
        type: "THANK_YOU_PAGE",
        groupType: "THANK_YOU_PAGE",
      } as Block;
    return block;
  });
}

/** A break's label number: page breaks are Page 2, 3, ... in order. */
export function pageNumberOf(blocks: readonly Block[], uuid: string): number {
  let number = 1;
  for (const block of blocks) {
    if (block.type === "PAGE_BREAK") number += 1;
    if (block.uuid === uuid) return number;
  }
  return number;
}

/** Page break blocks a rule can jump to, labelled by page number. */
export function jumpTargets(
  blocks: readonly Block[],
  t: T,
): { id: string; label: string }[] {
  const targets: { id: string; label: string }[] = [];
  let number = 1;
  for (const block of blocks) {
    if (block.type === "PAGE_BREAK") {
      number += 1;
      targets.push({
        id: block.uuid,
        label: t("forms.blocks.pageN", { number }),
      });
    }
  }
  return targets;
}

/** Questions that sit on the same page as the block `uuid`. */
export function questionsOnPageOf(blocks: readonly Block[], uuid: string) {
  const all = deriveQuestions(blocks);
  const page = pageIndexOf(blocks, uuid);
  const onPage = new Set(
    blocks
      .filter(
        (block, index) =>
          block.type === "TITLE" && pageIndexAt(blocks, index) === page,
      )
      .map((block) => block.groupUuid),
  );
  return all.filter(
    (question) =>
      onPage.has(question.id) ||
      question.type === "HIDDEN_FIELD" ||
      question.type === "CALCULATED_FIELD",
  );
}

function pageIndexAt(blocks: readonly Block[], index: number): number {
  let page = 0;
  for (const block of blocks.slice(0, index + 1)) {
    if (block.type === "PAGE_BREAK" || block.type === "THANK_YOU_PAGE")
      page += 1;
  }
  return page;
}

function pageIndexOf(blocks: readonly Block[], uuid: string): number {
  return pageIndexAt(
    blocks,
    blocks.findIndex((block) => block.uuid === uuid),
  );
}

/** Blocks a show/hide/require rule can target on the page of `uuid`. */
export function targetsOnPageOf(
  blocks: readonly Block[],
  uuid: string,
  t: T,
): { id: string; label: string }[] {
  const page = pageIndexOf(blocks, uuid);
  const seen = new Set<string>();
  const targets: { id: string; label: string }[] = [];
  blocks.forEach((block, index) => {
    if (pageIndexAt(blocks, index) !== page) return;
    if (block.type === "TITLE") {
      if (seen.has(block.groupUuid)) return;
      seen.add(block.groupUuid);
      const title = (block.payload as { text?: string }).text ?? "";
      targets.push({
        id: block.groupUuid,
        label: title || t("forms.editor.untitledQuestion"),
      });
      return;
    }
    if (
      block.type === "TEXT" ||
      block.type === "HEADING_1" ||
      block.type === "HEADING_2" ||
      block.type === "HEADING_3"
    ) {
      const text = (block.payload as { text?: string }).text ?? "";
      if (text) targets.push({ id: block.uuid, label: text });
    }
  });
  return targets;
}
