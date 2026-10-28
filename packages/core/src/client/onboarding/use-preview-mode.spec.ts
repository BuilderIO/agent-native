// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  getOnboardingPreviewStep,
  isOnboardingPreviewQuery,
  useOnboardingPreviewMode,
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

describe("useOnboardingPreviewMode", () => {
  it("ends preview when navigation leaves the preview URL", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", "/?onboarding=preview&step=choice");
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useOnboardingPreviewMode());
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(React.createElement(Probe)));
    expect(seen.at(-1)).toBe(true);

    act(() => {
      window.history.pushState(null, "", "/settings/model");
      window.dispatchEvent(new Event("popstate"));
    });
    expect(seen.at(-1)).toBe(false);

    act(() => root.unmount());
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });
});
