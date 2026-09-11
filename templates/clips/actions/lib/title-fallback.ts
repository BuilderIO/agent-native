export function cleanGeneratedTitle(
  raw: string | null | undefined,
): string | null {
  const title = (raw ?? "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  return title.slice(0, 80);
}

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "about",
  "be",
  "because",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const TITLE_FILLER_WORDS = new Set([
  "actually",
  "basically",
  "discussion",
  "easier",
  "essentially",
  "first",
  "gonna",
  "going",
  "here",
  "just",
  "kind",
  "maybe",
  "obviously",
  "okay",
  "question",
  "questions",
  "quick",
  "quickly",
  "rather",
  "real",
  "really",
  "reason",
  "reasons",
  "regarding",
  "right",
  "scenario",
  "scenarios",
  "second",
  "sort",
  "stuff",
  "talk",
  "thing",
  "things",
  "through",
  "walk",
  "walkthrough",
  "yeah",
]);

const OPENING_FILLER_RE =
  /\b(?:walk through this|walk through it|talk through this|real quick|quick walkthrough|quickly walk through|go through this|let'?s walk through)\b/i;

function titleCaseWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && TITLE_STOPWORDS.has(lower)) return lower;
  if (/^\$?\d/.test(word)) return word;
  if (/^[A-Z0-9]{2,}(?:['’-]?[A-Z0-9]+)*$/.test(word)) return word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseWords(words: string[]): string {
  return words.map((word, index) => titleCaseWord(word, index)).join(" ");
}

function cleanTitleWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}$%.'’-]+$/gu, "");
}

function titleWords(value: string, maxWords = 9): string[] {
  const words = value
    .split(/\s+/)
    .map(cleanTitleWord)
    .filter(Boolean)
    .slice(0, maxWords);

  while (words.length > 2) {
    const last = words[words.length - 1]?.toLowerCase() ?? "";
    if (!TITLE_STOPWORDS.has(last) && !TITLE_FILLER_WORDS.has(last)) break;
    words.pop();
  }

  const first = words[0]?.toLowerCase() ?? "";
  if (
    words.length > 3 &&
    (first === "the" || first === "a" || first === "an")
  ) {
    words.shift();
  }

  return words;
}

function contentTerms(value: string): string[] {
  return value
    .split(/\s+/)
    .map((word) => cleanTitleWord(word).toLowerCase())
    .filter((word) => {
      if (!word) return false;
      if (/^\$?\d/.test(word)) return true;
      return (
        word.length > 2 &&
        !TITLE_STOPWORDS.has(word) &&
        !TITLE_FILLER_WORDS.has(word)
      );
    });
}

function extractQuestionTopic(chunk: string): string | null {
  const match = chunk.match(
    /\b(?:regarding|about|for|on)?\s*(?:your\s+|the\s+)?question\s+about\s+(.+?)(?:[,.;:]|$)/i,
  );
  const topic = match?.[1]?.trim();
  if (!topic) return null;
  return topic
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\bcosting\s+(\$?\d[\d,.]*(?:%|[a-z]+)?)/i, "cost $1")
    .trim();
}

function normalizeTitleCandidate(chunk: string): {
  text: string;
  source: "question-topic" | "sentence";
} | null {
  const withoutOpener = chunk
    .replace(/^(ok|okay|yeah|yep|so|um|uh|alright|all right|now)[,\s]+/i, "")
    .trim();
  const questionTopic = extractQuestionTopic(withoutOpener);
  if (questionTopic) return { text: questionTopic, source: "question-topic" };

  const text = withoutOpener
    .replace(/^(?:it['’]?s\s+)?(?:easier\s+to\s+)?(?:just\s+)?/i, "")
    .replace(
      /\b(?:there\s+(?:are|could be)|it(?:'|’)s)\s+(?:two|three|several)\s+(?:things?|reasons?|scenarios?)(?:\s+at play)?\b.*$/i,
      "",
    )
    .trim();

  if (!text || OPENING_FILLER_RE.test(text)) return null;
  if (contentTerms(text).length < 2) return null;
  return { text, source: "sentence" };
}

export function fallbackTitleFromTranscript(text: string): string | null {
  const normalized = text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const chunks = normalized.split(/(?<=[.!?])\s+|(?:\s+[-—]\s+)/);
  const termFrequency = new Map<string, number>();
  for (const term of contentTerms(normalized)) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  }

  const candidates = chunks
    .slice(0, 24)
    .map((chunk, index) => {
      const candidate = normalizeTitleCandidate(chunk);
      if (!candidate) return null;

      const words = titleWords(candidate.text);
      const signalTerms = contentTerms(words.join(" "));
      const signal = signalTerms.reduce(
        (score, term) => score + Math.min(termFrequency.get(term) ?? 0, 4),
        0,
      );
      const numberBonus =
        words.filter((word) => /^\$?\d/.test(word)).length * 8;
      const acronymBonus =
        words.filter((word) => /^[A-Z0-9]{2,}$/.test(word)).length * 4;
      const sourceBonus = candidate.source === "question-topic" ? 50 : 0;
      const positionPenalty = index * 0.25;
      return {
        words,
        score:
          sourceBonus +
          signal * 10 +
          numberBonus +
          acronymBonus +
          Math.min(words.length, 9) -
          positionPenalty,
      };
    })
    .filter((candidate): candidate is { words: string[]; score: number } =>
      Boolean(candidate),
    );

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  const words = best?.words ?? [];
  if (words.length < 2) return null;
  const title = titleCaseWords(words);
  return cleanGeneratedTitle(title);
}
