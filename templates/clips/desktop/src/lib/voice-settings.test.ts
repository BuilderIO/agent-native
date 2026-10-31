import { describe, expect, it } from "vitest";

import {
  LEGACY_VOICE_PROVIDER_KEY,
  loadVoiceSettings,
  migrateLegacyVoiceProvider,
  resolveDictationRoute,
  VOICE_ENGINE_KEY,
  voiceEngineOptions,
  VOICE_POLISH_KEY,
  voicePolishMode,
  type VoiceSettings,
} from "./voice-settings";

function storage(values: Record<string, string>) {
  return (key: string): string | null => values[key] ?? null;
}

describe("migrateLegacyVoiceProvider", () => {
  it.each([
    ["macos-native", { engine: "native", polish: "off" }],
    ["browser", { engine: "native", polish: "off" }],
    ["whisper", { engine: "whisper", polish: "off" }],
    ["builder", { engine: "native", polish: "builder-gemini" }],
    ["builder-gemini", { engine: "native", polish: "builder-gemini" }],
    ["gemini", { engine: "native", polish: "gemini" }],
    ["groq", { engine: "native", polish: "groq" }],
    ["auto", { engine: "native", polish: "off" }],
    [null, { engine: "native", polish: "off" }],
    ["", { engine: "native", polish: "off" }],
    ["openai", { engine: "native", polish: "off" }],
  ] as const)("maps %s to %o", (saved, expected) => {
    expect(migrateLegacyVoiceProvider(saved)).toEqual(expected);
  });
});

describe("loadVoiceSettings", () => {
  it("migrates the old provider key when the split settings are absent", () => {
    expect(
      loadVoiceSettings(storage({ [LEGACY_VOICE_PROVIDER_KEY]: "groq" })),
    ).toEqual({ engine: "native", polish: "groq" });
  });

  it("starts a fresh install on built-in speech with polish off", () => {
    expect(loadVoiceSettings(storage({}))).toEqual({
      engine: "native",
      polish: "off",
    });
  });

  it("prefers the split settings over the old provider key", () => {
    expect(
      loadVoiceSettings(
        storage({
          [VOICE_ENGINE_KEY]: "whisper",
          [VOICE_POLISH_KEY]: "builder-gemini",
          [LEGACY_VOICE_PROVIDER_KEY]: "macos-native",
        }),
      ),
    ).toEqual({ engine: "whisper", polish: "builder-gemini" });
  });

  it("keeps polish off once it was turned off after migrating", () => {
    expect(
      loadVoiceSettings(
        storage({
          [VOICE_ENGINE_KEY]: "native",
          [VOICE_POLISH_KEY]: "off",
          [LEGACY_VOICE_PROVIDER_KEY]: "builder-gemini",
        }),
      ),
    ).toEqual({ engine: "native", polish: "off" });
  });

  it("fills an invalid split value from the old provider key", () => {
    expect(
      loadVoiceSettings(
        storage({
          [VOICE_ENGINE_KEY]: "whisper",
          [VOICE_POLISH_KEY]: "unknown",
          [LEGACY_VOICE_PROVIDER_KEY]: "gemini",
        }),
      ),
    ).toEqual({ engine: "whisper", polish: "gemini" });
  });
});

describe("resolveDictationRoute", () => {
  const mac = { isMac: true, hasBrowserSpeech: false };
  const offMacWithSpeech = { isMac: false, hasBrowserSpeech: true };
  const offMacWithoutSpeech = { isMac: false, hasBrowserSpeech: false };

  it.each([
    // Every pre-split provider value resolves the way it did before the split.
    ["macos-native", mac, { kind: "native" }],
    ["browser", mac, { kind: "native" }],
    ["whisper", mac, { kind: "whisper" }],
    ["builder", mac, { kind: "native", cleanupProvider: "builder-gemini" }],
    ["gemini", mac, { kind: "native", cleanupProvider: "gemini" }],
    ["groq", mac, { kind: "native", cleanupProvider: "groq" }],
    ["auto", mac, { kind: "native" }],
    ["browser", offMacWithSpeech, { kind: "browser" }],
    ["browser", offMacWithoutSpeech, { kind: "browser" }],
    ["whisper", offMacWithSpeech, { kind: "whisper" }],
    [
      "builder-gemini",
      offMacWithSpeech,
      { kind: "browser", cleanupProvider: "builder-gemini" },
    ],
    [
      "builder-gemini",
      offMacWithoutSpeech,
      { kind: "server", providerPref: "builder-gemini" },
    ],
    ["groq", offMacWithoutSpeech, { kind: "server", providerPref: "groq" }],
  ] as const)("keeps %s on %o resolving to %o", (saved, env, expected) => {
    expect(
      resolveDictationRoute(migrateLegacyVoiceProvider(saved), env),
    ).toEqual(expected);
  });

  it.each([
    [{ engine: "whisper", polish: "builder-gemini" }, mac],
    [{ engine: "whisper", polish: "groq" }, offMacWithoutSpeech],
  ] satisfies Array<[VoiceSettings, typeof mac]>)(
    "polishes Local Whisper text with %o",
    (settings, env) => {
      expect(resolveDictationRoute(settings, env)).toEqual({
        kind: "whisper",
        cleanupProvider: settings.polish,
      });
    },
  );
});

describe("settings options", () => {
  it("names the built-in engine for the platform", () => {
    expect(voiceEngineOptions(true)).toEqual([
      { value: "native", label: "Apple Speech" },
      { value: "whisper", label: "Local Whisper" },
    ]);
    expect(voiceEngineOptions(false)[0]).toEqual({
      value: "native",
      label: "Browser built-in",
    });
  });

  it.each([
    ["off", "off"],
    ["builder-gemini", "builder"],
    ["gemini", "byok"],
    ["groq", "byok"],
  ] as const)("shows %s polish as %s", (polish, mode) => {
    expect(voicePolishMode(polish)).toBe(mode);
  });
});
