import {
  sanitizeVoiceContextPack,
  type VoiceContextPack,
  type VoiceTerm,
} from "./voice-context.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAlphaNumeric(value: string | undefined): boolean {
  return value != null && /[\p{L}\p{N}_]/u.test(value);
}

function isSafeVoiceReplacementBoundary(
  text: string,
  index: number,
  direction: "before" | "after",
): boolean {
  const char = text[index];
  if (char == null) return true;
  if (isAlphaNumeric(char)) return false;
  if (char === "@" || char === "/" || char === "\\" || char === ":") {
    return false;
  }
  if (char === "." || char === "-" || char === "+") {
    const neighbor = direction === "before" ? text[index - 1] : text[index + 1];
    return !isAlphaNumeric(neighbor);
  }
  return true;
}

export function applyVoiceTermReplacements(
  text: string,
  terms: readonly VoiceTerm[] | undefined,
): string {
  if (!text || !terms?.length) return text;

  let next = text;
  const replacements = terms
    .filter(
      (term) =>
        term.term.trim().length >= 2 &&
        term.replacement?.trim() &&
        term.replacement.trim() !== term.term.trim(),
    )
    .sort((a, b) => b.term.length - a.term.length);

  for (const term of replacements) {
    const source = escapeRegExp(term.term.trim());
    const replacement = term.replacement?.trim() ?? "";
    const pattern = new RegExp(source, "giu");
    next = next.replace(pattern, (match, offset: number) => {
      const start = offset;
      const end = offset + match.length;
      if (
        !isSafeVoiceReplacementBoundary(next, start - 1, "before") ||
        !isSafeVoiceReplacementBoundary(next, end, "after")
      ) {
        return match;
      }
      return replacement;
    });
  }

  return next;
}

export function applyVoiceContextReplacements(
  text: string,
  contextPack: VoiceContextPack | undefined,
): string {
  const pack = sanitizeVoiceContextPack(contextPack);
  return applyVoiceTermReplacements(text, pack?.terms);
}
