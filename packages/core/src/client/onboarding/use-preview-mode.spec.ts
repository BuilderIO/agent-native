import { describe, expect, it } from "vitest";

import {
  getOnboardingPreviewStep,
  isOnboardingPreviewQuery,
} from "./use-preview-mode.js";

describe("isOnboardingPreviewQuery", () => {
  it("recognizes the explicit onboarding preview URL", () => {
    expect(isOnboardingPreviewQuery("?onboarding=preview")).toBe(true);
    expect(
      isOnboardingPreviewQuery("?initialPrompt=hello&onboarding=preview"),
    ).toBe(true);
  });

  it("does not treat unrelated or incomplete query params as preview mode", () => {
    expect(isOnboardingPreviewQuery("?onboarding=true")).toBe(false);
    expect(isOnboardingPreviewQuery("?preview=onboarding")).toBe(false);
    expect(isOnboardingPreviewQuery("")).toBe(false);
  });

  it("accepts only known preview steps and requires onboarding preview mode", () => {
    expect(getOnboardingPreviewStep("?onboarding=preview&step=choice")).toBe(
      "choice",
    );
    expect(
      getOnboardingPreviewStep("?onboarding=preview&step=references"),
    ).toBe("references");
    expect(
      getOnboardingPreviewStep("?onboarding=preview&step=not-a-step"),
    ).toBeNull();
    expect(getOnboardingPreviewStep("?step=tools")).toBeNull();
  });
});
