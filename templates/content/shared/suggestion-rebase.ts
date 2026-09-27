import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import { canonicalizeNfm, docToNfm, nfmToDoc } from "./nfm";

type ContextualMarkdownOperation = {
  before?: unknown;
  after?: unknown;
  anchor?: unknown;
};

type MarkdownPayload = { markdown: string; changedText: string };
type MarkdownAnchor = {
  from: number;
  to: number;
  prefix: string;
  suffix: string;
};

function isPayload(value: unknown): value is MarkdownPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MarkdownPayload>;
  return (
    typeof payload.markdown === "string" &&
    payload.markdown.length <= 1_000_000 &&
    typeof payload.changedText === "string"
  );
}

function blockRanges(markdown: string) {
  const blocks = nfmToDoc(markdown).content ?? [];
  const serialized = blocks.map((block) =>
    docToNfm({ type: "doc", content: [block] }),
  );
  if (serialized.join("\n") !== markdown) return [];
  let offset = 0;
  return blocks.map((block, index) => {
    const text = serialized[index];
    const from = offset;
    offset += text.length + 1;
    return {
      text,
      from,
      to: from + text.length,
      paragraph:
        block.type === "paragraph" &&
        !block.attrs?.indent &&
        text.length > 0 &&
        !text.includes("\n"),
    };
  });
}

function resolveParagraphRange(
  before: string,
  current: string,
  anchor: MarkdownAnchor,
) {
  const original = blockRanges(before);
  const updated = blockRanges(current);
  if (original.length !== updated.length) return null;
  const block = original.find(
    (candidate) =>
      candidate.paragraph &&
      anchor.from >= candidate.from &&
      anchor.to <= candidate.to,
  );
  if (
    !block ||
    original.filter((candidate) => candidate.text === block.text).length !== 1
  )
    return null;
  const matches = updated.filter((candidate) => candidate.text === block.text);
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    if (
      !matches[0].paragraph ||
      updated.indexOf(matches[0]) !== original.indexOf(block)
    )
      return null;
    const shift = matches[0].from - block.from;
    return { from: anchor.from + shift, to: anchor.to + shift };
  }
  const index = original.indexOf(block);
  const localAnchor = {
    from: anchor.from - block.from,
    to: anchor.to - block.from,
  };
  const candidates = updated.flatMap((candidate, ordinal) => {
    if (!candidate.paragraph) return [];
    const range = resolveOutsideChange(block.text, candidate.text, localAnchor);
    return range ? [{ ...range, ordinal, offset: candidate.from }] : [];
  });
  if (candidates.length !== 1 || candidates[0].ordinal !== index) return null;
  const range = candidates[0];
  const reverse = original.filter(
    (candidate) =>
      candidate.paragraph &&
      resolveOutsideChange(updated[index].text, candidate.text, range),
  );
  if (reverse.length !== 1 || reverse[0] !== block) return null;
  return { from: range.from + range.offset, to: range.to + range.offset };
}

function resolveCanonicalizedRange(
  before: string,
  current: string,
  anchor: MarkdownAnchor,
) {
  if (canonicalizeNfm(before) !== current) return null;
  const target = before.slice(anchor.from, anchor.to);
  if (!target)
    return resolveCanonicalizedInsertion(before, current, anchor.from);
  if (!target.trim()) return null;
  const range = resolveUnchangedCanonicalRange(
    before,
    current,
    anchor.from,
    anchor.to,
  );
  if (
    !range ||
    current.indexOf(target) !== range.from ||
    current.indexOf(target, range.from + 1) >= 0
  )
    return null;
  return range;
}

function resolveUnchangedCanonicalRange(
  before: string,
  current: string,
  from: number,
  to: number,
) {
  const differ = new DiffMatchPatch();
  const diffs = differ.diff_main(before, current, true);
  let beforeOffset = 0;
  let currentOffset = 0;
  for (const [operation, text] of diffs) {
    if (operation === DIFF_EQUAL) {
      const end = beforeOffset + text.length;
      if (from >= beforeOffset && to <= end) {
        const mappedFrom = currentOffset + from - beforeOffset;
        return { from: mappedFrom, to: mappedFrom + to - from };
      }
      beforeOffset = end;
      currentOffset += text.length;
    } else if (operation === DIFF_DELETE) {
      beforeOffset += text.length;
    } else if (operation === DIFF_INSERT) {
      currentOffset += text.length;
    }
  }
  return null;
}

function resolveCanonicalizedInsertion(
  before: string,
  current: string,
  offset: number,
) {
  if (offset === 0) {
    return current.length > 0 && before.startsWith(current[0])
      ? { from: 0, to: 0 }
      : null;
  }
  if (offset === before.length) {
    return current.length > 0 && before.endsWith(current[current.length - 1])
      ? { from: current.length, to: current.length }
      : null;
  }

  const left = before.slice(0, offset).trimEnd();
  const right = before.slice(offset).trimStart();
  const leftToken = left.slice(-64);
  const rightToken = right.slice(0, 64);
  const leftFrom = current.indexOf(leftToken);
  const rightFrom = current.indexOf(rightToken);
  if (
    !leftToken ||
    !rightToken ||
    leftFrom < 0 ||
    rightFrom < 0 ||
    current.indexOf(leftToken, leftFrom + 1) >= 0 ||
    current.indexOf(rightToken, rightFrom + 1) >= 0
  ) {
    return null;
  }

  const leftBoundary = leftFrom + leftToken.length;
  const rightBoundary = rightFrom;
  const afterLeftText = before.slice(left.length, offset);
  const beforeRightText = before.slice(offset, before.length - right.length);
  if (!afterLeftText && !beforeRightText && leftBoundary !== rightBoundary) {
    return null;
  }
  if (!afterLeftText) return { from: leftBoundary, to: leftBoundary };
  if (!beforeRightText) return { from: rightBoundary, to: rightBoundary };
  return null;
}

export function resolveMarkdownSuggestionRange(
  currentMarkdown: string,
  operation: ContextualMarkdownOperation,
): { from: number; to: number } | null {
  const { before, after } = operation;
  if (!isPayload(before) || !isPayload(after)) return null;
  if (!operation.anchor || typeof operation.anchor !== "object") return null;
  const anchor = operation.anchor as MarkdownAnchor;
  if (
    !Number.isInteger(anchor.from) ||
    !Number.isInteger(anchor.to) ||
    typeof anchor.prefix !== "string" ||
    typeof anchor.suffix !== "string" ||
    anchor.from < 0 ||
    anchor.to < anchor.from ||
    anchor.to > before.markdown.length ||
    before.markdown.slice(anchor.from, anchor.to) !== before.changedText ||
    `${before.markdown.slice(0, anchor.from)}${after.changedText}${before.markdown.slice(anchor.to)}` !==
      after.markdown
  ) {
    return null;
  }
  if (currentMarkdown === before.markdown) {
    return { from: anchor.from, to: anchor.to };
  }
  const needle = `${anchor.prefix}${before.changedText}${anchor.suffix}`;
  const index = currentMarkdown.indexOf(needle);
  if (index >= 0) {
    if (currentMarkdown.indexOf(needle, index + 1) >= 0) return null;
    const from = index + anchor.prefix.length;
    return { from, to: from + before.changedText.length };
  }

  const canonicalRange = resolveCanonicalizedRange(
    before.markdown,
    currentMarkdown,
    anchor,
  );
  if (canonicalRange) return canonicalRange;

  return (
    resolveOutsideChange(before.markdown, currentMarkdown, anchor) ??
    resolveParagraphRange(before.markdown, currentMarkdown, anchor)
  );
}

function resolveOutsideChange(
  before: string,
  currentMarkdown: string,
  anchor: { from: number; to: number },
) {
  if (currentMarkdown === before) return { from: anchor.from, to: anchor.to };
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < currentMarkdown.length &&
    before[prefix] === currentMarkdown[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length &&
    suffix < currentMarkdown.length &&
    before[before.length - suffix - 1] ===
      currentMarkdown[currentMarkdown.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const changeFrom = Math.min(
    prefix,
    before.length - suffix,
    currentMarkdown.length - suffix,
  );
  const changeTo =
    before.length -
    Math.min(suffix, before.length - prefix, currentMarkdown.length - prefix);
  const insertion = anchor.from === anchor.to;
  const inPrefix = insertion ? anchor.to < changeFrom : anchor.to <= changeFrom;
  const inSuffix = insertion ? anchor.from > changeTo : anchor.from >= changeTo;
  if (!inPrefix && !inSuffix) return null;
  const shift = inPrefix ? 0 : currentMarkdown.length - before.length;
  return { from: anchor.from + shift, to: anchor.to + shift };
}
