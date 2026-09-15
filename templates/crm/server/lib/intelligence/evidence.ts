import { isSafeCrmEvidenceExcerpt } from "../../crm/crm-field-firewall.js";

export const MAX_EVIDENCE_EXCERPTS = 100;
export const MAX_EVIDENCE_QUOTE_LENGTH = 1_200;

export interface CallEvidenceExcerpt {
  evidenceRef: string;
  quote: string;
  speaker?: string;
  startSeconds: number;
  endSeconds?: number;
}

const FORBIDDEN_PAYLOAD_KEYS =
  /(?:audio|base64|binary|blob|body|file|image|media|payload|recording|transcript|video)/i;

function isBoundedTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 86_400
  );
}

function isOpaqueEvidenceRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !value.trimStart().startsWith("data:") &&
    !/\b(?:base64|binary|blob|media)\b/i.test(value)
  );
}

/**
 * Narrows a Clips evidence artifact to the small, SQL-safe shape signals may use.
 * Unknown payload-like keys fail closed so callers cannot accidentally pass a transcript.
 */
export function parseCallEvidenceExcerpt(
  value: unknown,
): CallEvidenceExcerpt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => FORBIDDEN_PAYLOAD_KEYS.test(key))) {
    return null;
  }

  const evidenceRef = raw.evidenceRef;
  const quote = raw.quote;
  const speaker = raw.speaker;
  const startSeconds = raw.startSeconds;
  const endSeconds = raw.endSeconds;
  if (
    !isOpaqueEvidenceRef(evidenceRef) ||
    typeof quote !== "string" ||
    quote.trim().length === 0 ||
    quote.length > MAX_EVIDENCE_QUOTE_LENGTH ||
    !isSafeCrmEvidenceExcerpt(quote) ||
    !isBoundedTime(startSeconds) ||
    (endSeconds !== undefined && !isBoundedTime(endSeconds)) ||
    (typeof endSeconds === "number" && endSeconds < startSeconds) ||
    (speaker !== undefined &&
      (typeof speaker !== "string" ||
        speaker.length > 240 ||
        !isSafeCrmEvidenceExcerpt(speaker)))
  ) {
    return null;
  }

  return {
    evidenceRef: evidenceRef.trim(),
    quote: quote.trim(),
    ...(typeof speaker === "string" && speaker.trim()
      ? { speaker: speaker.trim() }
      : {}),
    startSeconds,
    ...(typeof endSeconds === "number" ? { endSeconds } : {}),
  };
}

export function parseCallEvidenceExcerpts(
  values: unknown,
  maxItems = MAX_EVIDENCE_EXCERPTS,
): CallEvidenceExcerpt[] | null {
  if (!Array.isArray(values) || values.length > maxItems || maxItems < 1) {
    return null;
  }
  const excerpts: CallEvidenceExcerpt[] = [];
  for (const value of values) {
    const excerpt = parseCallEvidenceExcerpt(value);
    if (!excerpt) return null;
    excerpts.push(excerpt);
  }
  return excerpts;
}

export function formatEvidenceTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}`;
}
