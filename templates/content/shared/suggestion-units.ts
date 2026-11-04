import type { MarkdownSuggestionOperation } from "./suggestion-diff.js";

// Every runtime this serves has Intl.Segmenter; its types arrive with ES2022.
const sentences = new (
  Intl as unknown as {
    Segmenter: new (
      locales: undefined,
      options: { granularity: "sentence" },
    ) => { segment(text: string): Iterable<{ index: number }> };
  }
).Segmenter(undefined, { granularity: "sentence" });

// The segmenter ends a sentence at any period before a capital, which cuts
// "Dr. Lee" in two. A wrong join costs a choice but a wrong split breaks text,
// so a period after one of these never ends a sentence.
const ABBREVIATION_END =
  /(?:^|[\s("'])(?:Dr|Mr|Mrs|Ms|Mx|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Corp|[A-Z](?:\.[A-Z])*)\.\s*$/;

/** Where each sentence after the first starts in this text. */
function sentenceStarts(text: string) {
  const starts: number[] = [];
  for (const { index } of sentences.segment(text)) {
    const tail = text.slice(Math.max(0, index - 16), index);
    if (index > 0 && !ABBREVIATION_END.test(tail)) starts.push(index);
  }
  return starts;
}

/**
 * Whether the unchanged text between two pieces of an edit ends one sentence
 * and starts another. Pieces with no unchanged word between them only make
 * sense together, wherever they fall.
 */
function separatesSentences(source: string, from: number, to: number) {
  const between = source.slice(from, to);
  if (!/[\p{L}\p{N}]/u.test(between)) return false;
  if (between.includes("\n")) return true;
  // What follows decides whether a period ended the sentence.
  const lineEnd = source.indexOf("\n", to);
  const line = source.slice(from, lineEnd < 0 ? undefined : lineEnd);
  return sentenceStarts(line).some((index) => index <= between.length);
}

/**
 * The review unit of each piece of a split edit, as an ordinal: the pieces a
 * reviewer takes or leaves together, so no sentence is half taken. A piece
 * that crosses a sentence boundary has no unchanged text there, so it joins
 * the sentences it touches. Pieces of an agent's separate edits never join,
 * since the agent split them on purpose.
 */
export function sentenceUnits(
  operations: readonly Pick<MarkdownSuggestionOperation, "before" | "anchor">[],
  edits: readonly { start: number; find: string }[] = [],
): number[] {
  const editOf = ({ anchor }: Pick<MarkdownSuggestionOperation, "anchor">) =>
    edits.findIndex(
      ({ start, find }) =>
        anchor.from >= start && anchor.to <= start + find.length,
    );
  let unit = 0;
  return operations.map((operation, index) => {
    const previous = index > 0 ? operations[index - 1] : undefined;
    if (
      previous &&
      (editOf(previous) !== editOf(operation) ||
        separatesSentences(
          operation.before.markdown,
          previous.anchor.to,
          operation.anchor.from,
        ))
    ) {
      unit += 1;
    }
    return unit;
  });
}
