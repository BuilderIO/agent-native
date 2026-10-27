import { describe, expect, it } from "vitest";

import { isRealtimeVoiceChatAvailable } from "./VoiceButton.js";

// oracle-change: the realtime/dictation chooser and its remembered preference were removed, so setup gating is one availability check.
describe("isRealtimeVoiceChatAvailable", () => {
  it("treats an unresolved provider status as unavailable", () => {
    expect(isRealtimeVoiceChatAvailable(null)).toBe(false);
  });

  it("accepts either managed Builder voice or an OpenAI key", () => {
    expect(isRealtimeVoiceChatAvailable({ builder: true, openai: false })).toBe(
      true,
    );
    expect(isRealtimeVoiceChatAvailable({ builder: false, openai: true })).toBe(
      true,
    );
  });

  it("is unavailable when neither realtime provider is configured", () => {
    expect(
      isRealtimeVoiceChatAvailable({ builder: false, openai: false }),
    ).toBe(false);
  });
});
