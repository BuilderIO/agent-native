import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_SETTINGS } from "../../shared/types.js";
import { brainPrivacyReadiness } from "./privacy-readiness.js";

const MODEL_ONLY = {
  ...DEFAULT_BRAIN_SETTINGS,
  privacyClassifier: "model" as const,
};

describe("Brain privacy readiness", () => {
  it("warns loudly until both the approved model and engine are configured", () => {
    expect(brainPrivacyReadiness(MODEL_ONLY, "none")).toMatchObject({
      configured: false,
      model: null,
      engine: null,
    });
    expect(brainPrivacyReadiness(MODEL_ONLY, "none").warning).toContain(
      "uncertain captures are quarantined",
    );
    expect(
      brainPrivacyReadiness(
        { ...MODEL_ONLY, privacyClassifierModel: "privacy-model" },
        "none",
      ).configured,
    ).toBe(false);
  });

  it("reports a configured approved classifier only when both values exist", () => {
    expect(
      brainPrivacyReadiness(
        {
          ...MODEL_ONLY,
          privacyClassifierModel: " privacy-model ",
          privacyClassifierEngine: " privacy-engine ",
        },
        "none",
      ),
    ).toMatchObject({
      configured: true,
      model: "privacy-model",
      engine: "privacy-engine",
      warning: null,
    });
  });

  it("is ready as soon as Jev resolves a credential", () => {
    for (const credential of ["stored-key", "builder-gateway"] as const) {
      expect(
        brainPrivacyReadiness(DEFAULT_BRAIN_SETTINGS, credential),
      ).toMatchObject({
        configured: true,
        classifier: "jev",
        jevCredential: credential,
        warning: null,
      });
    }
  });

  it("is not ready when Jev is selected but nothing can classify", () => {
    const readiness = brainPrivacyReadiness(DEFAULT_BRAIN_SETTINGS, "none");

    expect(readiness.configured).toBe(false);
    expect(readiness.warning).toContain("no credential was found");
  });

  it("falls back to the approved model and says so", () => {
    const readiness = brainPrivacyReadiness(
      {
        ...DEFAULT_BRAIN_SETTINGS,
        privacyClassifierModel: "privacy-model",
        privacyClassifierEngine: "privacy-engine",
      },
      "none",
    );

    expect(readiness.configured).toBe(true);
    expect(readiness.warning).toContain("approved model instead");
  });

  it("distinguishes a failed credential lookup from a missing credential", () => {
    expect(
      brainPrivacyReadiness(DEFAULT_BRAIN_SETTINGS, "unavailable").warning,
    ).toContain("lookup failed");
  });

  it("treats deterministic-only as a deliberate, unconfigured choice", () => {
    const readiness = brainPrivacyReadiness(
      { ...DEFAULT_BRAIN_SETTINGS, privacyClassifier: "deterministic" },
      "none",
    );

    expect(readiness.configured).toBe(false);
    expect(readiness.warning).toContain("Deterministic-only");
  });
});
