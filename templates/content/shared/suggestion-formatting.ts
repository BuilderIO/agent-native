import {
  canonicalizeNfm,
  docToNfm,
  nfmToDoc,
  serializeInlineTextNodeWithOffsets,
  type PMNode,
} from "./nfm";

type TextRun = {
  text: string;
  marks: string;
  markValues: PMNode["marks"];
  serialized: string;
  textOffsets: number[];
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
  verbatim?: boolean;
};
type TextRange = { from: number; to: number };

export class SuggestionFormattingMappingError extends Error {
  constructor() {
    super("Suggestion formatting cannot be mapped faithfully to its source");
    this.name = "SuggestionFormattingMappingError";
  }
}

function hasMarks(node: PMNode): boolean {
  return Boolean(node.marks?.length) || Boolean(node.content?.some(hasMarks));
}

export function suggestionMarkedSourceRanges(
  source: string,
): TextRange[] | null {
  const mapped = formattingRuns(source);
  if (!mapped && hasMarks(nfmToDoc(source)))
    throw new SuggestionFormattingMappingError();
  return mapped
    ? mapped.runs
        .filter((run) => run.marks !== "[]")
        .map((run) => ({ from: run.sourceFrom, to: run.sourceTo }))
    : null;
}

function withoutMarks(node: PMNode): PMNode {
  const { marks: _marks, ...rest } = node;
  return {
    ...rest,
    ...(node.content ? { content: node.content.map(withoutMarks) } : {}),
  };
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

function formattingRuns(source: string): {
  runs: TextRun[];
  restored: string;
  canonicalSpans: SourceSpan[];
} | null {
  const doc = nfmToDoc(source);
  let markerPrefix = "suggestiontextboundary";
  while (source.includes(markerPrefix)) markerPrefix += "z";
  const runs: TextRun[] = [];
  let offset = 0;
  let unmappable = false;
  const withMarkers = (node: PMNode): PMNode => {
    if (node.type === "codeBlock") {
      const text = (node.content ?? [])
        .map((child) => child.text ?? "")
        .join("");
      if (!text) return node;
      const index = runs.length;
      runs.push({
        text,
        marks: "[]",
        markValues: [],
        serialized: "",
        textOffsets: [],
        from: offset,
        to: offset + text.length,
        sourceFrom: -1,
        sourceTo: -1,
        verbatim: true,
      });
      offset += text.length;
      const fence = "`".repeat(longestBacktickRun(text));
      return {
        ...node,
        content: [{ type: "text", text: `${markerPrefix}${index}${fence}x` }],
      };
    }
    if (node.type === "text" && node.text) {
      const index = runs.length;
      const marker = `${markerPrefix}${index}x`;
      const serialized = serializeInlineTextNodeWithOffsets(node);
      if (!serialized) return node;
      runs.push({
        text: node.text,
        marks: JSON.stringify(node.marks ?? []),
        markValues: node.marks ?? [],
        serialized: serialized.source,
        textOffsets: serialized.textOffsets,
        from: offset,
        to: offset + node.text.length,
        sourceFrom: -1,
        sourceTo: -1,
      });
      offset += node.text.length;
      return { type: "text", text: marker };
    }
    return {
      ...node,
      ...(node.content ? { content: node.content.map(withMarkers) } : {}),
    };
  };
  const withPlaceholders = docToNfm({
    type: "doc",
    content: doc.content.map(withMarkers),
  });
  let delta = 0;
  const markers: string[] = [];
  const restored = withPlaceholders.replace(
    new RegExp(`${markerPrefix}(\\d+)\`*x`, "g"),
    (token, rawIndex: string, position: number) => {
      const index = Number(rawIndex);
      const run = runs[index]!;
      markers[index] = token;
      if (run.verbatim && !resolveVerbatimRun(run, withPlaceholders, position))
        unmappable = true;
      run.sourceFrom = position + delta;
      run.sourceTo = run.sourceFrom + run.serialized.length;
      delta += run.serialized.length - token.length;
      return run.serialized;
    },
  );
  if (unmappable || runs.some((run) => run.sourceFrom < 0)) return null;
  const canonicalSpans = runs.map(({ sourceFrom, sourceTo, textOffsets }) => ({
    from: sourceFrom,
    to: sourceTo,
    textOffsets,
  }));
  if (
    restored !== source &&
    !mapStoredSourceRuns(source, restored, runs, markers, withPlaceholders)
  )
    return null;
  return { runs, restored, canonicalSpans };
}

type SourceSpan = TextRange & { textOffsets: number[] };
type SourceSide = "canonical" | "stored";

export type SuggestionSourceAlignment = {
  canonical: string;
  map(offset: number, from: SourceSide): number | null;
};

let lastAlignment: {
  source: string;
  alignment: SuggestionSourceAlignment | null;
} | null = null;

// A draft session maps every keystroke against the same stored base.
export function suggestionSourceAlignment(
  source: string,
): SuggestionSourceAlignment | null {
  if (lastAlignment?.source !== source)
    lastAlignment = { source, alignment: sourceAlignment(source) };
  return lastAlignment.alignment;
}

// Pairs each text run's canonical and stored bytes. An offset maps inside a
// run, at a run or gap edge, or inside a gap whose bytes match on both sides;
// anywhere else the two serializations disagree and the offset has no image.
function sourceAlignment(source: string): SuggestionSourceAlignment | null {
  const canonical = canonicalizeNfm(source);
  const inside = (offset: number, text: string) =>
    Number.isInteger(offset) && offset >= 0 && offset <= text.length;
  if (canonical === source)
    return {
      canonical,
      map: (offset) => (inside(offset, source) ? offset : null),
    };
  const mapped = formattingRuns(source);
  if (!mapped || mapped.restored !== canonical) return null;
  const texts = { canonical, stored: source };
  const spans: Array<Record<SourceSide, SourceSpan>> = mapped.runs.map(
    (run, index) => ({
      canonical: mapped.canonicalSpans[index]!,
      stored: {
        from: run.sourceFrom,
        to: run.sourceTo,
        textOffsets: run.textOffsets,
      },
    }),
  );
  return {
    canonical,
    map(offset, from) {
      if (!inside(offset, texts[from])) return null;
      const to: SourceSide = from === "canonical" ? "stored" : "canonical";
      type Edge = Record<SourceSide, number>;
      const gap = (start: Edge, end: Edge) => {
        if (offset === start[from]) return start[to];
        if (offset === end[from]) return end[to];
        return texts[from].slice(start[from], end[from]) ===
          texts[to].slice(start[to], end[to])
          ? start[to] + offset - start[from]
          : null;
      };
      let previous: Edge = { canonical: 0, stored: 0 };
      for (const span of spans) {
        const own = span[from];
        const other = span[to];
        if (offset < own.from)
          return gap(previous, {
            canonical: span.canonical.from,
            stored: span.stored.from,
          });
        if (offset <= own.to) {
          if (offset === own.from) return other.from;
          if (offset === own.to) return other.to;
          const index = own.textOffsets.indexOf(offset - own.from);
          return index < 0 ? null : other.from + other.textOffsets[index]!;
        }
        previous = { canonical: span.canonical.to, stored: span.stored.to };
      }
      return gap(previous, {
        canonical: canonical.length,
        stored: source.length,
      });
    },
  };
}

function normalizedSourceGap(source: string, from: number, to: number): string {
  const startsLine = from === 0 || /[\r\n]/.test(source[from - 1]!);
  const prefix = startsLine ? "" : "x";
  return (prefix + source.slice(from, to))
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]*(?=\n)/g, "")
    .replace(
      /^(\t*)(?:[-*+] |(\d+)[.)] )/gm,
      (_marker, indent: string, number: string | undefined) =>
        `${indent}${number ? "1. " : "- "}`,
    )
    .slice(prefix.length);
}

const TABLE_TAG = /<\/?(?:table|tr|td|th)\b[^>]*>/;

// Canonical NFM writes a stored pipe table as an HTML table. Both reduce to
// "|" between cells and a newline between rows, with or without the stored
// rows' optional outer pipes; the final reparse proves the cells.
function tableBoundaries(
  gap: string,
  startsLine: boolean,
  endsLine: boolean,
): string {
  return `${startsLine ? "\n" : ""}${gap}${endsLine ? "\n" : ""}`
    .replace(/^[ \t|:-]*$/gm, (line) =>
      line.includes("|") && line.includes("-") ? "" : line,
    )
    .replace(/[ \t]*\|?[ \t]*\n[ \t]*\|?/g, "\n")
    .replace(/<tr\b[^>]*>\s*<t[dh]\b[^>]*>/g, "\n")
    .replace(/<t[dh]\b[^>]*>/g, "|")
    .replace(/<\/?(?:table|tr|td|th)\b[^>]*>/g, "\n")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*\n\s*/g, "\n");
}

function mapStoredSourceRuns(
  source: string,
  canonical: string,
  runs: TextRun[],
  markers: string[],
  withPlaceholders: string,
): boolean {
  // Repeated partial matches must not turn a forward scan into quadratic work.
  let remainingWork = source.length * 16;
  const matches = (token: string, position: number) => {
    for (let index = 0; index < token.length; index += 1) {
      if (remainingWork-- <= 0) return false;
      if (source[position + index] !== token[index]) return false;
    }
    return true;
  };
  const gapMatches = (
    from: number,
    to: number,
    canonicalFrom: number,
    canonicalTo: number,
  ) => {
    let stored = normalizedSourceGap(source, from, to);
    let expected = normalizedSourceGap(canonical, canonicalFrom, canonicalTo);
    // Newlines before the first block or after the last carry no syntax.
    if (from === 0) {
      stored = stored.replace(/^\n+/, "");
      expected = expected.replace(/^\n+/, "");
    }
    if (to === source.length) {
      stored = stored.replace(/\n+$/, "");
      expected = expected.replace(/\n+$/, "");
    }
    if (stored === expected) return true;
    const lineEdges = (text: string, start: number, end: number) =>
      [
        start === 0 || /[\r\n]/.test(text[start - 1]!),
        end === text.length || /[\r\n]/.test(text[end]!),
      ] as const;
    return (
      TABLE_TAG.test(canonical.slice(canonicalFrom, canonicalTo)) &&
      tableBoundaries(stored, ...lineEdges(source, from, to)) ===
        tableBoundaries(
          expected,
          ...lineEdges(canonical, canonicalFrom, canonicalTo),
        )
    );
  };
  let cursor = 0;
  let canonicalCursor = 0;
  const pieces: string[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    const prefix = run.serialized.slice(0, run.textOffsets[0]);
    const suffix = run.serialized.slice(run.textOffsets[run.text.length]);
    const tokens = run.text
      .split("")
      .map((_character, characterIndex) =>
        run.serialized.slice(
          run.textOffsets[characterIndex],
          run.textOffsets[characterIndex + 1],
        ),
      );
    let found = false;
    for (let start = cursor; start < source.length; start += 1) {
      if (remainingWork < 0) return false;
      if (!matches(prefix, start)) continue;
      let position = start + prefix.length;
      const textOffsets = [prefix.length];
      let valid = true;
      for (
        let characterIndex = 0;
        characterIndex < tokens.length;
        characterIndex += 1
      ) {
        const token = tokens[characterIndex]!;
        const character = run.text[characterIndex]!;
        if (matches(token, position)) position += token.length;
        // Inline math is an atom, so a dollar in a parsed text run is literal.
        else if (token === "\\$" && matches("$", position)) position += 1;
        else if (character === "\n" && token.startsWith("\n")) {
          const indent = token.slice(1);
          if (matches(`\r\n${indent}`, position)) position += 2 + indent.length;
          else if (matches(`\r${indent}`, position))
            position += 1 + indent.length;
          else valid = false;
        } else if (
          character === "\n" &&
          token === "<br>" &&
          matches("<br/>", position)
        )
          position += 5;
        else valid = false;
        if (!valid) break;
        textOffsets.push(position - start);
      }
      if (!valid || !matches(suffix, position)) continue;
      position += suffix.length;
      if (!gapMatches(cursor, start, canonicalCursor, run.sourceFrom))
        return false;
      canonicalCursor = run.sourceTo;
      pieces.push(source.slice(cursor, start), markers[index]!);
      cursor = position;
      run.sourceFrom = start;
      run.sourceTo = position;
      run.textOffsets = textOffsets;
      found = true;
      break;
    }
    if (!found) return false;
  }
  if (!gapMatches(cursor, source.length, canonicalCursor, canonical.length))
    return false;
  pieces.push(source.slice(cursor));
  // Parsing is a second check: empty syntax must already be excluded by the gaps.
  return (
    JSON.stringify(nfmToDoc(pieces.join(""))) ===
    JSON.stringify(nfmToDoc(withPlaceholders))
  );
}

function resolveVerbatimRun(
  run: TextRun,
  withPlaceholders: string,
  position: number,
): boolean {
  const lineStart = withPlaceholders.lastIndexOf("\n", position - 1) + 1;
  const indent = withPlaceholders.slice(lineStart, position);
  if (!/^\t*$/.test(indent)) return false;
  const textOffsets: number[] = [];
  let cursor = 0;
  for (let index = 0; index < run.text.length; index += 1) {
    textOffsets.push(cursor);
    cursor += run.text[index] === "\n" ? 1 + indent.length : 1;
  }
  textOffsets.push(cursor);
  run.serialized = run.text.split("\n").join(`\n${indent}`);
  run.textOffsets = textOffsets;
  return true;
}

export type SuggestionFormattingSlicePart =
  | { type: "text"; text: string; marks: NonNullable<PMNode["marks"]> }
  | { type: "break"; text: string }
  | { type: "indent"; text: string };

function structuralGapParts(
  source: string,
  from: number,
  to: number,
): SuggestionFormattingSlicePart[] | null {
  const parts: SuggestionFormattingSlicePart[] = [];
  let offset = from;
  while (offset < to) {
    const breakToken = source.startsWith("<br>", offset)
      ? "<br>"
      : source.startsWith("\r\n", offset)
        ? "\r\n"
        : source[offset] === "\r" || source[offset] === "\n"
          ? source[offset]!
          : null;
    if (breakToken) {
      parts.push({ type: "break", text: "↵" });
      offset += breakToken.length;
      continue;
    }
    const lineStart =
      Math.max(
        source.lastIndexOf("\n", offset - 1),
        source.lastIndexOf("\r", offset - 1),
      ) + 1;
    const atLineStart = /^\t*$/.test(source.slice(lineStart, offset));
    if (!atLineStart || source[offset] !== "\t") return null;
    const indentFrom = offset;
    while (offset < to && source[offset] === "\t") offset += 1;
    parts.push({
      type: "indent",
      text: "⇥".repeat(offset - indentFrom),
    });
    const heading = /^(?:#{1,6}) /.exec(source.slice(offset, to));
    if (heading) offset += heading[0].length;
  }
  return parts;
}

function headingStartTextOffset(
  source: string,
  sourceOffset: number,
  runs: TextRun[],
): number | null {
  if (sourceOffset > 0 && source[sourceOffset - 1] !== "\n") return null;
  const marker = /^(#{1,6}) /.exec(source.slice(sourceOffset));
  if (!marker) return null;
  const lineEnd = source.indexOf("\n", sourceOffset);
  const line = source.slice(
    sourceOffset,
    lineEnd < 0 ? source.length : lineEnd,
  );
  const parsed = nfmToDoc(line);
  if (
    parsed.content.length !== 1 ||
    parsed.content[0]?.type !== "heading" ||
    Number(parsed.content[0].attrs?.level) !== marker[1]!.length ||
    docToNfm(parsed) !== line
  )
    return null;
  const firstLineRun = runs.find(
    (run) =>
      run.sourceFrom >= sourceOffset &&
      run.sourceFrom < sourceOffset + line.length,
  );
  if (firstLineRun) return firstLineRun.from;
  const previousRun = [...runs]
    .reverse()
    .find((run) => run.sourceTo <= sourceOffset);
  return previousRun?.to ?? 0;
}

export function suggestionFormattingSourceSlice(
  source: string,
  from: number,
  to: number,
): SuggestionFormattingSlicePart[] | null {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length
  )
    return null;
  const mapped = formattingRuns(source);
  if (!mapped) return null;
  const parts: SuggestionFormattingSlicePart[] = [];
  let coveredTo = from;
  const appendStructuralGap = (gapFrom: number, gapTo: number) => {
    const gapParts = structuralGapParts(source, gapFrom, gapTo);
    if (!gapParts) return false;
    parts.push(...gapParts);
    return true;
  };
  for (const run of mapped.runs) {
    if (run.sourceTo <= from || run.sourceFrom >= to) continue;
    if (run.sourceFrom > coveredTo) {
      const gapTo = Math.min(to, run.sourceFrom);
      if (!appendStructuralGap(coveredTo, gapTo)) return null;
      coveredTo = gapTo;
    }
    const overlapFrom = Math.max(coveredTo, run.sourceFrom);
    const overlapTo = Math.min(to, run.sourceTo);
    const textIndex = (offset: number) => {
      if (offset === run.sourceFrom) return 0;
      if (offset === run.sourceTo) return run.text.length;
      for (let index = 0; index <= run.text.length; index += 1) {
        if (textBoundarySourceOffset(run, index) === offset) return index;
      }
      return null;
    };
    const start = textIndex(overlapFrom);
    const end = textIndex(overlapTo);
    if (start === null || end === null || end < start) return null;
    if (end > start)
      parts.push({
        type: "text",
        text: run.text.slice(start, end),
        marks: run.markValues ?? [],
      });
    coveredTo = overlapTo;
  }
  if (coveredTo < to) {
    if (!appendStructuralGap(coveredTo, to)) return null;
    coveredTo = to;
  }
  return coveredTo === to ? parts : null;
}

function textBoundarySourceOffset(run: TextRun, index: number): number | null {
  const offset = run.textOffsets[index];
  return offset === undefined ? null : run.sourceFrom + offset;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of ranges.sort((left, right) => left.from - right.from)) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to)
      previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function sourceRange(runs: TextRun[], range: TextRange): TextRange {
  const first = runs.find(
    (run) => run.from <= range.from && run.to > range.from,
  );
  const last = runs.find((run) => run.from < range.to && run.to >= range.to);
  if (!first || !last) throw new SuggestionFormattingMappingError();
  const from =
    first.from === range.from
      ? first.sourceFrom
      : textBoundarySourceOffset(first, range.from - first.from);
  const to =
    last.to === range.to
      ? last.sourceTo
      : textBoundarySourceOffset(last, range.to - last.from);
  if (from === null || to === null)
    throw new SuggestionFormattingMappingError();
  return {
    from,
    to,
  };
}

export function suggestionFormattingChanges(
  before: string,
  after: string,
): Array<{ before: TextRange; after: TextRange }> | null {
  const beforeDoc = nfmToDoc(before);
  const afterDoc = nfmToDoc(after);
  if (docToNfm(beforeDoc) === docToNfm(afterDoc)) return null;
  if (
    docToNfm({ type: "doc", content: beforeDoc.content.map(withoutMarks) }) !==
    docToNfm({ type: "doc", content: afterDoc.content.map(withoutMarks) })
  )
    return null;
  const previous = formattingRuns(before);
  const next = formattingRuns(after);
  if (!previous || !next) throw new SuggestionFormattingMappingError();
  let left = 0;
  let right = 0;
  const changes: TextRange[] = [];
  while (left < previous.runs.length && right < next.runs.length) {
    const beforeRun = previous.runs[left]!;
    const afterRun = next.runs[right]!;
    const from = Math.max(beforeRun.from, afterRun.from);
    const to = Math.min(beforeRun.to, afterRun.to);
    if (beforeRun.marks !== afterRun.marks && to > from)
      changes.push({ from, to });
    if (beforeRun.to <= afterRun.to) left += 1;
    if (afterRun.to <= beforeRun.to) right += 1;
  }
  let ranges = mergeRanges(changes);
  const markedRuns = [...previous.runs, ...next.runs].filter(
    (run) => run.marks !== "[]",
  );
  let expanded: boolean;
  do {
    expanded = false;
    for (const range of ranges) {
      for (const run of markedRuns) {
        if (run.from >= range.to || run.to <= range.from) continue;
        if (run.from < range.from || run.to > range.to) expanded = true;
        range.from = Math.min(range.from, run.from);
        range.to = Math.max(range.to, run.to);
      }
    }
    ranges = mergeRanges(ranges);
  } while (expanded);
  const result = ranges.map((range) => ({
    before: sourceRange(previous.runs, range),
    after: sourceRange(next.runs, range),
  }));
  let reconstructed = before;
  for (const range of [...result].reverse())
    reconstructed =
      reconstructed.slice(0, range.before.from) +
      after.slice(range.after.from, range.after.to) +
      reconstructed.slice(range.before.to);
  if (reconstructed !== after) throw new SuggestionFormattingMappingError();
  return result;
}

export function suggestionFormattingSourceRange(
  source: string,
  from: number,
  to: number,
): {
  text: string;
  from: number;
  to: number;
  fromAffinity: "left" | "right";
  toAffinity: "left" | "right";
} | null {
  const mapped = formattingRuns(source);
  if (!mapped) return null;
  const structuralGaps: Array<{
    sourceFrom: number;
    sourceTo: number;
    offset: number;
  }> = [];
  let previousSourceTo = 0;
  let previousTextTo = 0;
  for (const run of mapped.runs) {
    if (run.sourceFrom > previousSourceTo) {
      if (structuralGapParts(source, previousSourceTo, run.sourceFrom))
        structuralGaps.push({
          sourceFrom: previousSourceTo,
          sourceTo: run.sourceFrom,
          offset: run.from,
        });
    }
    previousSourceTo = run.sourceTo;
    previousTextTo = run.to;
  }
  if (
    previousSourceTo < source.length &&
    structuralGapParts(source, previousSourceTo, source.length)
  )
    structuralGaps.push({
      sourceFrom: previousSourceTo,
      sourceTo: source.length,
      offset: previousTextTo,
    });
  if (from < to) {
    let coveredTo = from;
    for (const run of mapped.runs) {
      if (run.sourceTo <= coveredTo) continue;
      if (run.sourceFrom > coveredTo) {
        const gapTo = Math.min(to, run.sourceFrom);
        if (!structuralGapParts(source, coveredTo, gapTo)) return null;
        coveredTo = gapTo;
      }
      if (run.sourceFrom <= coveredTo) coveredTo = Math.min(to, run.sourceTo);
      if (coveredTo === to) break;
    }
    if (coveredTo !== to) return null;
  }
  const boundary = (
    offset: number,
    preferredAffinity: "left" | "right",
  ): { offset: number; affinity: "left" | "right" } | null => {
    const candidates: Array<{
      offset: number;
      affinity: "left" | "right";
    }> = [];
    if (from === to) {
      const headingOffset = headingStartTextOffset(source, offset, mapped.runs);
      if (headingOffset !== null)
        candidates.push({
          offset: headingOffset,
          affinity: preferredAffinity,
        });
    }
    for (const run of mapped.runs) {
      if (offset === run.sourceFrom)
        candidates.push({ offset: run.from, affinity: "right" });
      if (offset === run.sourceTo)
        candidates.push({ offset: run.to, affinity: "left" });
      if (offset <= run.sourceFrom || offset >= run.sourceTo) continue;
      for (let index = 0; index <= run.text.length; index += 1) {
        if (textBoundarySourceOffset(run, index) === offset)
          candidates.push({
            offset: run.from + index,
            affinity: preferredAffinity,
          });
      }
    }
    for (const gap of structuralGaps) {
      if (offset < gap.sourceFrom || offset > gap.sourceTo) continue;
      candidates.push({
        offset: gap.offset,
        affinity:
          offset === gap.sourceFrom
            ? "left"
            : offset === gap.sourceTo
              ? "right"
              : preferredAffinity,
      });
    }
    return (
      candidates.find(
        (candidate) => candidate.affinity === preferredAffinity,
      ) ??
      candidates[0] ??
      null
    );
  };
  const start = boundary(from, "right");
  const finish = boundary(to, "left");
  return start !== null && finish !== null
    ? {
        text: mapped.runs.map((run) => run.text).join(""),
        from: start.offset,
        to: finish.offset,
        fromAffinity: start.affinity,
        toAffinity: finish.affinity,
      }
    : null;
}
