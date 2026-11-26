import { mostlyRewritten } from "@shared/suggestion-diff";

export interface WordDiffSegment {
  kind: "same" | "removed" | "added";
  text: string;
}

const TOKEN = /[\p{L}\p{M}\p{N}](?:\S*[\p{L}\p{M}\p{N}])?\s*|\S\s*|\s+/gu;
/** Above this many token pairs, show the middle as one replacement. */
const MAX_TABLE_CELLS = 40_000;

function push(
  segments: WordDiffSegment[],
  kind: WordDiffSegment["kind"],
  text: string,
) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

/**
 * Words both sides keep, position by position. Their trailing space may differ,
 * so it's marked as changed and each side still reads as written.
 */
function pushSame(
  segments: WordDiffSegment[],
  before: readonly string[],
  after: readonly string[],
) {
  for (const [index, token] of after.entries()) {
    const [beforeToken = token] = before.slice(index, index + 1);
    const word = token.trimEnd();
    const beforeSpace = beforeToken.slice(word.length);
    const afterSpace = token.slice(word.length);
    push(segments, "same", word);
    if (beforeSpace === afterSpace) {
      push(segments, "same", afterSpace);
    } else {
      push(segments, "removed", beforeSpace);
      push(segments, "added", afterSpace);
    }
  }
}

/** Word-level diff of an applied edit, for a compact before → after view. */
export function wordDiff(before: string, after: string): WordDiffSegment[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const same = (x: string, y: string) => x.trimEnd() === y.trimEnd();
  let start = 0;
  while (start < a.length && start < b.length && same(a[start], b[start]))
    start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const segments: WordDiffSegment[] = [];
  pushSame(segments, a.slice(0, start), b.slice(0, start));
  if (midA.length * midB.length > MAX_TABLE_CELLS) {
    push(segments, "removed", midA.join(""));
    push(segments, "added", midB.join(""));
  } else {
    // Longest common subsequence over tokens, walked forwards.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint16Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] = same(midA[i], midB[j])
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (same(midA[i], midB[j])) {
        pushSame(segments, midA.slice(i, i + 1), midB.slice(j, j + 1));
        i++;
        j++;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        push(segments, "removed", midA[i++]);
      } else {
        push(segments, "added", midB[j++]);
      }
    }
    push(segments, "removed", midA.slice(i).join(""));
    push(segments, "added", midB.slice(j).join(""));
  }
  pushSame(segments, a.slice(endA), b.slice(endB));
  return consolidateBusyChanges(joinRewrittenLines(keepMovedSpace(segments)));
}

function textOf(segments: WordDiffSegment[], side: "removed" | "added") {
  const other = side === "removed" ? "added" : "removed";
  return segments
    .filter((segment) => segment.kind !== other)
    .map((segment) => segment.text)
    .join("");
}

function keepMovedSpace(segments: WordDiffSegment[]): WordDiffSegment[] {
  const out: WordDiffSegment[] = [];
  let change: WordDiffSegment[] = [];
  const moved = (space: string, text: string) =>
    space !== "" && !space.trim() && text.trim() !== "" && text.endsWith(space);
  const close = () => {
    const removed = textOf(change, "removed");
    const added = textOf(change, "added");
    if (moved(removed, added)) {
      push(out, "added", added.slice(0, -removed.length));
      push(out, "same", removed);
    } else if (moved(added, removed)) {
      push(out, "removed", removed.slice(0, -added.length));
      push(out, "same", added);
    } else {
      for (const segment of change) push(out, segment.kind, segment.text);
    }
    change = [];
  };
  for (const segment of segments) {
    if (segment.kind !== "same") {
      change.push(segment);
      continue;
    }
    close();
    push(out, "same", segment.text);
  }
  close();
  return out;
}

/**
 * Joins the changes on each line that strike and insert more words than they
 * keep into the old text struck and the new inserted, the test the page draws
 * a suggestion by, so the card shows a rewritten paragraph the way the page
 * does. A word carries its trailing space, so a line can end inside a change.
 */
function joinRewrittenLines(segments: WordDiffSegment[]): WordDiffSegment[] {
  const out: WordDiffSegment[] = [];
  let line: WordDiffSegment[] = [];
  let joinable = true;
  let ended = false;
  const close = () => {
    const first = line.findIndex((segment) => segment.kind !== "same");
    const last = line.reduce(
      (found, segment, index) => (segment.kind === "same" ? found : index),
      -1,
    );
    if (
      joinable &&
      first >= 0 &&
      mostlyRewritten(textOf(line, "removed"), textOf(line, "added"))
    ) {
      const middle = line.slice(first, last + 1);
      for (const segment of line.slice(0, first))
        push(out, segment.kind, segment.text);
      push(out, "removed", textOf(middle, "removed"));
      push(out, "added", textOf(middle, "added"));
      for (const segment of line.slice(last + 1))
        push(out, segment.kind, segment.text);
    } else {
      for (const segment of line) push(out, segment.kind, segment.text);
    }
    line = [];
    joinable = true;
    ended = false;
  };
  for (const segment of segments) {
    if (segment.kind !== "same") {
      // A change across lines is the page's to leave in pieces too.
      if (segment.text.trimEnd().includes("\n")) joinable = false;
      if (segment.text.includes("\n")) ended = true;
      line.push(segment);
      continue;
    }
    // A line that ended inside a change ends with the whole change.
    if (ended) close();
    const end = segment.text.indexOf("\n");
    if (end < 0) {
      line.push(segment);
      continue;
    }
    const restart = segment.text.lastIndexOf("\n") + 1;
    line.push({ kind: "same", text: segment.text.slice(0, end + 1) });
    close();
    push(out, "same", segment.text.slice(end + 1, restart));
    if (restart < segment.text.length)
      line.push({ kind: "same", text: segment.text.slice(restart) });
  }
  close();
  return out;
}

/** More separate changes than this reads as a rewrite, not a few edits. */
const MAX_SEPARATE_CHANGES = 2;
const SHORT_RUN_WORDS = 2;

/**
 * A rewrite diffed word by word alternates struck and new words every few
 * tokens. Fold short unchanged runs between changes into the change, so the
 * old phrase reads as one strike and the new phrase as one insertion.
 */
function consolidateBusyChanges(
  segments: WordDiffSegment[],
): WordDiffSegment[] {
  const changeGroups = segments.filter(
    (segment, index) =>
      segment.kind !== "same" &&
      (index === 0 || segments[index - 1].kind === "same"),
  ).length;
  if (changeGroups <= MAX_SEPARATE_CHANGES) return segments;
  const out: WordDiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    push(out, "removed", removed);
    push(out, "added", added);
    removed = "";
    added = "";
  };
  segments.forEach((segment, index) => {
    const between = index > 0 && index < segments.length - 1;
    if (segment.kind === "removed") removed += segment.text;
    else if (segment.kind === "added") added += segment.text;
    else if (
      between &&
      segment.text.trim().split(/\s+/).length <= SHORT_RUN_WORDS
    ) {
      removed += segment.text;
      added += segment.text;
    } else {
      flush();
      push(out, "same", segment.text);
    }
  });
  flush();
  return out;
}

const MAX_PARAGRAPH_OPENING_WORDS = 3;
const SENTENCE_END = /[.!?:;]["'’”)\]]*$/u;

function leadIn(text: string, maxContext: number): string {
  const paragraph = text.slice(text.lastIndexOf("\n") + 1);
  if (paragraph.length <= maxContext) return paragraph;
  const words = paragraph.match(/\S+\s*/g) ?? [];
  let opening = "";
  let openingWords = 0;
  for (const word of words.slice(0, MAX_PARAGRAPH_OPENING_WORDS)) {
    if ((opening + word).trimEnd().length > maxContext / 2) break;
    opening += word;
    openingWords++;
    if (SENTENCE_END.test(word.trimEnd())) break;
  }
  let tail = "";
  let tailWords = 0;
  for (const word of words.slice(openingWords).reverse()) {
    if (opening.length + tail.length + word.length > maxContext) break;
    tail = word + tail;
    tailWords++;
  }
  return openingWords + tailWords < words.length
    ? `${opening}…${tail}`
    : opening + tail;
}

/** Shorten unchanged text at either end so the change itself stays in view. */
export function trimDiffContext(
  segments: WordDiffSegment[],
  maxContext = 48,
): WordDiffSegment[] {
  return segments.flatMap((segment, index) => {
    if (segment.kind !== "same" || segment.text.length <= maxContext) {
      return [segment];
    }
    if (index === 0 && segments.length > 1) {
      const text = leadIn(segment.text, maxContext);
      return text ? [{ ...segment, text }] : [];
    }
    if (index === segments.length - 1 && segments.length > 1) {
      const head = segment.text.slice(0, maxContext).replace(/\s\S*$/, "");
      return [{ ...segment, text: `${head}…` }];
    }
    return [segment];
  });
}
