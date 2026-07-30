import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackButton, resolveFeedbackUrl } from "./FeedbackButton";

describe("resolveFeedbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hides feedback on cloned apps unless a URL is configured", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_FEEDBACK_URL", "");

    expect(resolveFeedbackUrl(undefined, "example.com")).toBeNull();
  });

  it("uses the Agent Native feedback form on first-party production hosts", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_FEEDBACK_URL", "");
    vi.stubGlobal("location", { hostname: "analytics.agent-native.com" });

    expect(resolveFeedbackUrl()).toBe(
      "https://forms.agent-native.com/f/agent-native-feedback/_16ewV",
    );
    expect(resolveFeedbackUrl(undefined, null)).toBeNull();
    expect(resolveFeedbackUrl(undefined, "agent-native.com")).toBe(
      "https://forms.agent-native.com/f/agent-native-feedback/_16ewV",
    );
    expect(resolveFeedbackUrl(undefined, "fakeagent-native.com")).toBeNull();
  });

  it("keeps the first-party fallback out of the server-rendered tree", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_FEEDBACK_URL", "");
    vi.stubGlobal("location", { hostname: "analytics.agent-native.com" });

    expect(renderToString(createElement(FeedbackButton))).toBe("");
  });

  it("uses the configured public feedback URL", () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      " https://feedback.example.com/f/product/form-id ",
    );

    expect(resolveFeedbackUrl(undefined, "example.com")).toBe(
      "https://feedback.example.com/f/product/form-id",
    );
  });

  it("allows callers to provide or explicitly disable a URL", () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      "https://feedback.example.com/f/default/form-id",
    );

    expect(
      resolveFeedbackUrl(
        "https://feedback.example.com/f/custom/form-id",
        "analytics.agent-native.com",
      ),
    ).toBe("https://feedback.example.com/f/custom/form-id");
    expect(resolveFeedbackUrl(null, "analytics.agent-native.com")).toBeNull();
  });
});
