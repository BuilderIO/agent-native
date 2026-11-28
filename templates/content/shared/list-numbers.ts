import {
  canonicalizeNfm,
  closesFence,
  FENCE_CLOSE,
  matchFenceOpen,
} from "./nfm.js";

export const ORDERED_ITEM = /^(\t*)(\d+)([.)] )/;

export interface OrderedItem {
  indent: string;
  digits: string;
  marker: string;
}

interface Range {
  from: number;
  to: number;
}

export interface MaskedListNumbers {
  text: string;
  numbers: Range[];
}

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return items[index];
}

export function orderedItem(line: string): OrderedItem | null {
  const match = ORDERED_ITEM.exec(line);
  if (!match) return null;
  const indent = itemAt(match, 1);
  const digits = itemAt(match, 2);
  const marker = itemAt(match, 3);
  return indent === undefined || digits === undefined || marker === undefined
    ? null
    : { indent, digits, marker };
}

export function orderedItems(markdown: string): Array<OrderedItem | null> {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    const text = line.replace(/^\t+/, "");
    if (fence) {
      if (closesFence(text.match(FENCE_CLOSE), fence)) fence = null;
      return null;
    }
    fence = matchFenceOpen(text)?.[1] ?? null;
    return fence ? null : orderedItem(line);
  });
}

export function maskListNumbers(markdown: string): MaskedListNumbers {
  const items = orderedItems(markdown);
  const numbers: Range[] = [];
  let text = "";
  let offset = 0;
  for (const [index, line] of markdown.split("\n").entries()) {
    const item = itemAt(items, index);
    if (item) {
      const from = offset + item.indent.length;
      numbers.push({ from, to: from + item.digits.length });
      text += `${item.indent}0${line.slice(item.indent.length + item.digits.length)}`;
    } else {
      text += line;
    }
    offset += line.length + 1;
    text += "\n";
  }
  return { text: text.slice(0, -1), numbers };
}

export function maskedOffset(
  masked: MaskedListNumbers,
  offset: number,
): number | null {
  let shift = 0;
  for (const number of masked.numbers) {
    if (number.from >= offset) break;
    if (number.to > offset) return null;
    shift += number.to - number.from - 1;
  }
  return offset - shift;
}

export function unmaskedOffset(
  masked: MaskedListNumbers,
  offset: number,
): number {
  let shift = 0;
  for (const number of masked.numbers) {
    const from = number.from - shift;
    if (from >= offset) break;
    shift += number.to - number.from - 1;
  }
  return offset + shift;
}

function numberedLines(markdown: string) {
  const items = orderedItems(markdown);
  return markdown.split("\n").flatMap((line, index) => {
    const item = itemAt(items, index);
    return item
      ? [
          {
            index,
            item,
            rest: line.slice(item.indent.length + item.digits.length),
          },
        ]
      : [];
  });
}

export function withListNumbersInOrder(markdown: string): string {
  const numbered = numberedLines(markdown);
  const renumbered = numberedLines(canonicalizeNfm(markdown));
  if (numbered.length !== renumbered.length) return markdown;
  const lines = markdown.split("\n");
  for (const [position, line] of numbered.entries()) {
    const canonical = itemAt(renumbered, position);
    if (
      !canonical ||
      canonical.item.indent !== line.item.indent ||
      canonical.rest !== line.rest
    )
      return markdown;
    lines[line.index] =
      `${line.item.indent}${canonical.item.digits}${line.rest}`;
  }
  return lines.join("\n");
}
