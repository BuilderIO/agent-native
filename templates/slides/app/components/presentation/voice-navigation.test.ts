import { describe, expect, it } from "vitest";

import { matchVoiceNavigationPhrase } from "./voice-navigation";

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
});
