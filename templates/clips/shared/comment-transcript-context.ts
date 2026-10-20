type TimedText = { startMs: number; endMs: number; text: string };

// A comment usually reacts to what was just said, so the window reaches
// further back than forward.
const CONTEXT_BEFORE_MS = 6_000;
const CONTEXT_AFTER_MS = 4_000;

/** The transcript cues spoken around a comment's moment, joined. */
export function transcriptContextAt(
  segments: readonly TimedText[],
  atMs: number,
): TimedText | null {
  const from = atMs - CONTEXT_BEFORE_MS;
  const to = atMs + CONTEXT_AFTER_MS;
  const nearby = segments.filter(
    (segment) =>
      segment.endMs >= from && segment.startMs <= to && segment.text.trim(),
  );
  if (!nearby.length) return null;
  return {
    startMs: nearby[0].startMs,
    endMs: nearby[nearby.length - 1].endMs,
    text: nearby.map((segment) => segment.text.trim()).join(" "),
  };
}
