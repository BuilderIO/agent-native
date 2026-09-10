import { describe, expect, it } from "vitest";

import { isOnboardingPreviewQuery } from "./use-preview-mode.js";

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
});
