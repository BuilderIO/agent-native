import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_SETTINGS } from "../../shared/types.js";
import { brainPrivacyReadiness } from "./privacy-readiness.js";

describe("Brain privacy readiness", () => {
  it("warns loudly until both the approved model and engine are configured", () => {
    expect(brainPrivacyReadiness(DEFAULT_BRAIN_SETTINGS)).toMatchObject({
      configured: false,
      model: null,
      engine: null,
    });
    expect(brainPrivacyReadiness(DEFAULT_BRAIN_SETTINGS).warning).toContain(
      "uncertain captures are quarantined",
    );
    expect(
      brainPrivacyReadiness({
        ...DEFAULT_BRAIN_SETTINGS,
        privacyClassifierModel: "privacy-model",
      }).configured,
    ).toBe(false);
  });

  it("reports a configured approved classifier only when both values exist", () => {
    expect(
      brainPrivacyReadiness({
        ...DEFAULT_BRAIN_SETTINGS,
        privacyClassifierModel: " privacy-model ",
        privacyClassifierEngine: " privacy-engine ",
      }),
    ).toMatchObject({
      configured: true,
      model: "privacy-model",
      engine: "privacy-engine",
      warning: null,
    });
  });
});
