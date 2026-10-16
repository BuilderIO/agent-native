export type VoiceNavigationCommand = "next" | "prev";

export const VOICE_NAVIGATION_PARTIAL_TIMEOUT_MS = 5_000;

export type VoiceNavigationMatch =
  | { type: "command"; command: VoiceNavigationCommand }
  | { type: "partial" }
  | { type: "ignore" };

export function hasVoiceNavigationPartialExpired(
  lastFragmentAt: number,
  now: number,
): boolean {
  return now - lastFragmentAt > VOICE_NAVIGATION_PARTIAL_TIMEOUT_MS;
}

function normalizeVoicePhrase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchVoiceNavigationPhrase(
  value: string,
  phrases: { next: string; previous: string },
): VoiceNavigationMatch {
  const normalized = normalizeVoicePhrase(value);
  if (!normalized) return { type: "ignore" };

  const commands: [VoiceNavigationCommand, string][] = [
    ["next", phrases.next],
    ["prev", phrases.previous],
  ];
  const compactNormalized = normalized.replace(/\s/g, "");
  for (const [command, phrase] of commands) {
    const normalizedPhrase = normalizeVoicePhrase(phrase);
    const compactPhrase = normalizedPhrase.replace(/\s/g, "");
    if (
      normalized === normalizedPhrase ||
      compactNormalized === compactPhrase
    ) {
      return { type: "command", command };
    }
  }
  if (
    commands.some(([, phrase]) => {
      const normalizedPhrase = normalizeVoicePhrase(phrase);
      return (
        normalizedPhrase.startsWith(normalized) ||
        normalizedPhrase.replace(/\s/g, "").startsWith(compactNormalized)
      );
    })
  ) {
    return { type: "partial" };
  }
  return { type: "ignore" };
}
