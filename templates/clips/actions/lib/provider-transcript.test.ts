import { describe, expect, it } from "vitest";

import {
  filterProviderTranscriptSegments,
  isNoSpeechProviderText,
  normalizeProviderTranscript,
} from "./provider-transcript";

describe("provider transcript normalization", () => {
  it("treats provider no-speech boilerplate as an empty transcript", () => {
    const normalized = normalizeProviderTranscript("No speech was detected.", [
      { startMs: 0, endMs: 2000, text: "No speech was detected." },
    ]);

    expect(normalized.fullText).toBe("");
    expect(normalized.segments).toEqual([]);
  });

  it("matches common no-speech variants", () => {
    expect(isNoSpeechProviderText("[No spoken words detected.]")).toBe(true);
    expect(
      isNoSpeechProviderText("There are no spoken words in the audio."),
    ).toBe(true);
    expect(isNoSpeechProviderText("No speech was detected. Then hello.")).toBe(
      false,
    );
  });

  it("keeps spoken text while dropping no-speech segments", () => {
    const segments = filterProviderTranscriptSegments([
      { startMs: 0, endMs: 500, text: "No speech detected." },
      { startMs: 500, endMs: 1000, text: "Hello there." },
    ]);

    expect(segments).toEqual([
      { startMs: 500, endMs: 1000, text: "Hello there." },
    ]);
  });
});
