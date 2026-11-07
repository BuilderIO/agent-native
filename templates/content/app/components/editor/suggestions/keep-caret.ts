import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

interface Textblock {
  node: ProseMirrorNode;
  /** The position of its first character. */
  start: number;
}

function textblocks(doc: ProseMirrorNode): Textblock[] {
  const found: Textblock[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    found.push({ node, start: position + 1 });
    return false;
  });
  return found;
}

// One character per position, so an index into it is an offset in the block.
function flatText(node: ProseMirrorNode) {
  return node.textBetween(0, node.content.size, undefined, "￼");
}

function commonPrefixLength(a: string, b: string) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length])
    length++;
  return length;
}

function commonSuffixLength(a: string, b: string) {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  )
    length++;
  return length;
}

/**
 * Where a caret at `position` in `before` belongs in `after`, a newer Page
 * swapped in under it. The swap replaces every block from the first change to
 * the last, which sends a caret anywhere in between to the end of that
 * stretch. This finds the caret's paragraph by the unchanged paragraphs around
 * it, then its place in that paragraph by the text that didn't change. Null
 * when the paragraphs around it were added or removed, so no match is sure.
 */
export function caretAfterPageSwap(
  before: ProseMirrorNode,
  position: number,
  after: ProseMirrorNode,
): number | null {
  const $position = before.resolve(position);
  if (!$position.parent.isTextblock) return null;
  const oldBlocks = textblocks(before);
  const newBlocks = textblocks(after);
  const index = oldBlocks.findIndex(({ start }) => start === $position.start());
  if (index < 0) return null;

  const unchanged = (first?: Textblock, second?: Textblock) =>
    !!first && !!second && first.node.eq(second.node);
  let same = 0;
  while (unchanged(oldBlocks[same], newBlocks[same])) same++;
  let sameAtEnd = 0;
  while (
    same + sameAtEnd < Math.min(oldBlocks.length, newBlocks.length) &&
    unchanged(
      oldBlocks[oldBlocks.length - 1 - sameAtEnd],
      newBlocks[newBlocks.length - 1 - sameAtEnd],
    )
  )
    sameAtEnd++;
  const shift = newBlocks.length - oldBlocks.length;
  let match: Textblock | undefined;
  if (index < same) match = newBlocks[index];
  else if (index >= oldBlocks.length - sameAtEnd)
    match = newBlocks[index + shift];
  else if (shift === 0) match = newBlocks[index];
  if (!match) return null;

  const oldText = flatText($position.parent);
  const newText = flatText(match.node);
  const offset = $position.parentOffset;
  const prefix = commonPrefixLength(oldText, newText);
  const suffix = Math.min(
    commonSuffixLength(oldText, newText),
    Math.min(oldText.length, newText.length) - prefix,
  );
  const fromEnd = oldText.length - offset;
  const newOffset =
    offset <= prefix
      ? offset
      : fromEnd <= suffix
        ? newText.length - fromEnd
        : prefix;
  return match.start + newOffset;
}
