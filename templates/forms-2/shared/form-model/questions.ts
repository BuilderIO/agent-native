import { isOptionBlock, blockText, questionTypeOfBlock } from "./blocks.js";
import { splitPages } from "./pages.js";
import type { Block, DerivedQuestion, QuestionOption } from "./types.js";

function isRequiredFlag(block: Block): boolean {
  return (block.payload as { isRequired?: unknown }).isRequired === true;
}

/** One answer column per named field; a calculated field also needs a type. */
function fieldQuestions(
  block: Block,
  pageNumber: number,
  start: number,
): DerivedQuestion[] {
  const named = (
    block.type === "HIDDEN_FIELDS" || block.type === "CALCULATED_FIELDS"
      ? block.payload.fields
      : []
  ).filter((field) => field.name.trim() !== "");
  const found = named.flatMap((field) => {
    const isHidden = block.type === "HIDDEN_FIELDS";
    if (!isHidden && !("type" in field && field.type)) return [];
    return [
      {
        id: field.id,
        type: isHidden ? "HIDDEN_FIELD" : "CALCULATED_FIELD",
        title: field.name.trim(),
        position: start,
        pageNumber,
        isRequired: false,
        options: [],
        rows: [],
        settings: block,
      } satisfies DerivedQuestion,
    ];
  });
  return found.map((question, index) => ({
    ...question,
    position: start + index,
  }));
}

/**
 * Questions in form order. A question is the group of blocks sharing a
 * `groupUuid` that holds at least one input block; its TITLE block names it.
 * Settings live on the first input block of the group.
 */
export function deriveQuestions(blocks: readonly Block[]): DerivedQuestion[] {
  const questions: DerivedQuestion[] = [];
  for (const page of splitPages(blocks)) {
    const groups = new Map<string, Block[]>();
    for (const block of page.blocks) {
      const group = groups.get(block.groupUuid);
      if (group) group.push(block);
      else groups.set(block.groupUuid, [block]);
    }
    for (const [groupUuid, group] of groups) {
      const fieldBlock = group.find(
        (block) =>
          block.type === "HIDDEN_FIELDS" || block.type === "CALCULATED_FIELDS",
      );
      if (fieldBlock) {
        questions.push(
          ...fieldQuestions(fieldBlock, page.number, questions.length),
        );
        continue;
      }
      if (page.isThankYou) continue;
      const inputs = group.filter((block) => questionTypeOfBlock(block));
      const first = inputs[0];
      const type = first ? questionTypeOfBlock(first) : null;
      if (!first || !type) continue;
      const title = group.find((block) => block.type === "TITLE");
      const entry = (block: Block): QuestionOption => ({
        id: block.uuid,
        text: blockText(block),
        isOther:
          (block.payload as { isOtherOption?: unknown }).isOtherOption === true,
      });
      const options = inputs
        .filter(
          (block) => isOptionBlock(block) || block.type === "MATRIX_COLUMN",
        )
        .map(entry);
      const rows = inputs
        .filter((block) => block.type === "MATRIX_ROW")
        .map(entry);
      questions.push({
        id: groupUuid,
        type,
        title: title ? blockText(title).trim() : "",
        position: questions.length,
        pageNumber: page.number,
        isRequired: isRequiredFlag(first),
        options,
        rows,
        settings: first,
      });
    }
  }
  return questions;
}
