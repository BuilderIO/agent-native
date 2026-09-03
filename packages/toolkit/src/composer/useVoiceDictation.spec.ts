import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
