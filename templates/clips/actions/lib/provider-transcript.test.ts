import { describe, expect, it } from "vitest";

import {
  filterProviderTranscriptSegments,
  isLikelyMismatchedTranscriptLanguage,
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

  it("flags ready transcripts whose stored language strongly disagrees with the script", () => {
    expect(
      isLikelyMismatchedTranscriptLanguage(
        "en",
        "我會去學習我的課程。然後我可以選擇這個團。",
      ),
    ).toBe(true);
    expect(
      isLikelyMismatchedTranscriptLanguage(
        "zh-CN",
        "I was speaking English about GitHub Copilot scrolling.",
      ),
    ).toBe(true);
  });

  it("does not flag mixed-language mentions inside otherwise matching transcripts", () => {
    expect(
      isLikelyMismatchedTranscriptLanguage(
        "en",
        "Open the GitHub issue and select the 中文 label.",
      ),
    ).toBe(false);
    expect(
      isLikelyMismatchedTranscriptLanguage(
        "zh-TW",
        "請打開 GitHub Copilot app 的設定。",
      ),
    ).toBe(false);
  });
});
