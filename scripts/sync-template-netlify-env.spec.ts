import { describe, expect, it } from "vitest";

import {
  isAllowedHostedTemplateEnvKey,
  isForbiddenHostedTemplateEnvKey,
  normalizeProductionUrlEntry,
} from "./sync-template-netlify-env";

describe("isAllowedHostedTemplateEnvKey", () => {
  it("allows the browser-restricted Google Picker configuration", () => {
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_PICKER_API_KEY")).toBe(true);
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_PICKER_APP_ID")).toBe(true);
  });

  it("allows server Sentry configuration for hosted error monitoring", () => {
    expect(isAllowedHostedTemplateEnvKey("SENTRY_DSN")).toBe(true);
    expect(isAllowedHostedTemplateEnvKey("SENTRY_SERVER_DSN")).toBe(true);
  });
});

describe("isForbiddenHostedTemplateEnvKey", () => {
  it("rejects the backend Demo mode switch", () => {
    expect(isForbiddenHostedTemplateEnvKey("DEMO_MODE")).toBe(true);
  });
});

describe("normalizeProductionUrlEntry", () => {
  it.each(["APP_URL", "BETTER_AUTH_URL"])(
    "canonicalizes a stale workspace origin for Dispatch %s",
    (key) => {
      expect(
        normalizeProductionUrlEntry(
          "dispatch",
          "production",
          key,
          "https://agent-workspace.builder.io",
        ),
      ).toEqual({
        value: "https://dispatch.agent-native.com",
        normalized: true,
      });
    },
  );

  it("preserves workspace values outside production", () => {
    const value = "https://agent-workspace.builder.io";

    expect(
      normalizeProductionUrlEntry(
        "dispatch",
        "deploy-preview",
        "APP_URL",
        value,
      ),
    ).toEqual({ value, normalized: false });
  });
});
