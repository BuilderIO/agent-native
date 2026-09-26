
const SCRATCH_PHRASES = [
  "scratch that",
  "no wait",
  "wait no",
  "actually no",
  "actually scratch that",
];

const DELETE_WORD_PHRASES = ["delete that", "delete word", "delete last word"];

const NEW_LINE_PHRASES = ["new line", "newline"];
const NEW_PARAGRAPH_PHRASES = ["new paragraph"];

const LEADING_FILLER =
  /(?:^|[,. ]\s*)(?:um[,.]?|uh[,.]?|hmm[,.]?|okay[,.]?|like[,.]?)\s*/gi;

const PUNCTUATION_BY_NAME: Array<[RegExp, string]> = [
  [/\b(period|full stop)\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bquestion mark\b/gi, "?"],
  [/\bexclamation (?:point|mark)\b/gi, "!"],
  [/\bcolon\b/gi, ":"],
  [/\bsemicolon\b/gi, ";"],
  [/\bquotation mark\b/gi, '"'],
  [/\bem dash\b/gi, "—"],
  [/\ben dash\b/gi, "–"],
  [/\basterisk\b/gi, "*"],
  [/\bampersand\b/gi, "&"],
  [/\bellipsis\b/gi, "…"],
  [/\bopen paren\b/gi, "("],
  [/\bclose paren\b/gi, ")"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPhraseRegex(phrases: string[]): RegExp {
  const alt = phrases.map(escapeRegex).join("|");
  return new RegExp(`(?:^|[\\s,.;])(${alt})(?=$|[\\s,.;!?])`, "gi");
}

const SCRATCH_RE = buildPhraseRegex(SCRATCH_PHRASES);
const DELETE_WORD_RE = buildPhraseRegex(DELETE_WORD_PHRASES);
const NEW_LINE_RE = buildPhraseRegex(NEW_LINE_PHRASES);
const NEW_PARAGRAPH_RE = buildPhraseRegex(NEW_PARAGRAPH_PHRASES);

function lastCheckpoint(text: string): number {
  let lastIdx = -1;
  const re = /[.!?]+\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastIdx = m.index + m[0].length;
  }
  return lastIdx === -1 ? 0 : lastIdx;
}

function scratchToCheckpoint(text: string): string {
  return text.slice(0, lastCheckpoint(text)).trimEnd();
}

function deleteLastWord(text: string): string {
  return text.replace(/\s*\S+\s*$/, "").trimEnd();
}

export interface BacktrackOptions {
  iterative?: boolean;
}

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
        const phraseStart = m.index + (m[0].length - m[1].length);
        matches.push({ idx: phraseStart, len: m[1].length, kind });
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
    const trimmedAfter = after.replace(/^[\s,.;!?]+/, "");
    text = `${edited}${edited && trimmedAfter ? " " : ""}${trimmedAfter}`;
    if (!iterative) break;
  }
  text = text.replace(LEADING_FILLER, (match) =>
    match.startsWith(" ") || match.startsWith(",") || match.startsWith(".")
      ? match.slice(0, 1)
      : "",
  );
  for (const [re, sym] of PUNCTUATION_BY_NAME) {
    text = text.replace(re, sym);
  }
  text = text.replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

export class BacktrackBuffer {
  private lastUpdateAt = 0;
  private lastText = "";
  private readonly pauseMs: number;
  constructor(opts: { pauseMs?: number } = {}) {
    this.pauseMs = opts.pauseMs ?? 2000;
  }
  update(partial: string): string {
    const now = Date.now();
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
