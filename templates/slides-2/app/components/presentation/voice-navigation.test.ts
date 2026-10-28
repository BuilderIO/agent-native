import { describe, expect, it } from "vitest";

import {
  hasVoiceNavigationPartialExpired,
  matchVoiceNavigationPhrase,
  VOICE_NAVIGATION_PARTIAL_TIMEOUT_MS,
} from "./voice-navigation";

describe("matchVoiceNavigationPhrase", () => {
  const phrases = { next: "Nächste Folie", previous: "Vorherige Folie" };

  it("matches a localized command with punctuation and accents", () => {
    expect(matchVoiceNavigationPhrase("NÄCHSTE Folie!", phrases)).toEqual({
      type: "command",
      command: "next",
    });
  });

  it("matches the localized previous-slide command", () => {
    expect(matchVoiceNavigationPhrase("Vorherige Folie.", phrases)).toEqual({
      type: "command",
      command: "prev",
    });
  });

  it("preserves meaningful vowel marks in Hindi commands", () => {
    const hindiPhrases = { next: "अगली स्लाइड", previous: "पिछली स्लाइड" };

    expect(matchVoiceNavigationPhrase("अगली स्लाइड", hindiPhrases)).toEqual({
      type: "command",
      command: "next",
    });
    expect(matchVoiceNavigationPhrase("अगला स्लाइड", hindiPhrases)).toEqual({
      type: "ignore",
    });
  });

  it("keeps a partial phrase so recognition can finish it in another result", () => {
    expect(matchVoiceNavigationPhrase("Nächste", phrases)).toEqual({
      type: "partial",
    });
  });

  it("ignores narration and other text around a command", () => {
    expect(
      matchVoiceNavigationPhrase(
        "The nächste Folie contains an example",
        phrases,
      ),
    ).toEqual({ type: "ignore" });
  });

  it("expires a partial command after a quiet gap", () => {
    expect(
      hasVoiceNavigationPartialExpired(
        1_000,
        1_000 + VOICE_NAVIGATION_PARTIAL_TIMEOUT_MS,
      ),
    ).toBe(false);
    expect(
      hasVoiceNavigationPartialExpired(
        1_000,
        1_001 + VOICE_NAVIGATION_PARTIAL_TIMEOUT_MS,
      ),
    ).toBe(true);
  });
});
