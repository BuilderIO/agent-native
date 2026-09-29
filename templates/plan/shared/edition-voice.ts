/**
 * Choosing a speech voice, because the browser default is usually the worst
 * one available.
 *
 * `speechSynthesis.speak()` with no voice set uses the platform default, which
 * on macOS is frequently a 1990s-era compact voice and on Chrome can land on a
 * novelty voice. Both sound mechanical. The good voices are present in
 * `getVoices()` — they just have to be asked for.
 */

/** The structural subset of `SpeechSynthesisVoice` this module needs. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

/**
 * macOS ships these as jokes and Chrome will happily pick one. They are the
 * single biggest cause of "why does it sound like a robot".
 */
const NOVELTY = new Set(
  [
    "albert",
    "bad news",
    "bahh",
    "bells",
    "boing",
    "bubbles",
    "cellos",
    "deranged",
    "good news",
    "hysterical",
    "jester",
    "junior",
    "kathy",
    "organ",
    "ralph",
    "superstar",
    "trinoids",
    "whisper",
    "wobble",
    "zarvox",
    "fred",
    "grandma",
    "grandpa",
    "rocko",
    "shelley",
    "sandy",
    "flo",
    "eddy",
    "reed",
    "rishi",
  ].map((n) => n.toLowerCase()),
);

/** Names vendors use to mark their high-quality synthesis. */
const PREMIUM =
  /\b(premium|enhanced|neural|natural|siri|wavenet|journey|studio|polyglot)\b/i;

function isNovelty(voice: VoiceLike): boolean {
  const base = voice.name
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
  return NOVELTY.has(base);
}

function score(voice: VoiceLike, locale: string): number {
  const lang = voice.lang?.replace("_", "-").toLowerCase() ?? "";
  const want = locale.replace("_", "-").toLowerCase();
  const wantLang = want.split("-")[0] ?? want;

  if (isNovelty(voice)) return -1;
  let points = 0;
  if (lang === want) points += 40;
  else if (lang.split("-")[0] === wantLang) points += 20;
  else return -1; // never read English copy in a Czech voice
  if (PREMIUM.test(voice.name)) points += 30;
  // A network voice is nearly always better than the bundled compact one.
  if (voice.localService === false) points += 15;
  if (voice.default) points += 2;
  return points;
}

/**
 * Best available voice for this locale, or `null` when none matches — in which
 * case leave `utterance.voice` unset and let the platform decide, rather than
 * reading English aloud in a voice for another language.
 */
export function pickEditionVoice<T extends VoiceLike>(
  voices: readonly T[],
  locale: string,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const points = score(voice, locale);
    if (points > bestScore) {
      best = voice;
      bestScore = points;
    }
  }
  return best;
}

/** Voices worth offering in a picker: same language, novelty excluded. */
export function selectableEditionVoices<T extends VoiceLike>(
  voices: readonly T[],
  locale: string,
): T[] {
  return voices
    .filter((voice) => score(voice, locale) > 0)
    .sort((a, b) => score(b, locale) - score(a, locale));
}

/** Slightly under natural pace reads better for continuous prose. */
export const EDITION_SPEECH_RATE = 0.97;
