import { describe, expect, it } from "vitest";

import { classifyAutomated } from "./inbox-classify.js";

function h(name: string, value: string) {
  return { name, value };
}

function base(
  overrides: Partial<Parameters<typeof classifyAutomated>[0]> = {},
) {
  return {
    headers: [] as Array<{ name?: string | null; value?: string | null }>,
    labelIds: [] as string[],
    fromEmail: "friend@example.com",
    ...overrides,
  };
}

describe("classifyAutomated", () => {
  it("is false for a plain personal email with no markers", () => {
    expect(classifyAutomated(base())).toBe(false);
  });

  it("is true for reminder@ senders (Superhuman reminders and the like)", () => {
    expect(
      classifyAutomated(base({ fromEmail: "reminder@superhuman.com" })),
    ).toBe(true);
  });

  it("is true when List-Unsubscribe is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("List-Unsubscribe", "<mailto:x@y.com>")] }),
      ),
    ).toBe(true);
  });

  it("is true when List-Id is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("List-Id", "<list.example.com>")] }),
      ),
    ).toBe(true);
  });

  it("is true when Precedence is bulk", () => {
    expect(
      classifyAutomated(base({ headers: [h("Precedence", "bulk")] })),
    ).toBe(true);
  });

  it("is true when Precedence is list", () => {
    expect(
      classifyAutomated(base({ headers: [h("Precedence", "list")] })),
    ).toBe(true);
  });

  it("is true when Auto-Submitted is not 'no'", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("Auto-Submitted", "auto-generated")] }),
      ),
    ).toBe(true);
  });

  it("is false when Auto-Submitted is exactly 'no'", () => {
    expect(
      classifyAutomated(base({ headers: [h("Auto-Submitted", "no")] })),
    ).toBe(false);
  });

  it("is true when X-Auto-Response-Suppress is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("X-Auto-Response-Suppress", "OOF")] }),
      ),
    ).toBe(true);
  });

  it("is true when Feedback-ID is present", () => {
    expect(
      classifyAutomated(base({ headers: [h("Feedback-ID", "1:abc:gmail")] })),
    ).toBe(true);
  });

  it("is true for CATEGORY_PROMOTIONS / SOCIAL / UPDATES / FORUMS labels", () => {
    for (const label of [
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_UPDATES",
      "CATEGORY_FORUMS",
    ]) {
      expect(classifyAutomated(base({ labelIds: [label] }))).toBe(true);
    }
  });

  it("is true for no-reply / notifications local-part senders", () => {
    for (const fromEmail of [
      "no-reply@somesaas.io",
      "noreply@somesaas.io",
      "donotreply@somesaas.io",
      "notifications@somesaas.io",
      "alerts@somesaas.io",
    ]) {
      expect(classifyAutomated(base({ fromEmail }))).toBe(true);
    }
  });

  it("is false for a local-part that merely contains 'reply' mid-word", () => {
    expect(classifyAutomated(base({ fromEmail: "replyguy@example.com" }))).toBe(
      false,
    );
  });
});
