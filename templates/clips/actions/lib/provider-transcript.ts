export type ProviderTranscriptSegment = {
  text: string;
};

const CJK_SCRIPT_PATTERN =
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const LATIN_SCRIPT_PATTERN = /[A-Za-z]/;
const MIN_STRONG_SCRIPT_CHARS = 8;
const STRONG_SCRIPT_RATIO = 2;

const NO_SPEECH_PATTERNS = [
  /^no speech(?: was)? detected$/,
  /^no spoken words?(?: were)? detected$/,
  /^there (?:is|are) no (?:spoken )?words?(?: in (?:the )?audio)?$/,
  /^no audible speech(?: was)? detected$/,
  /^the audio contains no speech$/,
  /^silence$/,
];

function normalizeForMatching(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/[.!?]+$/g, "")
    .trim()
    .toLowerCase();
}

export function isNoSpeechProviderText(
  text: string | null | undefined,
): boolean {
  if (!text?.trim()) return false;
  const normalized = normalizeForMatching(text);
  return NO_SPEECH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeSpeechText(text: string | null | undefined): string {
  const trimmed = text?.trim() ?? "";
  return trimmed && !isNoSpeechProviderText(trimmed) ? trimmed : "";
}

function primaryLanguage(language: string | null | undefined): string {
  return (language ?? "").trim().toLowerCase().split(/[-_]/)[0]?.trim() ?? "";
}

function countScriptCharacters(text: string): {
  cjk: number;
  latin: number;
} {
  let cjk = 0;
  let latin = 0;
  for (const char of text) {
    if (CJK_SCRIPT_PATTERN.test(char)) {
      cjk += 1;
    } else if (LATIN_SCRIPT_PATTERN.test(char)) {
      latin += 1;
    }
  }
  return { cjk, latin };
}

export function isLikelyMismatchedTranscriptLanguage(
  language: string | null | undefined,
  text: string | null | undefined,
): boolean {
  const primary = primaryLanguage(language);
  const trimmed = text?.trim() ?? "";
  if (!primary || !trimmed) return false;

  const { cjk, latin } = countScriptCharacters(trimmed);
  if (primary === "en") {
    return (
      cjk >= MIN_STRONG_SCRIPT_CHARS &&
      cjk >= Math.max(1, latin) * STRONG_SCRIPT_RATIO
    );
  }
  if (primary === "zh" || primary === "ja" || primary === "ko") {
    return (
      latin >= MIN_STRONG_SCRIPT_CHARS &&
      cjk === 0 &&
      latin >= Math.max(1, cjk) * STRONG_SCRIPT_RATIO
    );
  }
  return false;
}

export function filterProviderTranscriptSegments<
  T extends ProviderTranscriptSegment,
>(segments: T[]): T[] {
  return segments.filter((segment) => normalizeSpeechText(segment.text));
}

export function normalizeProviderTranscript<
  T extends ProviderTranscriptSegment,
>(
  text: string | null | undefined,
  segments: T[],
): { fullText: string; segments: T[] } {
  const cleanedSegments = filterProviderTranscriptSegments(segments);
  const directText = normalizeSpeechText(text);
  const fullText =
    directText ||
    cleanedSegments.map((segment) => segment.text.trim()).join(" ");

  return {
    fullText: normalizeSpeechText(fullText),
    segments: cleanedSegments,
  };
}
