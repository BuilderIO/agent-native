import {
  blockText,
  createBlock,
  formTitleOf,
  type Block,
} from "@shared/form-model";

/** Replaces the blank form's content, keeping a title the author already typed. */
export function withImportedContent(
  current: Block[],
  title: string,
  content: Block[],
): Block[] {
  const first = current[0];
  const typed = formTitleOf(current);
  const head =
    first?.type === "FORM_TITLE"
      ? { ...first, payload: { ...first.payload, text: typed || title } }
      : createBlock("FORM_TITLE", { text: title });
  return [head, ...content];
}

/** A template's block list as a title and content. */
export function splitTemplate(blocks: Block[]): {
  title: string;
  content: Block[];
} {
  const [first, ...content] = blocks;
  return { title: first ? blockText(first) : "", content };
}
