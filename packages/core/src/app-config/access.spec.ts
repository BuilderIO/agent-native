import { describe, expect, it } from "vitest";

import { accessConfig } from "./access.js";

describe("accessConfig.allowedEmailDomains", () => {
  it("defaults to allowing any domain", () => {
    expect(accessConfig.parse({}).allowedEmailDomains).toEqual([]);
  });

  it("normalizes domains to trimmed lowercase", () => {
    expect(
      accessConfig.parse({ allowedEmailDomains: [" Example.COM ", "a.io"] })
        .allowedEmailDomains,
    ).toEqual(["example.com", "a.io"]);
  });

  it.each([
    "",
    "-example.com",
    "example.com.",
    "user@example.com",
    "exa mple.com",
    "*.example.com",
  ])("rejects %j", (domain) => {
    expect(
      accessConfig.safeParse({ allowedEmailDomains: [domain] }).success,
    ).toBe(false);
  });

  it("accepts a single-label domain", () => {
    expect(
      accessConfig.parse({ allowedEmailDomains: ["x"] }).allowedEmailDomains,
    ).toEqual(["x"]);
  });

  it("is settable through AUTH_ALLOWED_EMAIL_DOMAINS", () => {
    const meta = accessConfig.shape.allowedEmailDomains.meta() as {
      env?: string;
      doc?: string;
    };
    expect(meta.env).toBe("AUTH_ALLOWED_EMAIL_DOMAINS");
    expect(meta.doc).toMatch(/email domains/);
  });
});
