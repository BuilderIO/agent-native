export interface WordDiffSegment {
  kind: "same" | "removed" | "added";
  text: string;
}

// A word with its trailing space, so spaces never match on their own.
const TOKEN = /\S+\s*|\s+/g;
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
  return consolidateBusyChanges(segments);
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

/** Shorten unchanged text at either end so the change itself stays in view. */
export function trimDiffContext(
  segments: WordDiffSegment[],
  maxContext = 48,
): WordDiffSegment[] {
  return segments.map((segment, index) => {
    if (segment.kind !== "same" || segment.text.length <= maxContext) {
      return segment;
    }
    // Cut on a word boundary so no half-word is left at the edge.
    if (index === 0 && segments.length > 1) {
      const tail = segment.text.slice(-maxContext).replace(/^\S*\s/, "");
      return { ...segment, text: `…${tail}` };
    }
    if (index === segments.length - 1 && segments.length > 1) {
      const head = segment.text.slice(0, maxContext).replace(/\s\S*$/, "");
      return { ...segment, text: `${head}…` };
    }
    return segment;
  });
}
