/**
 * Wispr-style backtrack / inline voice editing.
 *
 * The user can say specific phrases mid-dictation that retroactively edit
 * the transcript before it lands in the focused field:
 *
 *   - "scratch that" / "no wait" / "actually" → drop everything since the
 *     last sentence boundary or 2s pause checkpoint.
 *   - "delete that" / "delete word" → drop the last word.
 *   - "new line" / "new paragraph" → insert `\n` (or `\n\n`).
 *   - "period", "comma", "question mark" → punctuation by name.
 *
 * Source-of-truth for the phrase list is Wispr Flow's docs — see
 * `templates/clips/desktop/design-refs/wispr-ux.md` §11.
 *
 * Public surface:
 *
 *   `applyBacktrack(text, opts?)` — pure function. Pass the FINAL transcript
 *   (or the latest partial), get back the edited string. No state — keeps
 *   the function safe to call from any path (native, browser, server).
 *
 *   `BacktrackBuffer` — stateful helper for partial streams. Maintains a
 *   checkpoint position (last period or 2s pause) so "scratch that" knows
 *   how far back to delete. Use it when you have access to a partial
 *   stream and want incremental editing.
 */

const SCRATCH_PHRASES = [
  // Order matters within an alternation: longer phrases first so
  // "no wait" beats "wait" if we ever add the latter.
  "scratch that",
  "no wait",
  "wait no",
  "actually no",
  "actually scratch that",
];

const DELETE_WORD_PHRASES = ["delete that", "delete word", "delete last word"];

const NEW_LINE_PHRASES = ["new line", "newline"];
const NEW_PARAGRAPH_PHRASES = ["new paragraph"];

// Filler that may precede a backtrack phrase. We allow a leading
// "um, ", "uh, ", "okay, " etc. so a natural utterance like
// "um, scratch that, let's say tomorrow" still triggers.
const LEADING_FILLER =
  /(?:^|[,. ]\s*)(?:um[,.]?|uh[,.]?|hmm[,.]?|okay[,.]?|like[,.]?)\s*/gi;

const PUNCTUATION_BY_NAME: Array<[RegExp, string]> = [
  [/\b(period|full stop)\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bquestion mark\b/gi, "?"],
  [/\bexclamation (?:point|mark)\b/gi, "!"],
  [/\bcolon\b/gi, ":"],
  [/\bsemicolon\b/gi, ";"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPhraseRegex(phrases: string[]): RegExp {
  // Match each phrase as a whole-word, case-insensitive. Allow optional
  // surrounding commas / periods / spaces so it can sit mid-sentence.
  const alt = phrases.map(escapeRegex).join("|");
  return new RegExp(`(?:^|[\\s,.;])(${alt})(?=$|[\\s,.;!?])`, "gi");
}

const SCRATCH_RE = buildPhraseRegex(SCRATCH_PHRASES);
const DELETE_WORD_RE = buildPhraseRegex(DELETE_WORD_PHRASES);
const NEW_LINE_RE = buildPhraseRegex(NEW_LINE_PHRASES);
const NEW_PARAGRAPH_RE = buildPhraseRegex(NEW_PARAGRAPH_PHRASES);

/**
 * Locate the last "checkpoint" in `text` — the position to scratch back to.
 * A checkpoint is the index AFTER the last sentence terminator (`.!?`) plus
 * any trailing whitespace, or 0 if none.
 */
function lastCheckpoint(text: string): number {
  // Match the last sentence terminator followed by whitespace or end.
  let lastIdx = -1;
  const re = /[.!?]+\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastIdx = m.index + m[0].length;
  }
  return lastIdx === -1 ? 0 : lastIdx;
}

/**
 * Drop everything from `text` after the last checkpoint. Used when we
 * detect a "scratch that" phrase.
 */
function scratchToCheckpoint(text: string): string {
  return text.slice(0, lastCheckpoint(text)).trimEnd();
}

/**
 * Drop the trailing word from `text`. Used for "delete that" / "delete word".
 */
function deleteLastWord(text: string): string {
  return text.replace(/\s*\S+\s*$/, "").trimEnd();
}

export interface BacktrackOptions {
  /**
   * If set, multiple "scratch that" phrases in the same utterance will each
   * scratch back one checkpoint instead of stopping after the first. Default
   * is `true` since real users chain corrections ("actually wait scratch
   * that, let's just say tomorrow").
   */
  iterative?: boolean;
}

/**
 * Apply Wispr-style backtrack rules to a transcript. Pure — does not touch
 * any global state. Safe to call on full or partial transcripts.
 *
 * Algorithm (single pass left-to-right):
 *   1. Find the earliest occurrence of any backtrack phrase.
 *   2. Slice the text at that phrase, apply the action (scratch / delete /
 *      newline), strip leading filler from the slice to the right of the
 *      phrase, and continue from there.
 *   3. After phrase pass, replace punctuation-by-name tokens.
 *   4. Collapse double-spaces and orphan punctuation introduced by edits.
 */
export function applyBacktrack(
  rawText: string,
  opts: BacktrackOptions = {},
): string {
  const iterative = opts.iterative !== false;
  let text = rawText;
  let safety = 16;
  while (safety-- > 0) {
    const matches: Array<{
      idx: number;
      len: number;
      kind: "scratch" | "deleteWord" | "newLine" | "newParagraph";
    }> = [];
    const collect = (
      re: RegExp,
      kind: "scratch" | "deleteWord" | "newLine" | "newParagraph",
    ) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        // m.index points at the leading boundary char; the phrase itself
        // is m[1] inside the captured group. We compute the start of the
        // phrase = m.index + (m[0].length - m[1].length).
        const phraseStart = m.index + (m[0].length - m[1].length);
        matches.push({ idx: phraseStart, len: m[1].length, kind });
        // Avoid zero-width loop.
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    };
    collect(SCRATCH_RE, "scratch");
    collect(DELETE_WORD_RE, "deleteWord");
    collect(NEW_LINE_RE, "newLine");
    collect(NEW_PARAGRAPH_RE, "newParagraph");
    if (matches.length === 0) break;
    matches.sort((a, b) => a.idx - b.idx);
    const first = matches[0];
    const before = text.slice(0, first.idx);
    const after = text.slice(first.idx + first.len);
    let edited: string;
    switch (first.kind) {
      case "scratch":
        edited = scratchToCheckpoint(before);
        break;
      case "deleteWord":
        edited = deleteLastWord(before);
        break;
      case "newLine":
        edited = before.trimEnd() + "\n";
        break;
      case "newParagraph":
        edited = before.trimEnd() + "\n\n";
        break;
    }
    // Strip leading filler from the continuation so "um, scratch that, well,
    // tomorrow" -> "tomorrow", not ", well, tomorrow".
    const trimmedAfter = after.replace(/^[\s,.;!?]+/, "");
    text = `${edited}${edited && trimmedAfter ? " " : ""}${trimmedAfter}`;
    if (!iterative) break;
  }
  // Filler removal — light pass, only at sentence starts.
  text = text.replace(LEADING_FILLER, (match) =>
    match.startsWith(" ") || match.startsWith(",") || match.startsWith(".")
      ? match.slice(0, 1)
      : "",
  );
  // Punctuation-by-name.
  for (const [re, sym] of PUNCTUATION_BY_NAME) {
    text = text.replace(re, sym);
  }
  // Collapse double-spaces and stray space-before-punctuation.
  text = text.replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

/**
 * Stateful streaming helper. The dictation path can call `update(partial)` on
 * every partial transcript event and then `finalize()` once on Fn-release.
 * This is purely a wrapper around `applyBacktrack` — keeping it as a class
 * means callers don't need to remember to pass options around and gives us a
 * place to plug in time-based pause checkpoints later.
 */
export class BacktrackBuffer {
  private lastUpdateAt = 0;
  private lastText = "";
  private readonly pauseMs: number;
  constructor(opts: { pauseMs?: number } = {}) {
    this.pauseMs = opts.pauseMs ?? 2000;
  }
  update(partial: string): string {
    const now = Date.now();
    // A 2s+ silence is itself a sentence checkpoint — synthesize a period
    // so `lastCheckpoint` treats the gap as a boundary. We do this only
    // when the new partial extends the previous one (otherwise the
    // recognizer is mid-rewrite and we'd corrupt it).
    if (
      this.lastText &&
      partial.startsWith(this.lastText) &&
      now - this.lastUpdateAt > this.pauseMs &&
      !/[.!?]\s*$/.test(this.lastText)
    ) {
      partial = `${this.lastText}.${partial.slice(this.lastText.length)}`;
    }
    this.lastText = partial;
    this.lastUpdateAt = now;
    return applyBacktrack(partial);
  }
  finalize(text?: string): string {
    return applyBacktrack(text ?? this.lastText);
  }
  reset(): void {
    this.lastText = "";
    this.lastUpdateAt = 0;
  }
}
