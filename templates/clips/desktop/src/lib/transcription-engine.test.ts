import { describe, expect, it } from "vitest";

import { recordingTranscriptionLanguage } from "./transcription-engine";

describe("recording transcription language", () => {
  it("leaves local Whisper recordings on auto-detect instead of forcing the UI locale", () => {
    expect(recordingTranscriptionLanguage()).toBeNull();
  });
});
