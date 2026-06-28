import {
  sanitizeVoiceContextPack,
  type VoiceContextPack,
  type VoiceTerm,
} from "./voice-context.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${source})(?=$|[^\\p{L}\\p{N}_])`,
      "giu",
    );
    next = next.replace(pattern, (_match, prefix: string) => {
      return `${prefix}${replacement}`;
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
