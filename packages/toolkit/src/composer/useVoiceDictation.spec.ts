import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMicrophoneAccessError,
  providerForTextCleanup,
  voiceDictationStartErrorMessage,
} from "./useVoiceDictation.js";

describe("voiceDictationStartErrorMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains permissions policy blocks separately from site settings", () => {
    vi.stubGlobal("document", {
      permissionsPolicy: { allowsFeature: () => false },
    });

    expect(
      voiceDictationStartErrorMessage({
        name: "NotAllowedError",
        message: "Permission denied",
      }),
    ).toContain("browser permissions policy");
  });

  it("points denied microphone permissions at site controls", () => {
    expect(
      voiceDictationStartErrorMessage({
        name: "NotAllowedError",
        message: "Permission denied",
      }),
    ).toContain("site controls icon");
  });

  it("points an operating system block at system privacy settings", () => {
    expect(
      voiceDictationStartErrorMessage({
        name: "NotAllowedError",
        message: "Permission denied by system",
      }),
    ).toContain("system privacy settings");
  });

  it("reads each message from the catalog when a translator is given", () => {
    const t = vi.fn((key: string) => `translated:${key}`);

    expect(voiceDictationStartErrorMessage({ name: "NotFoundError" }, t)).toBe(
      "translated:agentChat.voice.dictation.errors.noMicrophone",
    );
    expect(
      voiceDictationStartErrorMessage({ name: "NotReadableError" }, t),
    ).toBe("translated:agentChat.voice.dictation.errors.microphoneBusy");
  });
});

describe("isMicrophoneAccessError", () => {
  it("recognizes getUserMedia access and device failures only", () => {
    expect(isMicrophoneAccessError({ name: "NotAllowedError" })).toBe(true);
    expect(isMicrophoneAccessError({ name: "NotFoundError" })).toBe(true);
    expect(isMicrophoneAccessError(new Error("session failed"))).toBe(false);
    expect(isMicrophoneAccessError(null)).toBe(false);
  });
});

describe("providerForTextCleanup", () => {
  it("keeps browser-only dictation on the browser provider", () => {
    expect(providerForTextCleanup("browser")).toBe("browser");
  });

  it("uses auto cleanup only for realtime providers without a cleanup endpoint", () => {
    expect(providerForTextCleanup("google-realtime")).toBe("auto");
    expect(providerForTextCleanup("openai")).toBe("openai");
  });
});
