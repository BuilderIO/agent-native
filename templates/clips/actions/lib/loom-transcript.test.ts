import { describe, expect, it } from "vitest";

import {
  extractLoomTranscriptSourceUrls,
  parseLoomTranscriptJson,
} from "./loom-transcript";

describe("Loom transcript import helpers", () => {
  it("extracts signed Loom transcript JSON URLs from page HTML", () => {
    const html = String.raw`{
      "source_url":"https:\/\/cdn.loom.com\/mediametadata\/transcription\/abcDEF_123456-2.json?Policy=policy\u0026Key-Pair-Id=key\u0026Signature=sig",
      "ignored_url":"https:\/\/cdn.loom.com\/mediametadata\/captions\/abcDEF_123456-2.vtt?Policy=policy\u0026Key-Pair-Id=key\u0026Signature=sig",
      "source_url":"https:\/\/evil.example\/mediametadata\/transcription\/abcDEF_123456-2.json?Policy=policy",
      "source_url":"https:\/\/cdn.loom.com\/mediametadata\/transcription\/abcDEF_123456-2.json?Policy=policy\u0026Key-Pair-Id=key\u0026Signature=sig"
    }`;

    expect(extractLoomTranscriptSourceUrls(html)).toEqual([
      "https://cdn.loom.com/mediametadata/transcription/abcDEF_123456-2.json?Policy=policy&Key-Pair-Id=key&Signature=sig",
    ]);
  });

  it("normalizes Loom transcript phrases into Clips segments", () => {
    const transcript = parseLoomTranscriptJson(
      {
        phrases: [
          { ts: 0.011, value: " Hello world. " },
          { ts: 2.4, value: "Next phrase." },
        ],
      },
      5_000,
    );

    expect(transcript?.fullText).toBe("Hello world. Next phrase.");
    expect(transcript?.language).toBe("en");
    expect(transcript?.segments).toEqual([
      { startMs: 11, endMs: 2400, text: "Hello world." },
      { startMs: 2400, endMs: 5000, text: "Next phrase." },
    ]);
  });

  it("returns null when Loom has no usable phrases", () => {
    expect(parseLoomTranscriptJson({ phrases: [] }, 5_000)).toBeNull();
    expect(parseLoomTranscriptJson({ phrases: [{ ts: 1, value: " " }] })).toBe(
      null,
    );
  });
});
