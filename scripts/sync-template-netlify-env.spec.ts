import { describe, expect, it } from "vitest";

import {
  isAllowedHostedTemplateEnvKey,
  isForbiddenHostedTemplateEnvKey,
  normalizeProductionUrlEntry,
  resolveNetlifyApiContext,
  resolveNetlifyTemplateName,
} from "./sync-template-netlify-env";

describe("isAllowedHostedTemplateEnvKey", () => {
  it("allows the browser-restricted Google Picker configuration", () => {
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_PICKER_API_KEY")).toBe(true);
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_PICKER_APP_ID")).toBe(true);
    // Google OAuth credentials must never sync from a template's local .env to
    // a hosted site: local holds a dev client, hosted runs the shared production
    // one. Syncing them took beta sign-in down fleet-wide on 2026-08-20.
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_SIGN_IN_CLIENT_ID")).toBe(
      false,
    );
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_SIGN_IN_CLIENT_SECRET")).toBe(
      false,
    );
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_CLIENT_ID")).toBe(false);
    expect(isAllowedHostedTemplateEnvKey("GOOGLE_CLIENT_SECRET")).toBe(false);
  });

  it("allows server Sentry configuration for hosted error monitoring", () => {
    expect(isAllowedHostedTemplateEnvKey("SENTRY_DSN")).toBe(true);
    expect(isAllowedHostedTemplateEnvKey("SENTRY_SERVER_DSN")).toBe(true);
  });

  it("allows the hosted tools-only harness deployment gate", () => {
    expect(isAllowedHostedTemplateEnvKey("AGENT_NATIVE_HOSTED_HARNESS")).toBe(
      true,
    );
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

  it("uses the current starter deployment origin for the chat source template", () => {
    expect(
      normalizeProductionUrlEntry(
        "starter",
        "production",
        "APP_URL",
        "https://chat.agent-native.com",
      ),
    ).toEqual({
      value: "https://starter.agent-native.com",
      normalized: true,
    });
  });

  it("uses the beta deployment origin for beta branch context", () => {
    expect(
      normalizeProductionUrlEntry(
        "clips",
        "branch:beta",
        "BETTER_AUTH_URL",
        "http://localhost:8094",
      ),
    ).toEqual({
      value: "https://beta.clips.agent-native.com",
      normalized: true,
    });
  });
});

describe("resolveNetlifyApiContext", () => {
  it("uses production scope for the dedicated beta projects", () => {
    expect(resolveNetlifyApiContext("branch:beta")).toBe("production");
    expect(resolveNetlifyApiContext("beta")).toBe("production");
  });

  it("preserves ordinary Netlify contexts", () => {
    expect(resolveNetlifyApiContext("deploy-preview")).toBe("deploy-preview");
    expect(resolveNetlifyApiContext("production")).toBe("production");
  });
});

describe("resolveNetlifyTemplateName", () => {
  it("maps the legacy chat template name to the current starter site", () => {
    expect(resolveNetlifyTemplateName("chat")).toBe("starter");
  });

  it("preserves current Netlify site names", () => {
    expect(resolveNetlifyTemplateName("clips")).toBe("clips");
  });
});
