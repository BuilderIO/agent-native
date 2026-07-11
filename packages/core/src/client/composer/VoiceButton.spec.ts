import { describe, expect, it } from "vitest";

import { isRealtimeVoiceSetupRequired } from "./VoiceButton.js";

describe("isRealtimeVoiceSetupRequired", () => {
  it("waits for the voice-specific provider status before prompting setup", () => {
    expect(isRealtimeVoiceSetupRequired(null, false)).toBe(false);
  });

  it("does not wait on the redundant Builder status after voice status resolves", () => {
    expect(
      isRealtimeVoiceSetupRequired({ builder: false, openai: false }, null),
    ).toBe(true);
  });

  it("accepts either managed Builder voice or an OpenAI key", () => {
    expect(
      isRealtimeVoiceSetupRequired({ builder: true, openai: false }, false),
    ).toBe(false);
    expect(
      isRealtimeVoiceSetupRequired({ builder: false, openai: true }, false),
    ).toBe(false);
    expect(
      isRealtimeVoiceSetupRequired({ builder: false, openai: false }, true),
    ).toBe(false);
  });

  it("prompts setup only when neither realtime provider is configured", () => {
    expect(
      isRealtimeVoiceSetupRequired({ builder: false, openai: false }, false),
    ).toBe(true);
  });
});
