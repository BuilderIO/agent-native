/**
 * Speaker-echo dedupe for recordings that capture BOTH mic and system audio.
 *
 * When the user plays a video without headphones, the system stream
 * transcribes the video's audio directly and the mic stream hears the same
 * audio through the speakers — every spoken word lands twice, interleaved a
 * few seconds apart. The system copy is the clean signal; a mic utterance
 * whose words are almost entirely present in the system stream around the
 * same time is an echo and gets dropped. Words the user actually speaks over
 * the video don't match the system text and survive.
 */

import type { FinalTranscriptEvent } from "./transcription-engine";

/** Echo window: mic hears speakers with capture/buffer skew of a few seconds. */
const ECHO_WINDOW_MS = 6000;
/** Fraction of a mic utterance's tokens that must appear in the system text. */
const ECHO_CONTAINMENT = 0.7;
/** Don't judge tiny utterances ("yeah", "okay") — too little signal. */
const MIN_TOKENS = 4;

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

interface TimedToken {
  token: string;
  ms: number;
}

function eventTimeRange(
  event: FinalTranscriptEvent,
): { startMs: number; endMs: number } | null {
  const parts =
    event.words && event.words.length > 0 ? event.words : event.segments;
  if (parts.length === 0) return null;
  return {
    startMs: Math.min(...parts.map((part) => part.startMs)),
    endMs: Math.max(...parts.map((part) => part.endMs)),
  };
}

/**
 * Returns the finals with echo mic utterances removed. Order is preserved.
 * No-op unless both mic and system finals are present.
 */
export function dropMicEchoFinals(
  finals: FinalTranscriptEvent[],
): FinalTranscriptEvent[] {
  const systemTokens: TimedToken[] = [];
  for (const event of finals) {
    if (event.source !== "system") continue;
    const parts =
      event.words && event.words.length > 0 ? event.words : event.segments;
    for (const part of parts) {
      for (const token of normalizeTokens(part.text)) {
        systemTokens.push({ token, ms: part.startMs });
      }
    }
  }
  if (systemTokens.length === 0) return finals;

  return finals.filter((event) => {
    if (event.source !== "mic") return true;
    const range = eventTimeRange(event);
    if (!range) return true;
    const micTokens = normalizeTokens(event.text);
    if (micTokens.length === 0) return true;
    // Short utterances ("wow, okay!") carry little signal — only drop them on
    // a PERFECT match so genuine interjections over the video survive.
    const threshold = micTokens.length < MIN_TOKENS ? 1 : ECHO_CONTAINMENT;
    // Multiset containment of mic tokens in the system tokens near this time.
    const window = new Map<string, number>();
    for (const t of systemTokens) {
      if (
        t.ms >= range.startMs - ECHO_WINDOW_MS &&
        t.ms <= range.endMs + ECHO_WINDOW_MS
      ) {
        window.set(t.token, (window.get(t.token) ?? 0) + 1);
      }
    }
    let matched = 0;
    for (const token of micTokens) {
      const available = window.get(token) ?? 0;
      if (available > 0) {
        matched++;
        window.set(token, available - 1);
      }
    }
    return matched / micTokens.length < threshold;
  });
}
