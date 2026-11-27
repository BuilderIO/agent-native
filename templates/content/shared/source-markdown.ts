import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

import {
  canonicalizeNfm,
  docToNfm,
  escapeGfmPipes,
  locateNfmBlocks,
  nfmToDoc,
  serializeCellInline,
  splitGfmPipeRow,
  type PMNode,
} from "./nfm.js";

const EMPTY_BLOCK = "<empty-block/>";
const BLANK_LINE = "\n\n";
const LINE_BREAK = "\n";
const NEEDS_BLANK_LINE_RE = /^\s*(?:[|<]|[-=]+\s*$)/;
const MAX_DISTINCT_KEYS = 0xffff;
const MAX_PAIRING_CANDIDATES = 50;
const MIN_PAIRING_SIMILARITY = 0.4;

interface SourceBlock {
  gap: string;
  raw: string;
  text: string;
  keys: string[];
  nodes: PMNode[];
}

interface SourceLayout {
  leading: string;
  blocks: SourceBlock[];
  trailing: string;
  eol: string;
}

interface PageBlock {
  key: string;
  node: PMNode;
}

interface Stretch {
  kept: boolean;
  blocks: SourceBlock[];
  page: PageBlock[];
}

interface TextHunk {
  from: number;
  to: number;
  insert: string;
}

interface RawRange {
  early: number;
  late: number;
}

interface TextLine {
  start: number;
  end: number;
  key: string;
}

type BlockWriter = (block: SourceBlock | undefined, page: PageBlock) => string;

export function sameSourceMarkdown(left: string, right: string): boolean {
  if (left === right) return true;
  const form = sourceMarkdownForm(left);
  return form !== null && form === sourceMarkdownForm(right);
}

export function mergeSourceMarkdown(source: string, page: string): string {
  if (sameSourceMarkdown(source, page)) return source;
  const form = sourceMarkdownForm(page);
  if (form === null || sourceMarkdownForm(source) === null) return page;

  const layout = readLayout(source);
  const pageBlocks = readPage(form);
  const stretches = alignBlocks(layout.blocks, pageBlocks);
  const finalEol = source === "" || /[\r\n]$/.test(source) ? layout.eol : "";
  const candidates = [
    ...[patchBlocks(layout), rewriteBlock].flatMap((write) =>
      [usualGap(layout), null].map(
        (gap) => () => writeStretches(layout, stretches, write, gap),
      ),
    ),
    () => withEol(form, layout.eol) + finalEol,
  ];
  for (const candidate of candidates) {
    const text = candidate();
    if (sourceMarkdownForm(text) === form) return text;
  }
  return page;
}

export function sourceMarkdownForm(markdown: string): string | null {
  let canonical: string;
  try {
    canonical = canonicalizeNfm(markdown);
  } catch {
    // coercion-ok: null is typed as unreadable text, which callers then compare or write exactly as it is.
    return null;
  }
  const lines = canonical.split("\n");
  while (lines[lines.length - 1] === EMPTY_BLOCK) lines.pop();
  return lines.join("\n");
}

function blockKey(node: PMNode): string {
  return docToNfm(
    { type: "doc", content: [node] },
    { keepTrailingEmptyBlock: true },
  );
}

function readsAs(markdown: string, key: string): boolean {
  return docToNfm(nfmToDoc(markdown), { keepTrailingEmptyBlock: true }) === key;
}

function withEol(text: string, eol: string): string {
  return text.replace(/\r\n?|\n/g, eol);
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

function lineBreaks(text: string): number {
  return text.match(/\r\n?|\n/g)?.length ?? 0;
}

function majorityEol(source: string): string {
  const crlf = source.match(/\r\n/g)?.length ?? 0;
  return crlf * 2 > lineBreaks(source) ? "\r\n" : "\n";
}

function withoutFinalBreaks(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed + (/^[^\r\n]*/.exec(text.slice(trimmed.length))?.[0] ?? "");
}

function readPage(form: string): PageBlock[] {
  if (isBlank(form)) return [];
  return nfmToDoc(form).content.map((node) => ({ key: blockKey(node), node }));
}

function readLayout(source: string): SourceLayout {
  const lines = source.split(/(?<=\r\n|\n|\r(?!\n))/);
  const blocks: SourceBlock[] = [];
  let leading = "";
  let gap = "";
  let line = 0;
  for (const span of locateNfmBlocks(source)) {
    if (span.nodes.length === 0) continue;
    const body = lines.slice(span.startLine, span.endLine).join("");
    const raw = withoutFinalBreaks(body);
    gap += lines.slice(line, span.startLine).join("");
    if (blocks.length === 0) {
      leading = gap;
      gap = "";
    }
    blocks.push({
      gap,
      raw,
      text: raw.replace(/\r\n?/g, "\n"),
      keys: span.nodes.map(blockKey),
      nodes: span.nodes,
    });
    gap = body.slice(raw.length);
    line = span.endLine;
  }
  return {
    leading,
    blocks,
    trailing: gap + lines.slice(line).join(""),
    eol: majorityEol(source),
  };
}

function matchKeys(
  before: readonly string[],
  after: readonly string[],
): Map<number, number> {
  const matches = new Map<number, number>();
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) {
    matches.set(prefix, prefix);
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
    matches.set(before.length - suffix, after.length - suffix);
  }

  const codes = new Map<string, string>();
  const encode = (keys: readonly string[]) =>
    keys
      .map((key) => {
        const code = codes.get(key) ?? String.fromCharCode(codes.size + 1);
        codes.set(key, code);
        return code;
      })
      .join("");
  const encodedBefore = encode(before.slice(prefix, before.length - suffix));
  const encodedAfter = encode(after.slice(prefix, after.length - suffix));
  if (codes.size >= MAX_DISTINCT_KEYS) return matches;

  let from = prefix;
  let to = prefix;
  for (const [kind, text] of new DiffMatchPatch().diff_main(
    encodedBefore,
    encodedAfter,
    false,
  )) {
    if (kind === DIFF_EQUAL) {
      for (let step = 0; step < text.length; step += 1)
        matches.set(from + step, to + step);
    }
    if (kind !== DIFF_INSERT) from += text.length;
    if (kind !== DIFF_DELETE) to += text.length;
  }
  return matches;
}

function alignBlocks(
  blocks: readonly SourceBlock[],
  page: readonly PageBlock[],
): Stretch[] {
  const matches = matchKeys(
    blocks.flatMap((block) => block.keys),
    page.map((block) => block.key),
  );
  const stretches: Stretch[] = [];
  let changed: SourceBlock[] = [];
  let written = 0;
  const writeChanged = (end: number) => {
    const inserted = page.slice(written, end);
    if (changed.length > 0 || inserted.length > 0)
      stretches.push({ kept: false, blocks: changed, page: inserted });
    changed = [];
  };
  let firstKey = 0;
  for (const block of blocks) {
    const start = matches.get(firstKey);
    const keyAt = firstKey;
    firstKey += block.keys.length;
    if (
      start === undefined ||
      !block.keys.every(
        (_, offset) => matches.get(keyAt + offset) === start + offset,
      )
    ) {
      changed.push(block);
      continue;
    }
    const end = start + block.keys.length;
    writeChanged(start);
    stretches.push({
      kept: true,
      blocks: [block],
      page: page.slice(start, end),
    });
    written = end;
  }
  writeChanged(page.length);
  return stretches;
}

function similarity(left: string, right: string): number {
  const shorter = Math.min(left.length, right.length);
  let prefix = 0;
  while (
    prefix < shorter &&
    left.charCodeAt(prefix) === right.charCodeAt(prefix)
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    left.charCodeAt(left.length - 1 - suffix) ===
      right.charCodeAt(right.length - 1 - suffix)
  )
    suffix += 1;
  return (prefix + suffix) / Math.max(left.length, right.length, 1);
}

function pairBlocks(stretch: Stretch): Map<PageBlock, SourceBlock> {
  const pairs = new Map<PageBlock, SourceBlock>();
  if (stretch.blocks.length === stretch.page.length) {
    const blocks = stretch.blocks.values();
    for (const page of stretch.page) {
      const block = blocks.next();
      if (!block.done) pairs.set(page, block.value);
    }
    return pairs;
  }
  let from = 0;
  for (const block of stretch.blocks) {
    const key = block.keys.join("\n");
    let best = MIN_PAIRING_SIMILARITY;
    let chosen: { page: PageBlock; end: number } | undefined;
    for (const [offset, page] of stretch.page
      .slice(from, from + MAX_PAIRING_CANDIDATES)
      .entries()) {
      const score = similarity(key, page.key);
      if (score < best || (chosen && score === best)) continue;
      best = score;
      chosen = { page, end: from + offset + 1 };
    }
    if (!chosen) continue;
    pairs.set(chosen.page, block);
    from = chosen.end;
  }
  return pairs;
}

function usualGap(layout: SourceLayout): string {
  const gaps = layout.blocks
    .slice(1)
    .map((block) => block.gap)
    .filter(isBlank);
  const tight = gaps.filter((gap) => lineBreaks(gap) < 2).length;
  return tight * 2 > gaps.length ? LINE_BREAK : BLANK_LINE;
}

function joinedGap(gaps: readonly string[]): string {
  if (!gaps.every(isBlank)) return gaps.join("");
  return gaps.reduce(
    (widest, gap) => (lineBreaks(gap) > lineBreaks(widest) ? gap : widest),
    "",
  );
}

function writeStretches(
  layout: SourceLayout,
  stretches: readonly Stretch[],
  write: BlockWriter,
  usual: string | null,
): string {
  const empty = layout.blocks.length === 0;
  const opening = empty ? layout.trailing : layout.leading;
  const pageIsEmpty = stretches.every((stretch) => stretch.page.length === 0);
  if (pageIsEmpty) {
    return [
      opening,
      ...layout.blocks.map((block) => block.gap),
      ...(empty ? [] : [layout.trailing]),
    ]
      .filter((text) => !isBlank(text))
      .join("");
  }

  let out = empty && isBlank(opening) ? "" : opening;
  if (empty && out !== "" && !/[\r\n]$/.test(out)) out += layout.eol;
  let passed: string[] = [];
  let reached = 0;
  let previous: { text: string; inserted: boolean } | undefined;
  const pass = (block: SourceBlock) => {
    passed.push(block.gap);
    reached += 1;
  };
  const isBeforeBlankLine = () =>
    lineBreaks(
      [
        ...passed,
        ...layout.blocks.slice(reached, reached + 1).map((next) => next.gap),
      ].join(""),
    ) > lineBreaks(LINE_BREAK);
  const add = (text: string, block: SourceBlock | undefined) => {
    const own = block ? joinedGap([...passed, block.gap]) : "";
    const needsBlankLine =
      [previous?.text ?? "", text].some((side) =>
        NEEDS_BLANK_LINE_RE.test(side),
      ) ||
      (usual !== null && !block && isBeforeBlankLine());
    const fresh = withEol(
      needsBlankLine ? BLANK_LINE : (usual ?? LINE_BREAK),
      layout.eol,
    );
    if (!previous) out += isBlank(own) ? "" : own;
    else if (!block) out += fresh;
    else if (!previous.inserted || !isBlank(own)) out += own || fresh;
    else out += lineBreaks(own) >= lineBreaks(fresh) ? own : fresh;
    out += text;
    previous = { text, inserted: !block };
    if (!block) return;
    passed = [];
    reached += 1;
  };

  for (const stretch of stretches) {
    if (stretch.kept) {
      for (const block of stretch.blocks) add(block.raw, block);
      continue;
    }
    const pairs = pairBlocks(stretch);
    const waiting = stretch.blocks.values();
    for (const page of stretch.page) {
      const block = pairs.get(page);
      const text = withEol(write(block, page), layout.eol);
      if (block) {
        for (const skipped of waiting) {
          if (skipped === block) break;
          pass(skipped);
        }
      }
      add(text, block);
    }
    for (const skipped of waiting) pass(skipped);
  }
  const dropped = passed.filter((gap) => !isBlank(gap)).join("");
  return out + dropped + (empty ? layout.eol : layout.trailing);
}

function ordinaryMarkdown(page: PageBlock): string {
  if (page.node.type !== "table") return page.key;
  const table = writePipeTable(page.node, null);
  return table !== null && readsAs(table, page.key) ? table : page.key;
}

function writesHtmlTable(block: SourceBlock): boolean {
  return /^\s*<table[\s>]/i.test(block.text);
}

function rewriteBlock(block: SourceBlock | undefined, page: PageBlock): string {
  return block &&
    (writesHtmlTable(block) || block.text === block.keys.join("\n"))
    ? page.key
    : ordinaryMarkdown(page);
}

function patchBlocks(layout: SourceLayout): BlockWriter {
  const spellings = new Map(
    layout.blocks
      .filter((block) => block.keys.length === 1)
      .map((block) => [block.keys.join(""), block.raw]),
  );
  return (block, page) =>
    spellings.get(page.key) ??
    (block ? patchBlock(block, page) : ordinaryMarkdown(page));
}

function patchBlock(block: SourceBlock, page: PageBlock): string {
  const before = block.keys.join("\n");
  if (block.text === before) return page.key;
  const attempts =
    page.node.type === "table" && !writesHtmlTable(block)
      ? [() => patchPipeTable(block, page.node)]
      : carriedEdits(block, before, page);
  for (const attempt of attempts) {
    const text = attempt();
    if (text !== null && readsAs(text, page.key)) return text;
  }
  return rewriteBlock(block, page);
}

function carriedEdits(
  block: SourceBlock,
  before: string,
  page: PageBlock,
): (() => string | null)[] {
  const styled = block.nodes.some((node) => /List$/.test(node.type))
    ? listStyle(block.text)
    : (text: string) => text;
  const from = styled(before);
  const to = styled(page.key);
  if (block.text === from) return [() => to];
  const ranges = rawRanges(from, block.text);
  const hunks = textHunks(from, to);
  return (["early", "late"] as const).flatMap((insertAt) =>
    (["early", "late"] as const).map(
      (endAt) => () => carryHunks(block.text, ranges, hunks, insertAt, endAt),
    ),
  );
}

function listStyle(raw: string): (canonical: string) => string {
  const marker = /^[ \t]*([*+]) /m.exec(raw)?.[1] ?? "-";
  const closer = /^[ \t]*\d+\) /m.test(raw) ? ")" : ".";
  const unit = /^( +)(?:[-*+]|\d+[.)]) /m.exec(raw)?.[1] ?? "\t";
  return (canonical) =>
    canonical
      .split("\n")
      .map((line) =>
        line
          .replace(/^(\t*)- (?!\[[ xX]\] )/, `$1${marker} `)
          .replace(/^(\t*\d+)\. /, `$1${closer} `)
          .replace(/^\t+/, (tabs) => unit.repeat(tabs.length)),
      )
      .join("\n");
}

function textHunks(before: string, after: string): TextHunk[] {
  const hunks: TextHunk[] = [];
  let from = 0;
  let pending: TextHunk | undefined;
  for (const [kind, text] of new DiffMatchPatch().diff_main(before, after)) {
    if (kind === DIFF_EQUAL) {
      from += text.length;
      pending = undefined;
      continue;
    }
    if (!pending) {
      pending = { from, to: from, insert: "" };
      hunks.push(pending);
    }
    if (kind === DIFF_INSERT) pending.insert += text;
    else {
      from += text.length;
      pending.to = from;
    }
  }
  return hunks;
}

function textLines(text: string): TextLine[] {
  let start = 0;
  return text.split("\n").flatMap((line) => {
    const key = line.replace(/[^\p{L}\p{N}]+/gu, "");
    const end = start + line.length;
    const span = { start, end, key };
    start = end + 1;
    return key === "" ? [] : [span];
  });
}

function pairedPieces(canonical: string, raw: string): [string, string][] {
  const from = textLines(canonical);
  const to = textLines(raw);
  const matches = matchKeys(
    from.map((line) => line.key),
    to.map((line) => line.key),
  );
  const rawLineAt = new Map(to.entries());
  const pieces: [string, string][] = [];
  let at = 0;
  let offset = 0;
  const cut = (end: number, rawEnd: number) => {
    pieces.push([canonical.slice(at, end), raw.slice(offset, rawEnd)]);
    at = end;
    offset = rawEnd;
  };
  for (const [index, line] of from.entries()) {
    const rawLine = rawLineAt.get(matches.get(index) ?? -1);
    if (!rawLine) continue;
    cut(line.start, rawLine.start);
    cut(line.end, rawLine.end);
  }
  cut(canonical.length, raw.length);
  return pieces;
}

function rawRanges(canonical: string, raw: string): Map<number, RawRange> {
  const ranges = new Map<number, RawRange>([[0, { early: 0, late: 0 }]]);
  let at = 0;
  let offset = 0;
  const differ = new DiffMatchPatch();
  for (const [kind, text] of pairedPieces(canonical, raw).flatMap((piece) =>
    differ.diff_main(...piece),
  )) {
    if (kind === DIFF_INSERT) {
      offset += text.length;
      ranges.set(at, { early: ranges.get(at)?.early ?? offset, late: offset });
      continue;
    }
    for (let step = 0; step < text.length; step += 1) {
      at += 1;
      if (kind === DIFF_EQUAL) offset += 1;
      ranges.set(at, { early: offset, late: offset });
    }
  }
  return ranges;
}

function carryHunks(
  raw: string,
  ranges: ReadonlyMap<number, RawRange>,
  hunks: readonly TextHunk[],
  insertAt: keyof RawRange,
  endAt: keyof RawRange,
): string | null {
  let out = "";
  let written = 0;
  for (const hunk of hunks) {
    const from = ranges.get(hunk.from);
    const to = ranges.get(hunk.to);
    if (!from || !to) return null;
    const insertion = hunk.from === hunk.to;
    const start = insertion ? from[insertAt] : from.late;
    const end = insertion ? start : to[endAt];
    if (start < written || end < start) return null;
    out += raw.slice(written, start) + hunk.insert;
    written = end;
  }
  return out + raw.slice(written);
}

function patchPipeTable(block: SourceBlock, table: PMNode): string | null {
  const before = block.nodes.find((node) => node.type === "table");
  if (!before || block.nodes.length > 1) return null;
  return writePipeTable(table, {
    table: before,
    lines: block.text.split("\n"),
  });
}

function tableRows(table: PMNode): PMNode[] {
  return table.content ?? [];
}

function pipeCells(row: PMNode): string[] | null {
  const cells = (row.content ?? []).map((cell) =>
    escapeGfmPipes(serializeCellInline(cell)),
  );
  const fits = cells.every(
    (cell) =>
      !cell.includes("\n") && splitGfmPipeRow(`| ${cell} |`)?.length === 1,
  );
  return fits ? cells : null;
}

function columnAlignments(table: PMNode): string[] {
  return tableRows(table)
    .slice(0, 1)
    .flatMap((row) => row.content ?? [])
    .map((cell) => String(cell.attrs?.textAlign ?? ""));
}

function delimiterCell(alignment: string): string {
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return alignment === "left" ? ":---" : "---";
}

function pipeLine(line: string): { width: number; areas: number[] } {
  const value = line.trim();
  return {
    width: value.length,
    areas: value
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((area) => area.length),
  };
}

function writePipeTable(
  table: PMNode,
  prior: { table: PMNode; lines: string[] } | null,
): string | null {
  const rows: string[][] = [];
  for (const row of tableRows(table)) {
    const cells = pipeCells(row);
    if (!cells) return null;
    rows.push(cells);
  }
  const header = prior?.lines.find((_, index) => index === 0) ?? "| |";
  const delimiter = prior?.lines.find((_, index) => index === 1) ?? "";
  const priorLines = new Map(
    prior?.lines.filter((_, index) => index !== 1).entries(),
  );
  const priorRows = (prior ? tableRows(prior.table) : []).map((row, index) => ({
    cells: pipeCells(row) ?? [],
    line: priorLines.get(index) ?? "",
  }));
  const priorRowAt = new Map(priorRows.entries());

  const indent = /^\t*/.exec(header)?.[0] ?? "";
  const open = header.trimStart().startsWith("|") ? "|" : "";
  const close = header.trimEnd().endsWith("|") ? "|" : "";
  const headerLine = pipeLine(header);
  const delimiterLine = pipeLine(delimiter);
  const areas =
    prior && headerLine.width === delimiterLine.width
      ? delimiterLine.areas
      : [];
  const writeRow = (cells: readonly string[], padded: readonly number[]) => {
    const widths = new Map(padded.entries());
    const line = cells
      .map((cell, index) => ` ${cell} `.padEnd(widths.get(index) ?? 0))
      .join("|");
    const row = open + (open ? line : line.trimStart());
    return indent + (close ? row + close : row.trimEnd());
  };

  const matches = matchKeys(
    priorRows.map((row) => JSON.stringify(row.cells)),
    rows.map((row) => JSON.stringify(row)),
  );
  const keptRows = new Map(
    Array.from(matches, ([from, to]) => [to, from] as const),
  );
  let next = 0;
  const lines = rows.map((cells, index) => {
    const kept = keptRows.get(index);
    if (kept !== undefined) {
      next = kept + 1;
      return priorRowAt.get(kept)?.line ?? "";
    }
    const paired = matches.has(next) ? undefined : priorRowAt.get(next);
    if (!paired) return writeRow(cells, areas);
    next += 1;
    const raw = new Map((splitGfmPipeRow(paired.line) ?? []).entries());
    const before = new Map(paired.cells.entries());
    const reused = cells.map((cell, at) =>
      paired.cells.length === cells.length && before.get(at) === cell
        ? (raw.get(at) ?? cell)
        : cell,
    );
    return writeRow(reused, areas);
  });

  const alignments = columnAlignments(table);
  const keepsDelimiter =
    prior !== null &&
    JSON.stringify(columnAlignments(prior.table)) ===
      JSON.stringify(alignments);
  const delimiterRow = keepsDelimiter
    ? delimiter
    : writeRow(alignments.map(delimiterCell), []);
  return lines
    .flatMap((line, index) => (index === 0 ? [line, delimiterRow] : [line]))
    .join("\n");
}
