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

  let prefix = 0;
  while (
    prefix < before.markdown.length &&
    prefix < currentMarkdown.length &&
    before.markdown[prefix] === currentMarkdown[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.markdown.length &&
    suffix < currentMarkdown.length &&
    before.markdown[before.markdown.length - suffix - 1] ===
      currentMarkdown[currentMarkdown.length - suffix - 1]
  ) {
    suffix += 1;
  }
  // Keep every possible boundary when repeated text lets the canonical change
  // slide left or right. A target inside that interval cannot be safely rebased.
  const changeFrom = Math.min(
    prefix,
    before.markdown.length - suffix,
    currentMarkdown.length - suffix,
  );
  const changeTo =
    before.markdown.length -
    Math.min(
      suffix,
      before.markdown.length - prefix,
      currentMarkdown.length - prefix,
    );
  const insertion = anchor.from === anchor.to;
  const inPrefix = insertion ? anchor.to < changeFrom : anchor.to <= changeFrom;
  const inSuffix = insertion ? anchor.from > changeTo : anchor.from >= changeTo;
  if (!inPrefix && !inSuffix) return null;
  const shift = inPrefix ? 0 : currentMarkdown.length - before.markdown.length;
  return { from: anchor.from + shift, to: anchor.to + shift };
}
