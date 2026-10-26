import { splitStreamingRevealUnits } from "./streaming-text-smoothing.js";

/** An unclosed construct longer than this renders as-is rather than waiting. */
const HOLD_BACK_MAX_CHARACTERS = 280;
const HOLD_BACK_LINK_MAX_CHARACTERS = 640;
const HOLD_BACK_TABLE_HEADER_MAX_CHARACTERS = 560;

const fenceOpen = /^(?:`{3,}|~{3,})/;
const fenceClose = /^(?:`{3,}|~{3,})\s*$/;
const blockStartLine = /^\s{0,3}(?:[-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|>|\|)/;
const bareMarkerLine = /^\s*(?:[-*+]|\d{1,9}[.)]|#{1,6}|>)?\s*$/;
const ruleLine = /^\s{0,3}(?:[-=*_]\s*)+$/;
const tableDelimiterRow = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** What a delimiter row can look like before it is complete (or before it starts). */
const partialTableDelimiterRow = /^[ \t]*\|?[ \t:|-]*$/;
const autolinkComplete =
  /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/;
const autolinkPartial = /^<[A-Za-z][A-Za-z0-9+.-]*(?::[^\s<>]*)?$/;
const alphanumeric = /[\p{L}\p{N}]/u;
const whitespace = /\s/;

interface HeldConstruct {
  position: number;
  limit: number;
}

interface OpenDelimiter {
  character: "*" | "_" | "~";
  length: number;
  position: number;
}

interface MarkdownTailScan {
  holds: HeldConstruct[];
  /** Strong delimiters that never closed and would render literally. */
  unmatchedStrong: number[];
  /** Emphasis and code spans still open at the end, innermost last. */
  open: { position: number; closer: string }[];
  /** A table header whose delimiter row has not arrived (or not finished). */
  pendingTableHeader?: { start: number; end: number } | undefined;
}

function scanMarkdownTail(text: string): MarkdownTailScan {
  const holds: HeldConstruct[] = [];
  const unmatchedStrong: number[] = [];
  const lines = text.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let offset = 0;
  let code: { position: number; ticks: number } | null = null;
  let delimiters: OpenDelimiter[] = [];
  let brackets: number[] = [];
  let linkTarget: { position: number; depth: number } | null = null;
  let tableStart: number | null = null;
  let tableConfirmed = false;

  const recordUnmatched = (open: readonly OpenDelimiter[]) => {
    for (const delimiter of open) {
      if (delimiter.length === 2 && delimiter.character !== "~") {
        unmatchedStrong.push(delimiter.position);
      }
    }
  };
  // Inline constructs never continue past a block boundary; whatever is still
  // open there is literal text, not something to wait for.
  const closeInline = () => {
    recordUnmatched(delimiters);
    code = null;
    delimiters = [];
    brackets = [];
    linkTarget = null;
  };

  const scanInline = (line: string, base: number, partialLine: boolean) => {
    for (let index = 0; index < line.length; index += 1) {
      const character = line.charAt(index);
      const position = base + index;
      if (character === "\\" && !code) {
        index += 1;
        continue;
      }
      if (character === "`") {
        let ticks = 1;
        while (line[index + ticks] === "`") ticks += 1;
        index += ticks - 1;
        if (!code) code = { position, ticks };
        else if (code.ticks === ticks) code = null;
        continue;
      }
      if (code) continue;
      if (linkTarget) {
        if (character === "(") linkTarget.depth += 1;
        else if (character === ")") {
          if (linkTarget.depth === 0) linkTarget = null;
          else linkTarget.depth -= 1;
        }
        continue;
      }
      if (character === "!" && line[index + 1] === "[") {
        brackets.push(position);
        index += 1;
        continue;
      }
      if (character === "[") {
        brackets.push(position);
        continue;
      }
      if (character === "]") {
        const opener = brackets.pop();
        if (opener === undefined) continue;
        const next = line.at(index + 1);
        if (next === "(") {
          linkTarget = { position: opener, depth: 0 };
          index += 1;
        } else if (next === undefined && partialLine) {
          holds.push({
            position: opener,
            limit: HOLD_BACK_LINK_MAX_CHARACTERS,
          });
        }
        continue;
      }
      if (character === "<") {
        const rest = line.slice(index);
        const complete = autolinkComplete.exec(rest);
        if (complete) {
          index += complete[0].length - 1;
        } else if (partialLine && autolinkPartial.test(rest)) {
          holds.push({ position, limit: HOLD_BACK_LINK_MAX_CHARACTERS });
          return;
        }
        continue;
      }
      if (character !== "*" && character !== "_" && character !== "~") {
        continue;
      }

      let run = 1;
      while (line[index + run] === character) run += 1;
      const previous = index > 0 ? line.charAt(index - 1) : " ";
      const next =
        index + run < line.length
          ? line[index + run]
          : partialLine
            ? undefined
            : " ";
      index += run - 1;
      if (character === "~" && run !== 2) continue;

      const leftFlanking = next !== undefined && !whitespace.test(next);
      const rightFlanking = !whitespace.test(previous);
      const canOpen =
        character === "_"
          ? leftFlanking && !(rightFlanking && alphanumeric.test(previous))
          : leftFlanking;
      const canClose =
        character === "_"
          ? rightFlanking && !(leftFlanking && alphanumeric.test(next))
          : rightFlanking;

      let remaining = run;
      while (canClose && remaining > 0) {
        const opener = delimiters.findLast(
          (delimiter) => delimiter.character === character,
        );
        if (!opener) break;
        const openerIndex = delimiters.lastIndexOf(opener);
        if (opener.length <= remaining) {
          remaining -= opener.length;
          recordUnmatched(delimiters.slice(openerIndex + 1));
          delimiters = delimiters.slice(0, openerIndex);
        } else {
          opener.length -= remaining;
          remaining = 0;
        }
      }
      const runStart = position + (run - remaining);
      if (remaining > 0 && canOpen) {
        delimiters.push({ character, length: remaining, position: runStart });
      } else if (remaining > 0 && next === undefined) {
        // A run at the very end could still open emphasis once the next
        // character arrives.
        holds.push({ position: runStart, limit: HOLD_BACK_MAX_CHARACTERS });
      }
    }
  };

  for (const [lineIndex, line] of lines.entries()) {
    const partialLine = lineIndex === lines.length - 1 && line.length > 0;
    const trimmed = line.trimStart();
    if (inFence) {
      const close = fenceClose.exec(trimmed);
      if (
        close &&
        close[0].charAt(0) === fenceMarker.charAt(0) &&
        close[0].trim().length >= fenceMarker.length
      ) {
        inFence = false;
        fenceMarker = "";
      }
      offset += line.length + 1;
      continue;
    }

    const fence = fenceOpen.exec(trimmed);
    if (fence) {
      closeInline();
      inFence = true;
      fenceMarker = fence[0].charAt(0).repeat(fence[0].length);
      tableStart = null;
      // The info string decides the language; wait for the whole opening line.
      if (partialLine) holds.push({ position: offset, limit: Infinity });
      offset += line.length + 1;
      continue;
    }

    if (trimmed === "") {
      closeInline();
      tableStart = null;
      tableConfirmed = false;
      offset += line.length + 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      if (tableStart === null) {
        tableStart = offset;
        tableConfirmed = false;
      } else if (
        !tableConfirmed &&
        !partialLine &&
        tableDelimiterRow.test(line)
      ) {
        tableConfirmed = true;
      }
      // A row streams in cell by cell like prose, but not before its first
      // word: a bare "|" would render as an empty row and then grow.
      if (partialLine && tableConfirmed && !alphanumeric.test(line)) {
        holds.push({ position: offset, limit: Infinity });
      }
    } else {
      tableStart = null;
      tableConfirmed = false;
    }

    if (blockStartLine.test(line)) closeInline();
    if (partialLine && (bareMarkerLine.test(line) || ruleLine.test(line))) {
      holds.push({ position: offset, limit: Infinity });
    }
    scanInline(line, offset, partialLine);
    offset += line.length + 1;
  }

  // A header followed by nothing, or by the start of a delimiter row, streams
  // as a table; pipes followed by anything else are a paragraph until a
  // delimiter row proves otherwise.
  let pendingTableHeader: MarkdownTailScan["pendingTableHeader"];
  if (tableStart !== null && !tableConfirmed) {
    const headerEnd = text.indexOf("\n", tableStart);
    const rest = headerEnd < 0 ? "" : text.slice(headerEnd + 1);
    if (partialTableDelimiterRow.test(rest)) {
      pendingTableHeader = {
        start: tableStart,
        end: headerEnd < 0 ? text.length : headerEnd,
      };
    } else {
      holds.push({
        position: tableStart,
        limit: HOLD_BACK_TABLE_HEADER_MAX_CHARACTERS,
      });
    }
  }
  const openCode = code as { position: number; ticks: number } | null;
  const openLink = linkTarget as { position: number } | null;
  if (openLink) {
    holds.push({
      position: openLink.position,
      limit: HOLD_BACK_LINK_MAX_CHARACTERS,
    });
  }
  for (const bracket of brackets) {
    holds.push({ position: bracket, limit: HOLD_BACK_MAX_CHARACTERS });
  }
  recordUnmatched(delimiters);
  const open = delimiters.map((delimiter) => ({
    position: delimiter.position,
    closer: delimiter.character.repeat(delimiter.length),
  }));
  // Nothing is scanned inside a code span, so it is always the innermost.
  if (openCode) {
    open.push({
      position: openCode.position,
      closer: "`".repeat(openCode.ticks),
    });
  }
  return { holds, unmatchedStrong, open, pendingTableHeader };
}

/** Cells in a table row, counting a trailing pipe as the row's end. */
function tableCellCount(row: string): number {
  const cells = row
    .trim()
    .replace(/^\|/, "")
    .split(/(?<!\\)\|/);
  if (cells.at(-1)?.trim() === "") cells.pop();
  return cells.length;
}

function rewriteStrongDelimiters(
  text: string,
  positions: readonly number[],
  replace: (delimiter: string) => string,
): string {
  return [...positions]
    .sort((left, right) => right - left)
    .reduce(
      (value, position) =>
        `${value.slice(0, position)}${replace(value.slice(position, position + 2))}${value.slice(position + 2)}`,
      text,
    );
}

/**
 * Settles Markdown that may be cut off mid-construct. While streaming, open
 * emphasis and inline code are closed at the tail, a table header gets a
 * provisional delimiter row, and the tail stops before constructs whose
 * rendering depends on what comes next (links, autolinks, fence openers,
 * possible tables, bare list markers) until they exceed a bounded length.
 * A finished message keeps every character and only escapes strong
 * delimiters that never closed.
 */
export function settleStreamingMarkdown(
  text: string,
  streaming: boolean,
): string {
  const { holds, unmatchedStrong, open, pendingTableHeader } =
    scanMarkdownTail(text);
  if (!streaming) {
    return rewriteStrongDelimiters(
      text,
      unmatchedStrong,
      (delimiter) => `\\${delimiter[0]}\\${delimiter[1]}`,
    );
  }
  let holdFrom = text.length;
  for (const hold of holds) {
    if (text.length - hold.position > hold.limit) continue;
    holdFrom = Math.min(holdFrom, hold.position);
  }
  let delimiterRow = "";
  if (pendingTableHeader && pendingTableHeader.start < holdFrom) {
    holdFrom = Math.min(holdFrom, pendingTableHeader.end);
    const header = text.slice(pendingTableHeader.start, holdFrom);
    if (alphanumeric.test(header)) {
      delimiterRow = `\n${"| --- ".repeat(tableCellCount(header))}|`;
    } else {
      holdFrom = pendingTableHeader.start;
    }
  }
  const shown = text.slice(0, holdFrom);
  const content = shown.trimEnd();
  const closers = open
    .filter(
      (construct) =>
        construct.position + construct.closer.length < content.length,
    )
    .map((construct) => construct.closer)
    .reverse()
    .join("");
  // A closing delimiter after whitespace would not close anything.
  return `${closers ? `${content}${closers}${shown.slice(content.length)}` : shown}${delimiterRow}`;
}

/** Start offset of each block inside the text it was split from. */
export function markdownBlockOffsets(
  text: string,
  blocks: readonly string[],
): number[] {
  let cursor = 0;
  return blocks.map((block) => {
    const found = text.startsWith(block, cursor)
      ? cursor
      : text.indexOf(block, cursor);
    const start = found >= 0 ? found : cursor;
    cursor = start + block.length;
    return start;
  });
}

export const STREAMING_REVEAL_WORD_CLASS = "agentkit-stream-word";
export const STREAMING_REVEAL_BLOCK_CLASS = "agentkit-stream-block";

const revealBlockTags = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "tr",
  "hr",
]);

interface RevealNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: RevealNode[];
  position?: { start?: { offset?: number } };
}

export interface StreamingRevealOptions {
  /** Offset of this Markdown block inside the whole streamed text. */
  baseOffset: number;
  /** Text at or after this offset fades in; text before it is static. */
  animateFrom: number;
}

function addClass(node: RevealNode, className: string): void {
  const properties = (node.properties ??= {});
  const existing = properties.className;
  properties.className = Array.isArray(existing)
    ? [...existing, className]
    : typeof existing === "string" && existing
      ? [existing, className]
      : [className];
}

function revealChildren(
  parent: RevealNode,
  options: StreamingRevealOptions,
  inheritedOffset: number,
): void {
  const children = parent.children;
  if (!children) return;
  const next: RevealNode[] = [];
  for (const child of children) {
    const relative = child.position?.start?.offset ?? inheritedOffset;
    const offset = options.baseOffset + relative;
    if (child.type === "element") {
      const tag = child.tagName ?? "";
      const isNew = offset >= options.animateFrom;
      if (
        isNew &&
        revealBlockTags.has(tag) &&
        !(tag === "p" && parent.tagName === "li")
      ) {
        addClass(child, STREAMING_REVEAL_BLOCK_CLASS);
      }
      if (tag === "code") {
        // Inline code arrives whole; fenced code fades in as a block.
        if (isNew && parent.tagName !== "pre") {
          addClass(child, STREAMING_REVEAL_WORD_CLASS);
        }
      } else if (tag !== "pre") {
        revealChildren(child, options, relative);
      }
      next.push(child);
      continue;
    }
    const value = child.value ?? "";
    if (
      child.type !== "text" ||
      !value.trim() ||
      offset + value.length <= options.animateFrom
    ) {
      next.push(child);
      continue;
    }
    let cursor = offset;
    let staticText = "";
    for (const unit of splitStreamingRevealUnits(value)) {
      if (cursor >= options.animateFrom) {
        if (staticText) next.push({ type: "text", value: staticText });
        staticText = "";
        next.push({
          type: "element",
          tagName: "span",
          properties: { className: [STREAMING_REVEAL_WORD_CLASS] },
          children: [{ type: "text", value: unit }],
        });
      } else {
        staticText += unit;
      }
      cursor += unit.length;
    }
    if (staticText) next.push({ type: "text", value: staticText });
  }
  parent.children = next;
}

/**
 * Rehype plugin that marks Markdown after `animateFrom` for a mount-time fade.
 * Text before `animateFrom` is never wrapped, so spans already on screen keep
 * their identity and only the tail animates.
 */
export function rehypeStreamingReveal(options: StreamingRevealOptions) {
  return (tree: RevealNode) => {
    revealChildren(tree, options, 0);
  };
}
