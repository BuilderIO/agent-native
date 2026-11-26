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
  it("recognizes a self-addressed conversation unless it is automated", () => {
    expect(classifyAutomated(base({ selfAddressed: true }))).toBe("personal");
    expect(
      classifyAutomated(
        base({ selfAddressed: true, labelIds: ["CATEGORY_UPDATES"] }),
      ),
    ).toBe("automated");
  });
  it("leaves missing sender metadata unclassified unless another signal identifies it", () => {
    expect(classifyAutomated(base({ fromEmail: "" }))).toBe("unclassified");
    expect(
      classifyAutomated(
        base({ fromEmail: "", labelIds: ["CATEGORY_UPDATES"] }),
      ),
    ).toBe("automated");
  });

  it("does not infer personal mail from a lack of automation markers", () => {
    expect(classifyAutomated(base())).toBe("unclassified");
    expect(classifyAutomated(base({ labelIds: ["CATEGORY_PERSONAL"] }))).toBe(
      "personal",
    );
  });

  it("is true for reminder@ senders (Superhuman reminders and the like)", () => {
    expect(
      classifyAutomated(base({ fromEmail: "reminder@superhuman.com" })),
    ).toBe("automated");
  });

  it("is true when List-Unsubscribe is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("List-Unsubscribe", "<mailto:x@y.com>")] }),
      ),
    ).toBe("automated");
  });

  it("is true when List-Id is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("List-Id", "<list.example.com>")] }),
      ),
    ).toBe("automated");
  });

  it("is true when Precedence is bulk", () => {
    expect(
      classifyAutomated(base({ headers: [h("Precedence", "bulk")] })),
    ).toBe("automated");
  });

  it("is true when Precedence is list", () => {
    expect(
      classifyAutomated(base({ headers: [h("Precedence", "list")] })),
    ).toBe("automated");
  });

  it("is true when Auto-Submitted is not 'no'", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("Auto-Submitted", "auto-generated")] }),
      ),
    ).toBe("automated");
  });

  it("does not treat Auto-Submitted: no as an automation signal", () => {
    expect(
      classifyAutomated(base({ headers: [h("Auto-Submitted", "no")] })),
    ).toBe("unclassified");
  });

  it("is true when X-Auto-Response-Suppress is present", () => {
    expect(
      classifyAutomated(
        base({ headers: [h("X-Auto-Response-Suppress", "OOF")] }),
      ),
    ).toBe("automated");
  });

  it("is true when Feedback-ID is present", () => {
    expect(
      classifyAutomated(base({ headers: [h("Feedback-ID", "1:abc:gmail")] })),
    ).toBe("automated");
  });

  it("is true for CATEGORY_PROMOTIONS / SOCIAL / UPDATES / FORUMS labels", () => {
    for (const label of [
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_UPDATES",
      "CATEGORY_FORUMS",
    ]) {
      expect(classifyAutomated(base({ labelIds: [label] }))).toBe("automated");
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
      expect(classifyAutomated(base({ fromEmail }))).toBe("automated");
    }
  });

  it("does not classify a local-part that merely contains 'reply' mid-word as automated", () => {
    expect(classifyAutomated(base({ fromEmail: "replyguy@example.com" }))).toBe(
      "unclassified",
    );
  });
});
