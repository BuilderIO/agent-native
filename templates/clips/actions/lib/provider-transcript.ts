export type ProviderTranscriptSegment = {
  text: string;
};

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
