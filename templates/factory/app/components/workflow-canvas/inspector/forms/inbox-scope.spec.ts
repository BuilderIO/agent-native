import { describe, expect, it } from "vitest";

import { isInvalidInboxScope } from "./inbox-scope";

describe("isInvalidInboxScope", () => {
  it("takes a Slack channel id and refuses a channel name", () => {
    expect(isInvalidInboxScope("slack", "C0123456789")).toBe(false);
    expect(isInvalidInboxScope("slack", "G01ABCDEF")).toBe(false);
    expect(isInvalidInboxScope("slack", "#eng")).toBe(true);
    expect(isInvalidInboxScope("slack", "eng")).toBe(true);
    expect(isInvalidInboxScope("slack", "C0123456789, C0123456780")).toBe(true);
  });

  it("takes owner/repo or a GitHub URL, as the job file does", () => {
    expect(isInvalidInboxScope("github", "acme/web")).toBe(false);
    expect(isInvalidInboxScope("github", "https://github.com/acme/web")).toBe(
      false,
    );
    expect(isInvalidInboxScope("github", "web")).toBe(true);
    expect(isInvalidInboxScope("github", "acme/web, acme/api")).toBe(true);
  });

  it("takes exactly organization/project for Sentry", () => {
    expect(isInvalidInboxScope("sentry", "acme/web")).toBe(false);
    expect(isInvalidInboxScope("sentry", "acme")).toBe(true);
    expect(isInvalidInboxScope("sentry", "acme/")).toBe(true);
    expect(isInvalidInboxScope("sentry", "acme/web/extra")).toBe(true);
  });
});
