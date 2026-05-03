import { describe, expect, it } from "vitest";
import { getOnboardingHtml } from "./onboarding-html.js";

describe("getOnboardingHtml", () => {
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
});
