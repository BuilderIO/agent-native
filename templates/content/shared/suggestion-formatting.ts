import {
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

function formattingRuns(source: string): { runs: TextRun[] } | null {
  const doc = nfmToDoc(source);
  let markerPrefix = "suggestiontextboundary";
  while (source.includes(markerPrefix)) markerPrefix += "z";
  const runs: TextRun[] = [];
  let offset = 0;
  const withMarkers = (node: PMNode): PMNode => {
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
  const restored = withPlaceholders.replace(
    new RegExp(`${markerPrefix}(\\d+)x`, "g"),
    (token, rawIndex: string, position: number) => {
      const index = Number(rawIndex);
      const run = runs[index]!;
      run.sourceFrom = position + delta;
      run.sourceTo = run.sourceFrom + run.serialized.length;
      delta += run.serialized.length - token.length;
      return run.serialized;
    },
  );
  if (restored !== source || runs.some((run) => run.sourceFrom < 0))
    return null;
  return { runs };
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
      : source[offset] === "\n"
        ? "\n"
        : null;
    if (breakToken) {
      parts.push({ type: "break", text: "↵" });
      offset += breakToken.length;
      continue;
    }
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
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
  // Shared delimiters make an existing marked run the smallest stable source unit.
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
