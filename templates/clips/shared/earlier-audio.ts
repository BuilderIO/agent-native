type EarlierAudioEntry = {
  startMs: number;
  endMs: number;
  recovered?: unknown;
};

function isEarlierAudio(entry: EarlierAudioEntry): boolean {
  return entry.recovered === true;
}

/**
 * How many minutes of audio recovered from before the user started recording
 * a transcript holds. Zero means it holds none.
 */
export function earlierAudioMinutes(
  entries: readonly EarlierAudioEntry[],
): number {
  const recovered = entries.filter(isEarlierAudio);
  if (recovered.length === 0) return 0;
  const spanMs =
    Math.max(...recovered.map((entry) => entry.endMs)) -
    Math.min(...recovered.map((entry) => entry.startMs));
  return Math.max(1, Math.round(spanMs / 60_000));
}

export function withoutEarlierAudio<T extends EarlierAudioEntry>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => !isEarlierAudio(entry));
}

/** The `Me:` / `Them:` text live capture saves alongside its segments. */
export function speakerLabeledText(
  entries: ReadonlyArray<Record<string, unknown>>,
): string {
  const turns: Array<{ speaker: string; text: string }> = [];
  let last: { speaker: string; text: string } | undefined;
  for (const entry of entries) {
    if (typeof entry.text !== "string" || !entry.text.trim()) continue;
    const speaker = entry.source === "system" ? "Them" : "Me";
    if (last?.speaker === speaker) {
      last.text += ` ${entry.text}`;
    } else {
      last = { speaker, text: entry.text };
      turns.push(last);
    }
  }
  return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n\n");
}
