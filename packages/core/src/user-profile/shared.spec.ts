import { describe, expect, it } from "vitest";

import {
  getOnboardingRoleTextForAnalytics,
  isEmailDerivedName,
} from "./shared.js";

describe("isEmailDerivedName", () => {
  it("recognizes Content's formatted local-part fallback", () => {
    expect(isEmailDerivedName("John Doe", "john.doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Doe", "john-doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Doe", "john_doe@example.com")).toBe(true);
    expect(isEmailDerivedName("John Smith", "john.doe@example.com")).toBe(
      false,
    );
  });
});

describe("getOnboardingRoleTextForAnalytics", () => {
  it("leaves listed roles to the role category", () => {
    expect(getOnboardingRoleTextForAnalytics("developer")).toBeUndefined();
    expect(getOnboardingRoleTextForAnalytics("other")).toBeUndefined();
  });

  it("replaces contact details and collapses whitespace", () => {
    expect(
      getOnboardingRoleTextForAnalytics(
        "Recruiter  at www.acme.io\n(text me: +1 415-555-0100) bob@acme.io",
      ),
    ).toBe("Recruiter at [url] (text me: [number]) [email]");
  });

  it("caps the text at 80 characters without splitting a character", () => {
    const text = getOnboardingRoleTextForAnalytics(
      `${"a".repeat(79)}🎨 designer`,
    );
    expect(text).toBe(`${"a".repeat(79)}🎨`);
    expect(Array.from(text ?? "")).toHaveLength(80);
  });
});
