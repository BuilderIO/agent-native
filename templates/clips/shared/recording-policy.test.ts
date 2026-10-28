import { describe, expect, it } from "vitest";

import { recordingPolicyFromLab } from "./recording-policy";

describe("recordingPolicyFromLab", () => {
  it("applies an explicit choice to all recording stages", () => {
    expect(recordingPolicyFromLab({ enabled: true, source: "choice" })).toEqual(
      {
        customCapture: true,
        liveUpload: true,
        recovery: true,
      },
    );
    expect(
      recordingPolicyFromLab({ enabled: false, source: "choice" }),
    ).toEqual({
      customCapture: false,
      liveUpload: false,
      recovery: false,
    });
  });

  it("preserves a mixed inherited tuple until the user chooses", () => {
    expect(
      recordingPolicyFromLab({
        enabled: false,
        source: "legacy",
        legacyValues: {
          useCustomSCKPipeline: true,
          customSCKPipelineLiveUploadEnabled: false,
          uploadRetryResume: true,
        },
      }),
    ).toEqual({ customCapture: true, liveUpload: false, recovery: true });
  });

  it("does not treat missing inherited values as a normal preference", () => {
    expect(() =>
      recordingPolicyFromLab({ enabled: false, source: "legacy" }),
    ).toThrow("Inherited recording settings are unavailable");
  });
});
