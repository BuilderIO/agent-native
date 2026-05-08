import { afterEach, describe, expect, it, vi } from "vitest";
import { voiceDictationStartErrorMessage } from "./useVoiceDictation.js";

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
