export type VoiceNavigationCommand = "next" | "prev";

export type VoiceNavigationMatch =
  | { type: "command"; command: VoiceNavigationCommand }
  | { type: "partial" }
  | { type: "ignore" };

function normalizeVoicePhrase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
  for (const [command, phrase] of commands) {
    const normalizedPhrase = normalizeVoicePhrase(phrase);
    if (normalized === normalizedPhrase) return { type: "command", command };
  }
  if (
    commands.some(([, phrase]) =>
      normalizeVoicePhrase(phrase).startsWith(normalized),
    )
  ) {
    return { type: "partial" };
  }
  return { type: "ignore" };
}
