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

interface Placed {
  node: ProseMirrorNode;
  at: number;
}

/** The blocks by their text, so finding a block's copies stays linear. */
function byText(blocks: Textblock[]) {
  const found = new Map<string, Placed[]>();
  for (const [at, { node }] of blocks.entries()) {
    const copies = found.get(node.textContent);
    if (copies) copies.push({ node, at });
    else found.set(node.textContent, [{ node, at }]);
  }
  return found;
}

/** Where the one block with the content of `node` is, or -1 when none or several are. */
function soleCopy(blocks: Map<string, Placed[]>, node: ProseMirrorNode) {
  let at = -1;
  let copies = 0;
  for (const other of blocks.get(node.textContent) ?? []) {
    if (!other.node.eq(node)) continue;
    at = other.at;
    copies += 1;
  }
  return copies === 1 ? at : -1;
}

/**
 * Where block `index` of the old changed stretch is in the new one. A block
 * found exactly once on each side anchors the two stretches; such a block
 * goes to its copy. Another block keeps its place between the anchors around
 * it when both sides hold the same number of blocks there, and otherwise
 * blocks were added or removed next to it, so there's no sure match.
 */
function changedStretchMatch(
  before: Textblock[],
  after: Textblock[],
  index: number,
): number | null {
  const beforeByText = byText(before);
  const afterByText = byText(after);
  let previous = { before: -1, after: -1 };
  let next = { before: before.length, after: after.length };
  for (const [at, { node }] of before.entries()) {
    if (soleCopy(beforeByText, node) !== at) continue;
    const copy = soleCopy(afterByText, node);
    if (copy < 0) continue;
    if (at === index) return copy;
    if (at < index) previous = { before: at, after: copy };
    else {
      next = { before: at, after: copy };
      break;
    }
  }
  return next.before - previous.before === next.after - previous.after
    ? previous.after + index - previous.before
    : null;
}

/**
 * Where a caret at `position` in `before` belongs in `after`, a newer Page
 * swapped in under it. The swap replaces every block from the first change to
 * the last, which sends a caret anywhere in between to the end of that
 * stretch. This finds the caret's paragraph by the unchanged paragraphs around
 * it, then its place in that paragraph by the text that didn't change. Null
 * when the paragraphs around it were added or removed, or the paragraph in its
 * place shares little of its text, so no match is sure.
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
  else {
    const at = changedStretchMatch(
      oldBlocks.slice(same, oldBlocks.length - sameAtEnd),
      newBlocks.slice(same, newBlocks.length - sameAtEnd),
      index - same,
    );
    if (at !== null) match = newBlocks[same + at];
  }
  if (!match) return null;

  const oldText = flatText($position.parent);
  const newText = flatText(match.node);
  const offset = $position.parentOffset;
  const prefix = commonPrefixLength(oldText, newText);
  const suffix = Math.min(
    commonSuffixLength(oldText, newText),
    Math.min(oldText.length, newText.length) - prefix,
  );
  // A paragraph matched by its place keeps most of its text. One that doesn't
  // is another paragraph that took the place of the caret's.
  if (2 * (prefix + suffix) < Math.min(oldText.length, newText.length))
    return null;
  const fromEnd = oldText.length - offset;
  const newOffset =
    offset <= prefix
      ? offset
      : fromEnd <= suffix
        ? newText.length - fromEnd
        : prefix;
  return match.start + newOffset;
}
