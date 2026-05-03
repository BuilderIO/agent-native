import { afterEach, describe, expect, it, vi } from "vitest";
import { getOnboardingHtml } from "./onboarding-html.js";

describe("getOnboardingHtml", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not include local upgrade copy in SSR HTML by default", () => {
    const html = getOnboardingHtml();

    expect(html).not.toContain("local@localhost");
    expect(html).not.toContain("You started this flow");
    expect(html).toContain('id="upgrade-note"');
  });

  it("reveals the upgrade note only from explicit upgrade markers", () => {
    const html = getOnboardingHtml();

    expect(html).toContain("upgrade-from-local");
    expect(html).toContain("an_migrate_from_local");
    expect(html).toContain(
      "Continue signing in to attach this app to your account and migrate local data.",
    );
  });

  it("injects APP_BASE_PATH so mounted login pages call app-scoped auth endpoints", () => {
    vi.stubEnv("APP_BASE_PATH", "/starter/");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

    const html = getOnboardingHtml();

    expect(html).toContain('var configured = "/starter";');
    expect(html).toContain("__anPath('/_agent-native/auth/session')");
    expect(html).toContain("__anPath('/_agent-native/auth/register')");
    expect(html).toContain("__anPath('/_agent-native/auth/login')");
    expect(html).toContain(
      "__anPath('/_agent-native/auth/ba/request-password-reset')",
    );
    expect(html).toContain("__anPath('/_agent-native/google/auth-url')");
  });
});
