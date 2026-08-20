import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailsHandlerSource(): string {
  return readFileSync(new URL("./emails.ts", import.meta.url), "utf8");
}

describe("emails handler Gmail draft listing", () => {
  it("hydrates full draft payloads while keeping other thread lists on metadata", () => {
    const source = emailsHandlerSource();

    expect(source).toContain(
      'threadFormat: view === "drafts" ? "full" : "metadata"',
    );
  });

  it("uses attachment account metadata when resolving Gmail-backed draft attachments", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("requestAccountEmail ?? attachment.accountEmail");
  });
});

describe("emails handler Gmail label listing", () => {
  it("does not turn a full Gmail label read failure into local fallback data", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("setResponseStatus(_event, 502)");
    expect(source).toContain("Unable to load Gmail labels. Please retry.");
  });
});
