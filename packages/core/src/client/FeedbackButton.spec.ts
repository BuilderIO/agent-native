import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveFeedbackUrl } from "./FeedbackButton";

describe("resolveFeedbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hides feedback unless a URL is configured", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_FEEDBACK_URL", "");

    expect(resolveFeedbackUrl()).toBeNull();
  });

  it("uses the configured public feedback URL", () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      " https://feedback.example.com/f/product/form-id ",
    );

    expect(resolveFeedbackUrl()).toBe(
      "https://feedback.example.com/f/product/form-id",
    );
  });

  it("allows callers to provide or explicitly disable a URL", () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      "https://feedback.example.com/f/default/form-id",
    );

    expect(
      resolveFeedbackUrl("https://feedback.example.com/f/custom/form-id"),
    ).toBe("https://feedback.example.com/f/custom/form-id");
    expect(resolveFeedbackUrl(null)).toBeNull();
  });
});
