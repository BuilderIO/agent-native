export type VoiceContextMode =
  | "dictation"
  | "cleanup"
  | "transcript"
  | "title"
  | "summary"
  | "meeting";

export interface VoiceContextSnippet {
  label: string;
  value: string;
}

export interface VoiceTerm {
  term: string;
  replacement?: string;
  confidence?: number;
  source?: string;
  scope?: string;
}

export interface VoiceContextPack {
  surface?: string;
  mode?: VoiceContextMode | string;
  snippets?: VoiceContextSnippet[];
  terms?: VoiceTerm[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

const MAX_CONTEXT_PACK_CHARS = 64_000;
const MAX_SNIPPETS = 8;
const MAX_SNIPPET_VALUE_CHARS = 1_800;
const MAX_TERMS = 80;
const MAX_TERM_CHARS = 120;
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_VALUE_CHARS = 160;

function cleanString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\0/g, "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

export function sanitizeVoiceContextPack(
  input: unknown,
): VoiceContextPack | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const raw = input as VoiceContextPack;
  const surface = cleanString(raw.surface, 80);
  const mode = cleanString(raw.mode, 40);

  const snippets = Array.isArray(raw.snippets)
    ? raw.snippets
        .slice(0, MAX_SNIPPETS)
        .map((snippet) => {
          if (!snippet || typeof snippet !== "object") return null;
          const candidate = snippet as Partial<VoiceContextSnippet>;
          const label = cleanString(candidate.label, 80);
          const value = cleanString(candidate.value, MAX_SNIPPET_VALUE_CHARS);
          return label && value ? { label, value } : null;
        })
        .filter((snippet): snippet is VoiceContextSnippet => snippet !== null)
    : undefined;

  const terms = Array.isArray(raw.terms)
    ? raw.terms
        .slice(0, MAX_TERMS)
        .map((term) => {
          if (!term || typeof term !== "object") return null;
          const candidate = term as Partial<VoiceTerm>;
          const rawTerm = cleanString(candidate.term, MAX_TERM_CHARS);
          if (!rawTerm || rawTerm.length < 2) return null;
          const replacement = cleanString(
            candidate.replacement,
            MAX_TERM_CHARS,
          );
          const source = cleanString(candidate.source, 40);
          const scope = cleanString(candidate.scope, 40);
          const confidence = cleanNumber(candidate.confidence);
          return {
            term: rawTerm,
            ...(replacement ? { replacement } : {}),
            ...(confidence !== undefined ? { confidence } : {}),
            ...(source ? { source } : {}),
            ...(scope ? { scope } : {}),
          };
        })
        .filter((term): term is VoiceTerm => term !== null)
    : undefined;

  const metadata =
    raw.metadata &&
    typeof raw.metadata === "object" &&
    !Array.isArray(raw.metadata)
      ? Object.fromEntries(
          Object.entries(raw.metadata)
            .slice(0, MAX_METADATA_KEYS)
            .flatMap(([key, value]) => {
              const cleanKey = cleanString(key, 60);
              if (!cleanKey) return [];
              if (
                typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean" ||
                value === null
              ) {
                const cleanValue =
                  typeof value === "string"
                    ? cleanString(value, MAX_METADATA_VALUE_CHARS)
                    : value;
                return cleanValue === undefined ? [] : [[cleanKey, cleanValue]];
              }
              return [];
            }),
        )
      : undefined;

  const pack: VoiceContextPack = {
    ...(surface ? { surface } : {}),
    ...(mode ? { mode } : {}),
    ...(snippets?.length ? { snippets } : {}),
    ...(terms?.length ? { terms } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  return voiceContextHasContent(pack) ? pack : undefined;
}

export function parseVoiceContextPack(
  value: string,
): VoiceContextPack | undefined {
  const trimmed = value.replace(/\0/g, "").trim();
  if (!trimmed || trimmed.length > MAX_CONTEXT_PACK_CHARS) return undefined;
  try {
    return sanitizeVoiceContextPack(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

export function voiceContextHasContent(
  pack: VoiceContextPack | undefined,
): boolean {
  return Boolean(
    pack?.surface ||
    pack?.mode ||
    pack?.snippets?.length ||
    pack?.terms?.length ||
    (pack?.metadata && Object.keys(pack.metadata).length > 0),
  );
}

export function voiceContextTermsOnly(
  input: unknown,
): VoiceContextPack | undefined {
  const pack = sanitizeVoiceContextPack(input);
  if (!pack?.terms?.length) return undefined;
  return { terms: pack.terms };
}

export function formatVoiceContextPackForPrompt(input: unknown): string {
  const pack = sanitizeVoiceContextPack(input);
  if (!pack) return "";

  const sections: string[] = [];
  if (pack.surface) sections.push(`Surface: ${pack.surface}`);
  if (pack.mode) sections.push(`Mode: ${pack.mode}`);

  if (pack.snippets?.length) {
    sections.push(
      [
        "Context snippets:",
        ...pack.snippets.map(
          (snippet) => `- ${snippet.label}: ${snippet.value}`,
        ),
      ].join("\n"),
    );
  }

  if (pack.terms?.length) {
    sections.push(
      [
        "Preferred vocabulary and casing:",
        ...pack.terms.map((term) => {
          const replacement =
            term.replacement && term.replacement !== term.term
              ? ` -> ${term.replacement}`
              : "";
          const source = term.source ? ` (${term.source})` : "";
          return `- ${term.term}${replacement}${source}`;
        }),
      ].join("\n"),
    );
  }

  if (pack.metadata && Object.keys(pack.metadata).length > 0) {
    sections.push(
      [
        "Metadata:",
        ...Object.entries(pack.metadata).map(([key, value]) => {
          return `- ${key}: ${String(value)}`;
        }),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}
