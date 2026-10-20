import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import { canonicalizeNfm, docToNfm, nfmToDoc } from "./nfm";
import { suggestionSourceAlignment } from "./suggestion-formatting";

type ContextualMarkdownOperation = {
  before?: unknown;
  after?: unknown;
  anchor?: unknown;
};

type MarkdownPayload = { markdown: string; changedText: string };
type Range = { from: number; to: number };
type MarkdownAnchor = Range & {
  prefix: string;
  suffix: string;
  siblingRanges?: Range[];
};

const SIBLING_SEARCH_LIMIT = 128_000;

type CanonicalForm = {
  source: string;
  canonical: string;
  diffs?: ReturnType<DiffMatchPatch["diff_main"]>;
};
let lastCanonicalForm: CanonicalForm | null = null;

// Highlighting a page resolves each of its suggestions against the same saved
// page, and each resolution can place several ranges in its canonical form.
function canonicalFormOf(source: string): CanonicalForm {
  if (lastCanonicalForm?.source !== source)
    lastCanonicalForm = { source, canonical: canonicalizeNfm(source) };
  return lastCanonicalForm;
}

// Context that repeats on the saved page, such as two table rows that read the
// same around the target, can survive only at the other copy after someone
// edits the first, so finding it once on the current page proves nothing.
function locateUnrepeatedContext(
  saved: string,
  current: string,
  needle: string,
) {
  const index = current.indexOf(needle);
  if (index < 0 || current.indexOf(needle, index + 1) >= 0) return -1;
  const first = saved.indexOf(needle);
  return first >= 0 && saved.indexOf(needle, first + 1) >= 0 ? -1 : index;
}

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
  anchor: Range,
) {
  return canonicalFormOf(before).canonical === current
    ? placeInCanonicalForm(before, current, anchor)
    : null;
}

// `canonical` must be the canonical form of `before`.
function placeInCanonicalForm(
  before: string,
  canonical: string,
  anchor: Range,
) {
  const target = before.slice(anchor.from, anchor.to);
  if (!target)
    return (
      resolveCanonicalizedInsertion(before, canonical, anchor.from) ??
      resolveAlignedRange(before, canonical, anchor)
    );
  if (!target.trim()) return null;
  const range = resolveUnchangedCanonicalRange(
    before,
    canonical,
    anchor.from,
    anchor.to,
  );
  if (
    !range ||
    canonical.indexOf(target) !== range.from ||
    canonical.indexOf(target, range.from + 1) >= 0
  )
    return resolveAlignedRange(before, canonical, anchor);
  return range;
}

// The alignment knows how stored syntax, such as a pipe table, maps to its
// canonical form, so it can place a range the diff cannot: the start of a
// cell, an empty cell, or a word that repeats elsewhere on the page. Away
// from the edge of text, beside whitespace that canonicalization collapses or
// strips, an insertion boundary would be a guess, and a target whose bytes
// changed is no longer the same target.
function resolveAlignedRange(before: string, current: string, anchor: Range) {
  const alignment = suggestionSourceAlignment(before);
  if (!alignment) return null;
  const from = alignment.map(anchor.from, "stored");
  const to = alignment.map(anchor.to, "stored");
  if (from === null || to === null || from > to) return null;
  if (anchor.to > anchor.from)
    return current.slice(from, to) === before.slice(anchor.from, anchor.to)
      ? { from, to }
      : null;
  const shared = (stored?: string, canonical?: string) =>
    Boolean(stored?.trim()) && stored === canonical;
  return alignment.atTextEdge(anchor.from, "stored") ||
    shared(before[anchor.from - 1], current[from - 1]) ||
    shared(before[anchor.from], current[from])
    ? { from, to }
    : null;
}

// `current` must be the canonical form of `before`.
function resolveUnchangedCanonicalRange(
  before: string,
  current: string,
  from: number,
  to: number,
) {
  const form = canonicalFormOf(before);
  const diffs =
    form.canonical === current
      ? (form.diffs ??= new DiffMatchPatch().diff_main(before, current, true))
      : new DiffMatchPatch().diff_main(before, current, true);
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
  const from = Math.max(0, offset - 1);
  const to = Math.min(before.length, offset + 1);
  const unchanged = resolveUnchangedCanonicalRange(before, current, from, to);
  if (unchanged) {
    const boundary = unchanged.from + offset - from;
    return { from: boundary, to: boundary };
  }

  const left = before.slice(0, offset).trimEnd();
  const right = before.slice(offset).trimStart();
  const rightFrom = before.length - right.length;
  if (!left || !right || (offset !== left.length && offset !== rightFrom))
    return null;
  const leftRange = resolveUnchangedCanonicalRange(
    before,
    current,
    left.length - 1,
    left.length,
  );
  const rightRange = resolveUnchangedCanonicalRange(
    before,
    current,
    rightFrom,
    rightFrom + 1,
  );
  if (
    !leftRange ||
    !rightRange ||
    !/^\s+$/.test(current.slice(leftRange.to, rightRange.from))
  )
    return null;
  const boundary = offset === left.length ? leftRange.to : rightRange.from;
  return { from: boundary, to: boundary };
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
  const index = locateUnrepeatedContext(
    before.markdown,
    currentMarkdown,
    `${anchor.prefix}${before.changedText}${anchor.suffix}`,
  );
  if (index >= 0) {
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
    resolveParagraphRange(before.markdown, currentMarkdown, anchor) ??
    resolveAcrossSiblingRanges(before.markdown, currentMarkdown, anchor) ??
    resolveThroughCanonicalForm(before.markdown, currentMarkdown, anchor)
  );
}

// A page an agent wrote, with blank lines or a pipe table, is saved in the
// editor's canonical form the first time someone edits it. Comparing the
// stored page with that edit directly sees two changes at once, so place the
// anchor in the canonical form first. From there, follow later edits by the
// same rules as a page that was canonical all along: the text around the
// anchor is unchanged, every edit lies wholly before or after it, or every
// edit is another part of the same proposal.
function resolveThroughCanonicalForm(
  before: string,
  current: string,
  anchor: MarkdownAnchor,
) {
  const { canonical: context } = canonicalFormOf(before);
  if (context === before) return null;
  const range = placeInCanonicalForm(before, context, anchor);
  if (!range) return null;
  const prefix = context.slice(Math.max(0, range.from - 32), range.from);
  const index = locateUnrepeatedContext(
    context,
    current,
    prefix + context.slice(range.from, range.to + 32),
  );
  if (index >= 0) {
    const from = index + prefix.length;
    return { from, to: from + range.to - range.from };
  }
  const outside = resolveOutsideChange(context, current, range);
  if (
    outside ||
    !anchor.siblingRanges?.length ||
    context.length + current.length > SIBLING_SEARCH_LIMIT
  )
    return outside;
  const siblingRanges: Range[] = [];
  for (const sibling of anchor.siblingRanges) {
    const placed =
      Number.isInteger(sibling.from) &&
      Number.isInteger(sibling.to) &&
      sibling.from >= 0 &&
      sibling.from <= sibling.to &&
      sibling.to <= before.length
        ? placeInCanonicalForm(before, context, sibling)
        : null;
    if (!placed) return null;
    siblingRanges.push(placed);
  }
  return resolveAcrossSiblingRanges(context, current, {
    ...anchor,
    ...range,
    siblingRanges,
  });
}

export function resolveMarkdownSuggestionRangeInContext(
  currentMarkdown: string,
  operation: ContextualMarkdownOperation,
): { from: number; to: number } | null {
  if (!resolveMarkdownSuggestionRange(currentMarkdown, operation)) return null;
  // A moved exact quote is enough to review, but not to confirm application.
  const before = operation.before as { markdown: string };
  const anchor = operation.anchor as MarkdownAnchor;
  if (currentMarkdown === before.markdown)
    return { from: anchor.from, to: anchor.to };
  const { canonical: context } = canonicalFormOf(before.markdown);
  const contextualRange =
    context === before.markdown
      ? anchor
      : resolveCanonicalizedRange(before.markdown, context, anchor);
  if (!contextualRange) return null;
  if (
    blockRanges(context).some(
      (block) =>
        block.paragraph &&
        contextualRange.from >= block.from &&
        contextualRange.to <= block.to,
    )
  )
    return resolveParagraphRange(context, currentMarkdown, {
      ...anchor,
      ...contextualRange,
    });
  return (
    resolveCanonicalizedRange(before.markdown, currentMarkdown, anchor) ??
    resolveOutsideChange(before.markdown, currentMarkdown, anchor) ??
    resolveParagraphRange(before.markdown, currentMarkdown, anchor) ??
    resolveAcrossSiblingRanges(before.markdown, currentMarkdown, anchor)
  );
}

function resolveAcrossSiblingRanges(
  before: string,
  current: string,
  anchor: MarkdownAnchor,
) {
  const siblings = anchor.siblingRanges;
  if (
    !siblings?.length ||
    before.length + current.length > SIBLING_SEARCH_LIMIT
  )
    return null;
  let cursor = 0;
  const fixed: Array<{ from: number; text: string }> = [];
  for (const sibling of siblings) {
    if (
      !Number.isInteger(sibling.from) ||
      !Number.isInteger(sibling.to) ||
      sibling.from < cursor ||
      sibling.to < sibling.from ||
      sibling.to > before.length ||
      (anchor.from < sibling.to && anchor.to > sibling.from)
    )
      return null;
    fixed.push({ from: cursor, text: before.slice(cursor, sibling.from) });
    cursor = sibling.to;
  }
  fixed.push({ from: cursor, text: before.slice(cursor) });
  const targetSegment = fixed.findIndex(
    (segment) =>
      anchor.from >= segment.from &&
      anchor.to <= segment.from + segment.text.length,
  );
  if (targetSegment < 0 || !fixed[targetSegment]!.text) return null;

  const mapped = new Set<number>();
  let visited = 0;
  const visit = (
    segmentIndex: number,
    minimum: number,
    targetStart: number,
  ) => {
    if (++visited > 256 || mapped.size > 1) return;
    if (segmentIndex === fixed.length) {
      if (minimum <= current.length) mapped.add(targetStart);
      return;
    }
    const segment = fixed[segmentIndex]!;
    if (!segment.text) {
      visit(segmentIndex + 1, minimum, targetStart);
      return;
    }
    let position = current.indexOf(segment.text, minimum);
    while (position >= 0) {
      if (segmentIndex === 0 && position !== 0) break;
      if (
        segmentIndex === fixed.length - 1 &&
        position + segment.text.length !== current.length
      ) {
        position = current.indexOf(segment.text, position + 1);
        continue;
      }
      visit(
        segmentIndex + 1,
        position + segment.text.length,
        segmentIndex === targetSegment
          ? position + anchor.from - segment.from
          : targetStart,
      );
      if (visited > 256 || mapped.size > 1) return;
      position = current.indexOf(segment.text, position + 1);
    }
  };
  visit(0, 0, -1);
  if (visited > 256 || mapped.size !== 1) return null;
  const from = [...mapped][0]!;
  const to = from + anchor.to - anchor.from;
  return current.slice(from, to) === before.slice(anchor.from, anchor.to)
    ? { from, to }
    : null;
}

export function resolveOutsideChange(
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
