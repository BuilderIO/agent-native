import { createHash } from "node:crypto";

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { canonicalizeNfm, nfmToDoc, type PMNode } from "../shared/nfm.js";

// Pure classification for the stored-form census: what kind of difference
// separates a stored body from `canonicalizeNfm(body)`, and whether
// canonicalizing would lose anything. Nothing here returns page text.

// Larger bodies and live copies are counted without being parsed. Parsing has
// no deadline: Content's parser is quadratic in the length of a line that
// holds a long run of spaces or `[` (about 1.5 seconds per parse at 40 KiB)
// and roughly cubic in how deeply `<details>` nest, and the GFM reader is
// quadratic in how deeply a line nests (`- - - …`, `> > > …`, or a list
// indented one more level per line), overflowing the stack past a few
// thousand levels, and in how many emphasis delimiters one paragraph holds.
// These caps are what keep one page inside the snapshot's 10-minute idle
// limit: the slowest page found under them takes about 16 seconds to
// classify.
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_LINE_CHARS = 32 * 1024;
export const MAX_NESTING = 100;
// Only the GFM reader slows on emphasis (16,384 runs of `*a**` in one
// paragraph took four and a half seconds), and it reads only stored bodies
// and the raw blocks Content keeps from them verbatim. Lines without a blank
// line between them are one paragraph to it, and a Content page writes none.
// A `_` between letters or digits can neither open nor close emphasis, and
// costs nothing to read.
export const MAX_EMPHASIS_RUNS = 8192;
// Each `_` alternative starts only where a run starts, so no run is rescanned
// from inside it.
const EMPHASIS_RUN = /\*+|~+|(?<![\p{L}\p{N}_])_+|(?<!_)_+(?![\p{L}\p{N}_])/gu;
// Content's parser reads a bare CR as a line break too.
const LINE_END = /\r\n?|\n/g;
// Consumes only spaces, tabs and marker characters, so it never runs past the
// end of a line. A list marker may end its line: an empty item still nests.
const CONTAINER_MARKER = /([ \t]*)(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t\r\n]|$))/y;
// The tags of CONTAINER_CLOSE in shared/nfm.ts, read after a line's tabs as
// matchContainerOpen and its scanners read them. A table closes on its first
// `</table>`, whatever surrounds it.
const CONTAINER_OPEN =
  /^<(?:(details|callout|table|synced_block_reference|synced_block)[ >]|(columns|column|meeting-notes)>$)/;
const CONTAINER_CLOSE =
  /^<\/(details|callout|columns|column|table|synced_block_reference|synced_block|meeting-notes)>$/;
const CONTENT_FENCE = /^(`{3,})(.*)$/;

/**
 * Whether the census's parsers can read `text` within the caps above. A line
 * is as deep as the Content containers open around it, plus its container
 * markers, plus the list levels the indentation before them can continue, at
 * two columns each and up to four per tab, so nesting cannot pass by adding
 * one level per line.
 *
 * A container counts as closed only by the close of the innermost one open,
 * at the same tabs, outside a code fence: Content pairs closes by tag and
 * indentation and skips fenced lines. Its code blocks end on lines its fence
 * scanners do not, so a container line inside a fence may still open one.
 * Once a close or a fenced container line breaks that shape, no close can be
 * trusted: from there every container opened so far counts, which also bounds
 * the opens left unclosed, each of which Content scans to the end of its
 * parent. Content rereads a container's lines once per level around them and
 * its canonical form indents them once per level, so their total depth is
 * held to the body cap.
 */
export function withinParserLimits(text: string): boolean {
  if (text.length > MAX_BODY_BYTES) return false;
  const open: Array<{ tag: string; tabs: number }> = [];
  let opened = 0;
  let paired = true;
  let fence = 0;
  let indentation = 0;
  for (let start = 0; start <= text.length; ) {
    LINE_END.lastIndex = start;
    const end = LINE_END.exec(text);
    const stop = end ? end.index : text.length;
    if (stop - start > MAX_LINE_CHARS) return false;
    const line = text.slice(start, stop);
    const tabs = line.length - line.replace(/^\t+/, "").length;
    const bare = line.slice(tabs);
    const opens = CONTAINER_OPEN.exec(bare);
    const closes =
      CONTAINER_CLOSE.exec(bare)?.[1] ??
      (line.trim() === "</table>" ? "table" : undefined);
    if (opens) opened++;
    const run = CONTENT_FENCE.exec(bare);
    if (fence) {
      if (opens || closes) paired = false;
      if (run && !run[2].trim() && run[1].length >= fence) fence = 0;
    } else if (run) {
      fence = run[1].length;
    } else if (opens) {
      open.push({ tag: opens[1] ?? opens[2], tabs });
    } else if (closes && open.length) {
      const top = open[open.length - 1];
      if (top.tag === closes && (closes === "table" || top.tabs === tabs))
        open.pop();
      else paired = false;
    }
    const containers = paired ? open.length : opened;
    indentation += containers;
    if (indentation > MAX_BODY_BYTES) return false;
    CONTAINER_MARKER.lastIndex = start;
    let depth = containers;
    for (let marker; (marker = CONTAINER_MARKER.exec(text)); )
      depth += 1 + marker[1].replace(/\t/g, "    ").length / 2;
    if (depth > MAX_NESTING) return false;
    start = end ? stop + end[0].length : stop + 1;
  }
  return true;
}

/** Whether no paragraph of `text` holds more emphasis runs than the cap. */
export function withinEmphasisLimit(text: string): boolean {
  let runs = 0;
  for (const line of text.split(LINE_END)) {
    runs = /^[ \t]*$/.test(line)
      ? 0
      : runs + (line.match(EMPHASIS_RUN)?.length ?? 0);
    if (runs > MAX_EMPHASIS_RUNS) return false;
  }
  return true;
}

export type BodyClassification =
  | { status: "canonical"; losses: string[] }
  | { status: "failed" }
  | { status: "readerFailed" }
  | { status: "pastParserLimits" }
  | {
      status: "non-canonical";
      canonical: string;
      kinds: string[];
      losses: string[];
      idempotence: "idempotent" | "changes" | "throws";
    };

type Normalizer = { kind: string; apply: (text: string) => string };

const PIPE_ROW = /^\s*\|.*\|\s*$/;

// Order matters only for which kinds a hunk is first tried with; every hunk
// is pruned to the smallest set of these that still explains it. Line-shape
// rules run before inline ones so `___` reads as a divider, not emphasis.
// A run of blanks is matched only from its first blank (`(?<![ \t])`):
// starting inside the run too would rescan it from each position.
const NORMALIZERS: Normalizer[] = [
  {
    kind: "trailing-whitespace",
    apply: (text) => text.replace(/(?<![ \t])[ \t]+$/gm, ""),
  },
  {
    kind: "blank-lines",
    apply: (text) => text.replace(/^[ \t]*\n/gm, ""),
  },
  {
    kind: "thematic-break",
    apply: (text) =>
      text.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "---"),
  },
  {
    kind: "code-fence",
    apply: (text) => text.replace(/^([ \t]*)~{3,}/gm, "$1```"),
  },
  {
    kind: "list-markers",
    apply: (text) =>
      text
        .replace(/^([ \t]*)[*+](?=[ \t])/gm, "$1-")
        .replace(/^([ \t]*)\d{1,9}([.)])(?=[ \t])/gm, "$11."),
  },
  {
    // The body escaped a character Content does not treat as escapable, so
    // the canonical form keeps the backslash as text and escapes it.
    kind: "escape-kept-as-backslash",
    apply: (text) => text.replace(/\\\\/g, "\\"),
  },
  {
    kind: "backslash-escapes",
    apply: (text) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1"),
  },
  {
    kind: "indentation",
    apply: (text) => text.replace(/^[ \t]+/gm, ""),
  },
  {
    kind: "table-cell-spacing",
    apply: (text) =>
      text
        .split("\n")
        .map((line) =>
          PIPE_ROW.test(line)
            ? line.replace(/(?<![ \t])[ \t]+(?=\|)|(?<=\|)[ \t]+/g, "")
            : line,
        )
        .join("\n"),
  },
  {
    kind: "emphasis-markers",
    apply: (text) =>
      text
        .replace(/__(?=\S)([^_\n]*?\S)__/g, "**$1**")
        .replace(/(^|[^\w*])_(?=\S)([^_\n]*?\S)_(?![\w])/g, "$1*$2*"),
  },
  {
    kind: "html-entities",
    apply: (text) =>
      text
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&"),
  },
  {
    kind: "inline-spacing",
    apply: (text) => text.replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 "),
  },
];

type Hunk = { removed: string[]; added: string[] };

const MAX_DIFF_CELLS = 4_000_000;

/** Line hunks between two texts; a middle too large to align is one hunk. */
export function diffLineHunks(before: string[], after: string[]): Hunk[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_DIFF_CELLS)
    return [{ removed: a, added: b }];

  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      current = null;
      i += 1;
      j += 1;
      continue;
    }
    current ??= hunks[hunks.push({ removed: [], added: [] }) - 1];
    if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      current.removed.push(a[i]);
      i += 1;
    } else {
      current.added.push(b[j]);
      j += 1;
    }
  }
  return hunks;
}

function applyOnce(normalizers: readonly Normalizer[], text: string): string {
  return normalizers.reduce(
    (value, normalizer) => normalizer.apply(value),
    text,
  );
}

// Kinds are tried greedily first and, when that fails, as every small subset,
// because one kind can block another (`~~~` turned into a fence hides that
// the canonical form escaped it). Each normalizer runs once: repeating them
// would let `backslash-escapes` unescape its own output and swallow
// `escape-kept-as-backslash`.
const MAX_SEARCHED_KINDS = 3;
const MAX_SEARCHED_HUNK_CHARS = 20_000;

function* subsetsOfSize(size: number, from = 0): Generator<Normalizer[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let index = from; index <= NORMALIZERS.length - size; index += 1) {
    for (const rest of subsetsOfSize(size - 1, index + 1))
      yield [NORMALIZERS[index], ...rest];
  }
}

/** The hunk with a pipe table's rows and the Content table they became removed. */
function withoutTableConversion(hunk: Hunk): Hunk | null {
  if (
    !hunk.removed.some((line) => PIPE_ROW.test(line)) ||
    !hunk.added.some((line) => /<table\b/.test(line))
  )
    return null;
  let inTable = false;
  const added = hunk.added.filter((line) => {
    if (/<table\b/.test(line)) inTable = true;
    const outside = !inTable;
    if (/<\/table>/.test(line)) inTable = false;
    return outside;
  });
  return {
    removed: hunk.removed.filter((line) => !PIPE_ROW.test(line)),
    added,
  };
}

/** The smallest set of difference kinds that turns `removed` into `added`. */
export function explainHunk(hunk: Hunk): string[] {
  // Edits next to a table share its hunk, so they are explained on their own.
  const rest = withoutTableConversion(hunk);
  if (rest) {
    const others =
      rest.removed.length + rest.added.length > 0 ? explainHunk(rest) : [];
    return ["gfm-pipe-table-to-content-table", ...others];
  }
  // Each line keeps its terminator so a hunk that only drops blank lines
  // still differs from an empty one.
  const removed = hunk.removed.map((line) => `${line}\n`).join("");
  const added = hunk.added.map((line) => `${line}\n`).join("");
  const explains = (normalizers: readonly Normalizer[]) =>
    applyOnce(normalizers, removed) === applyOnce(normalizers, added);

  let a = removed;
  let b = added;
  const used: Normalizer[] = [];
  for (const normalizer of NORMALIZERS) {
    if (a === b) break;
    const nextA = normalizer.apply(a);
    const nextB = normalizer.apply(b);
    if (nextA === a && nextB === b) continue;
    used.push(normalizer);
    a = nextA;
    b = nextB;
  }
  if (a === b) {
    for (const normalizer of [...used]) {
      const rest = used.filter((candidate) => candidate !== normalizer);
      if (explains(rest)) used.splice(used.indexOf(normalizer), 1);
    }
    return used.map((normalizer) => normalizer.kind);
  }
  if (removed.length + added.length > MAX_SEARCHED_HUNK_CHARS)
    return ["unclassified-too-large-to-search"];
  for (let size = 1; size <= MAX_SEARCHED_KINDS; size += 1) {
    for (const subset of subsetsOfSize(size))
      if (explains(subset)) return subset.map((normalizer) => normalizer.kind);
  }
  return ["unclassified"];
}

export function differenceKinds(body: string, canonical: string): string[] {
  const kinds = new Set<string>();
  let source = body;
  if (/\r/.test(source)) {
    kinds.add("line-endings");
    source = source.replace(/\r\n?/g, "\n");
  }
  for (const hunk of diffLineHunks(source.split("\n"), canonical.split("\n"))) {
    for (const kind of explainHunk(hunk)) kinds.add(kind);
  }
  return [...kinds].sort();
}

type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  identifier?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/**
 * What one reader sees in a body. `letters` holds every letter and digit of
 * its text in reading order, and each mark the positions in it that it covers.
 * Code counts fenced blocks and blocks indented with spaces: Content writes
 * indented children with tabs, which a GFM reader would otherwise count as
 * indented code.
 */
type ReadProfile = {
  tokens: Map<string, number>;
  backslashes: number;
  letters: string[];
  marks: Record<(typeof MARKS)[number], number[]>;
  listItems: number;
  nestedListItems: number;
  headings: number;
  tables: number;
  codeBlocks: number;
  blockquotes: number;
  images: number;
};

const MARKS = ["strong", "emphasis", "delete", "inlineCode", "link"] as const;

const NFM_MARK: Record<string, (typeof MARKS)[number]> = {
  bold: "strong",
  italic: "emphasis",
  strike: "delete",
  code: "inlineCode",
  link: "link",
};

const TOKEN = /[\p{L}\p{N}]+/gu;
// The attributes that hold text a reader sees: a toggle's summary, an atom's
// label (an equation's LaTeX, a bookmark's title) and a video's caption.
const TEXT_ATTRIBUTES = ["label", "summary", "title"] as const;

function emptyProfile(): ReadProfile {
  return {
    tokens: new Map(),
    backslashes: 0,
    letters: [],
    marks: Object.fromEntries(
      MARKS.map((mark): [Mark, number[]] => [mark, []]),
    ) as ReadProfile["marks"],
    listItems: 0,
    nestedListItems: 0,
    headings: 0,
    tables: 0,
    codeBlocks: 0,
    blockquotes: 0,
    images: 0,
  };
}

const PROFILE_COUNTS = [
  "backslashes",
  "listItems",
  "nestedListItems",
  "headings",
  "tables",
  "codeBlocks",
  "blockquotes",
  "images",
] as const;

/** Adds what `part` read, as text that follows `profile`'s so far. */
function appendProfile(profile: ReadProfile, part: ReadProfile) {
  const offset = profile.letters.length;
  for (const letter of part.letters) profile.letters.push(letter);
  for (const mark of MARKS)
    for (const index of part.marks[mark])
      profile.marks[mark].push(index + offset);
  for (const [token, count] of part.tokens)
    profile.tokens.set(token, (profile.tokens.get(token) ?? 0) + count);
  for (const key of PROFILE_COUNTS) profile[key] += part[key];
}

function addTokens(profile: ReadProfile, text: string) {
  for (const token of text.matchAll(TOKEN)) {
    const key = token[0].toLowerCase();
    profile.tokens.set(key, (profile.tokens.get(key) ?? 0) + 1);
  }
}

function addText(profile: ReadProfile, text: string) {
  addTokens(profile, text);
  profile.backslashes += text.split("\\").length - 1;
}

const gfmReader = unified().use(remarkParse).use(remarkGfm);

// Content's own syntax, which no agent writes as prose: tags such as
// `<callout>` or `<table_of_contents/>` and trailing `{color="red"}` block
// attributes. A GFM reader would count their names as words Content dropped.
// A line holding only tags becomes an HTML comment rather than a blank line,
// so the tab-indented children after it cannot continue a list above it.
// Code is left as written: a tag inside it is text both readers keep.
const NFM_TAG = String.raw`<\/?[A-Za-z][\w-]*(?:\s+[\w-]+(?:="[^"]*")?)*\s*\/?>`;
const NFM_TAG_LINE = new RegExp(
  String.raw`^([ \t]*)(?:${NFM_TAG}[ \t]*)+$`,
  "m",
);
const NFM_INLINE_TAG = new RegExp(NFM_TAG, "g");
// The character before the attributes is not blank, so a long run of spaces
// is crossed once rather than from each of its positions.
const NFM_BLOCK_ATTRIBUTES =
  /(^|[^\\ \t])[ \t]*\{[a-z][\w-]*="[^"]*"(?:[ \t]+[a-z][\w-]*="[^"]*")*\}[ \t]*$/m;
// A fence may open inside blockquotes and list items: `> ```js`, `- ```js`.
// It closes only at its own quote depth and never after a list marker, which
// inside the fence is code; a quote that ends takes its fence with it.
// Markers leave the blanks after them to the next `[ \t]*`: if two parts
// could each take them, a line of markers such as `-   -   -` is retried for
// every split of every run, which grows exponentially with the markers.
const FENCE =
  /^((?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t])))*)[ \t]*(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})[ \t]*$/;
const QUOTE_MARKERS = /^(?:[ \t]*>)*/;
const BACKTICK_RUN = /`+/g;

function quoteDepth(prefix: string): number {
  return prefix.split(">").length - 1;
}

function outsideCodeSpans(line: string, edit: (text: string) => string) {
  let result = "";
  let textStart = 0;
  BACKTICK_RUN.lastIndex = 0;
  for (let open; (open = BACKTICK_RUN.exec(line)); ) {
    const closer = new RegExp(`(?<!\`)${open[0]}(?!\`)`, "g");
    closer.lastIndex = BACKTICK_RUN.lastIndex;
    const close = closer.exec(line);
    if (!close) continue;
    const end = close.index + open[0].length;
    result +=
      edit(line.slice(textStart, open.index)) + line.slice(open.index, end);
    textStart = BACKTICK_RUN.lastIndex = end;
  }
  return result + edit(line.slice(textStart));
}

function withoutNfmSyntax(body: string): string {
  let fence: { marker: string; depth: number } | null = null;
  return body
    .split("\n")
    .map((line) => {
      if (fence !== null) {
        const depth = quoteDepth(QUOTE_MARKERS.exec(line)![0]);
        const closer = CLOSING_FENCE.exec(line)?.[1];
        if (
          depth === fence.depth &&
          closer?.[0] === fence.marker[0] &&
          closer.length >= fence.marker.length
        ) {
          fence = null;
          return line;
        }
        if (depth >= fence.depth) return line;
        fence = null;
      }
      const [, prefix = "", marker, rest = ""] = FENCE.exec(line) ?? [];
      // A backtick fence's info string has no backticks; "```x```" is code.
      if (marker && !(marker[0] === "`" && rest.includes("`"))) {
        fence = { marker, depth: quoteDepth(prefix) };
        return line;
      }
      if (NFM_TAG_LINE.test(line))
        return line.replace(NFM_TAG_LINE, "$1<!-- -->");
      return outsideCodeSpans(line, (text) =>
        text.replace(NFM_INLINE_TAG, " "),
      ).replace(NFM_BLOCK_ATTRIBUTES, "$1");
    })
    .join("\n");
}

type Mark = (typeof MARKS)[number];

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/**
 * Append the letters and digits of `text`, under `marks`. Coverage does not
 * depend on how a reader splits text: GFM nests `` `a`**`b`** `` in two code
 * nodes Content keeps as one, and `**kept**__lost__` is one run of bold to GFM
 * although Content keeps only half of it.
 */
function addMarkedText(
  profile: ReadProfile,
  marks: Iterable<Mark>,
  text: string,
) {
  const start = profile.letters.length;
  for (const letter of text.toLowerCase().match(LETTER_OR_DIGIT) ?? [])
    profile.letters.push(letter);
  for (const mark of marks) {
    for (let index = start; index < profile.letters.length; index += 1)
      profile.marks[mark].push(index);
  }
}

/**
 * Marks GFM puts on text that Content's reading leaves unmarked. When both
 * readers see the same letters in the same order, marks are compared by
 * position, so one cannot move to other text unnoticed: in `*a * _a_` GFM
 * italicizes the second a and Content the first. Otherwise (text was dropped,
 * or Content holds it in an attribute) they are compared by how often each
 * letter is marked.
 */
function droppedMarks(meant: ReadProfile, kept: ReadProfile): Mark[] {
  const aligned =
    meant.letters.length === kept.letters.length &&
    meant.letters.every((letter, index) => letter === kept.letters[index]);
  const markedLetters = (profile: ReadProfile, mark: Mark) => {
    const counts = new Map<string, number>();
    for (const index of profile.marks[mark]) {
      const letter = profile.letters[index];
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
    return counts;
  };
  return MARKS.filter((mark) => {
    if (aligned) {
      const keptAt = new Set(kept.marks[mark]);
      return meant.marks[mark].some((index) => !keptAt.has(index));
    }
    const keptCounts = markedLetters(kept, mark);
    return [...markedLetters(meant, mark)].some(
      ([letter, count]) => (keptCounts.get(letter) ?? 0) < count,
    );
  });
}

/** What a GitHub-flavored Markdown reader sees, which is how agents write. */
function gfmProfile(body: string): ReadProfile {
  const markdown = withoutNfmSyntax(body);
  const profile = emptyProfile();
  const walk = (node: MdNode, listDepth: number, marks: ReadonlySet<Mark>) => {
    let inner = marks;
    switch (node.type) {
      case "strong":
      case "emphasis":
      case "delete":
        inner = new Set(marks).add(node.type);
        break;
      case "text":
        addText(profile, node.value ?? "");
        addMarkedText(profile, marks, node.value ?? "");
        break;
      case "inlineCode":
        addText(profile, node.value ?? "");
        addMarkedText(
          profile,
          new Set(marks).add("inlineCode"),
          node.value ?? "",
        );
        break;
      case "link":
      case "linkReference": {
        // A bare URL that GFM links by itself is a display choice, not markup
        // the writer chose, so only `[text](url)`, `[text][ref]` and `<url>`
        // count.
        const first = markdown[node.position?.start.offset ?? 0];
        if (first === "[" || first === "<") inner = new Set(marks).add("link");
        break;
      }
      case "code": {
        addText(profile, node.value ?? "");
        addMarkedText(profile, [], node.value ?? "");
        // Indented code starts at its own indent, after any container marker.
        const offset = node.position?.start.offset ?? 0;
        if (
          /^(?: {4}|[ \t]*(?:`{3,}|~{3,}))/.test(
            markdown.slice(offset, offset + 64),
          )
        )
          profile.codeBlocks += 1;
        break;
      }
      case "html":
        if (/<table\b/i.test(node.value ?? "")) profile.tables += 1;
        break;
      case "heading": {
        // `Text` over exactly `---` is how Content writes a paragraph then a
        // divider; any other setext underline is a heading.
        const source = markdown.slice(
          node.position?.start.offset ?? 0,
          node.position?.end.offset ?? 0,
        );
        const underline = source.slice(source.lastIndexOf("\n") + 1);
        if (!(node.depth === 2 && /^[ \t>]*---$/.test(underline)))
          profile.headings += 1;
        break;
      }
      case "table":
        profile.tables += 1;
        break;
      case "blockquote":
        profile.blockquotes += 1;
        break;
      case "image":
      case "imageReference":
        profile.images += 1;
        break;
      case "listItem":
        profile.listItems += 1;
        if (listDepth > 1) profile.nestedListItems += 1;
        break;
    }
    const childDepth = node.type === "list" ? listDepth + 1 : listDepth;
    for (const child of node.children ?? []) walk(child, childDepth, inner);
  };
  walk(gfmReader.parse(markdown) as MdNode, 0, new Set());
  return profile;
}

/**
 * What Content's own reader keeps of a body. Words in an attribute a reader
 * sees count as kept; addresses, colors and other serialized settings do
 * not, since their words could stand in for dropped ones.
 */
function nfmProfile(document: PMNode): ReadProfile {
  const profile = emptyProfile();
  const addAttributeText = (attrs: Record<string, unknown> | undefined) => {
    // Content writes a raw block back as it read it, so it keeps everything a
    // GFM reader sees in that source, formatting included; the block's other
    // attributes repeat parts of it.
    if (typeof attrs?.__raw === "string") {
      appendProfile(profile, gfmProfile(attrs.__raw));
      return;
    }
    for (const name of TEXT_ATTRIBUTES) {
      const value = attrs?.[name];
      if (typeof value === "string") addTokens(profile, value);
    }
  };
  const walk = (node: PMNode, listDepth: number) => {
    if (typeof node.text === "string") {
      addText(profile, node.text);
      addMarkedText(
        profile,
        (node.marks ?? []).flatMap((mark) => NFM_MARK[mark.type] ?? []),
        node.text,
      );
    }
    addAttributeText(node.attrs);
    switch (node.type) {
      case "heading":
        profile.headings += 1;
        break;
      case "notionToggle":
        if (node.attrs?.headingLevel) profile.headings += 1;
        break;
      case "table":
        profile.tables += 1;
        break;
      case "codeBlock":
        profile.codeBlocks += 1;
        break;
      case "blockquote":
        profile.blockquotes += 1;
        break;
      case "image":
        profile.images += 1;
        break;
      case "listItem":
      case "taskItem":
        profile.listItems += 1;
        if (listDepth > 1) profile.nestedListItems += 1;
        break;
    }
    const children = node.content ?? [];
    const isList = ["bulletList", "orderedList", "taskList"].includes(
      node.type,
    );
    for (const child of children)
      walk(child, isList ? listDepth + 1 : listDepth);
  };
  walk(document, 0);
  return profile;
}

function editorText(document: PMNode): string {
  // Comment anchors are captured from this text: every text node joined with
  // no separator, the way the editor's buildDocText reads the document.
  let text = "";
  const walk = (node: PMNode) => {
    if (typeof node.text === "string") text += node.text;
    node.content?.forEach(walk);
  };
  walk(document);
  return text;
}

/**
 * What canonicalizing `body` would lose. `gfm-*` losses are content a
 * GitHub-flavored reader sees in the stored body, which is how agents write
 * it, that Content's reading of the canonical form does not keep; a body can
 * be byte-for-byte canonical and still lose this. They are counts, not an
 * alignment, so they err toward missing a loss rather than inventing one.
 * `nfm-*` losses are changes canonicalizing makes to the document Content's
 * own reader parsed.
 */
export function canonicalizationLosses(
  body: string,
  canonical: string,
): string[] {
  const losses: string[] = [];
  const parsedCanonical = nfmToDoc(canonical);
  if (canonical !== body) {
    const parsedBody = nfmToDoc(body);
    if (JSON.stringify(parsedBody) !== JSON.stringify(parsedCanonical)) {
      losses.push(
        editorText(parsedBody) === editorText(parsedCanonical)
          ? "nfm-structure-changed"
          : "nfm-text-changed",
      );
    }
  }
  const meant = gfmProfile(body);
  const kept = nfmProfile(parsedCanonical);
  for (const [token, count] of meant.tokens) {
    if ((kept.tokens.get(token) ?? 0) < count) {
      losses.push("gfm-text-dropped");
      break;
    }
  }
  if (kept.backslashes > meant.backslashes)
    losses.push("gfm-escape-shown-literally");
  for (const mark of droppedMarks(meant, kept))
    losses.push(`gfm-${mark}-dropped`);
  if (kept.nestedListItems < meant.nestedListItems)
    losses.push("gfm-list-nesting-lost");
  if (kept.listItems < meant.listItems) losses.push("gfm-list-items-lost");
  if (kept.headings < meant.headings) losses.push("gfm-headings-lost");
  if (kept.tables < meant.tables) losses.push("gfm-tables-lost");
  if (kept.codeBlocks < meant.codeBlocks) losses.push("gfm-code-blocks-lost");
  if (kept.blockquotes < meant.blockquotes) losses.push("gfm-blockquotes-lost");
  if (kept.images < meant.images) losses.push("gfm-images-lost");
  return losses;
}

export function classifyBody(body: string): BodyClassification {
  if (!withinParserLimits(body) || !withinEmphasisLimit(body))
    return { status: "pastParserLimits" };
  let canonical: string;
  try {
    canonical = canonicalizeNfm(body);
  } catch {
    return { status: "failed" };
  }
  // Content's reader parses the canonical form here and in the scan's comment
  // and suggestion checks, and canonicalizing can make it longer and deeper
  // than the body: 400 nested `<details>` grow from 16 KiB to 251 KiB.
  if (canonical !== body && !withinParserLimits(canonical))
    return { status: "pastParserLimits" };
  // The census's own readers can fail where Content's did not, such as on
  // nesting deep enough to exhaust the stack.
  let losses: string[];
  let kinds: string[];
  try {
    losses = canonicalizationLosses(body, canonical);
    kinds = canonical === body ? [] : differenceKinds(body, canonical);
  } catch {
    return { status: "readerFailed" };
  }
  if (canonical === body) return { status: "canonical", losses };
  let idempotence: "idempotent" | "changes" | "throws";
  try {
    idempotence =
      canonicalizeNfm(canonical) === canonical ? "idempotent" : "changes";
  } catch {
    idempotence = "throws";
  }
  return {
    status: "non-canonical",
    canonical,
    kinds,
    losses,
    idempotence,
  };
}

/** The editor text a comment's quote is anchored against. */
export function commentAnchorText(markdown: string): string {
  return editorText(nfmToDoc(markdown));
}

const CANONICALIZER_PROBES = [
  "Plain paragraph",
  "snake\\_case and \\*stars\\*",
  "__bold__ and _em_ and *em*",
  "- a\n    - four-space child\n  - two-space child",
  "* star\n+ plus\n3. three",
  "| a | b |\n|---|---|\n|  edge  | x |",
  "Price $60 and 50%",
  "Line one\r\nLine two\r\n",
  "~~~\ncode\n~~~",
  "***",
  "<https://example.com>",
  "Heading\n=======",
  "a  b",
];

/**
 * Identifies the canonicalizer behavior a report was made with, so a re-run
 * after a canonicalizer change can be told apart from one before it.
 */
export function canonicalizerFingerprint(): string {
  const hash = createHash("sha256");
  for (const probe of CANONICALIZER_PROBES) {
    let output: string;
    try {
      output = canonicalizeNfm(probe);
    } catch (error) {
      output = `!${error instanceof Error ? error.name : "error"}`;
    }
    hash.update(`${probe}\u0000${output}\u0000`);
  }
  return hash.digest("hex").slice(0, 16);
}
