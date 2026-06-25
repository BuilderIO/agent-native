import { describe, it, expect } from "vitest";

import type { FormField } from "../../shared/types.js";
import { buildSlackPayload } from "./integrations.js";

const field: FormField = {
  id: "msg",
  type: "textarea",
  label: "Feedback",
  required: true,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    formId: "form-1",
    formTitle: "Agent Native Feedback",
    responseId: "resp-1",
    fields: [field],
    data: { msg: "the comments are buggy" },
    submittedAt: "2026-06-23T12:00:00.000Z",
    ...overrides,
  };
}

/** Pull the trailing context block's mrkdwn text out of a Slack payload. */
function contextText(p: ReturnType<typeof buildSlackPayload>): string {
  const ctx = p.blocks.find((b) => b.type === "context") as
    | { elements: Array<{ text: string }> }
    | undefined;
  return ctx?.elements?.[0]?.text ?? "";
}

describe("buildSlackPayload page context", () => {
  it("shows a friendly App label and a readable page link for a per-app host", () => {
    const text = contextText(
      buildSlackPayload(
        payload({ pageUrl: "https://plan.agent-native.com/plans/plan-abc123" }),
      ),
    );
    expect(text).toContain("App: Plan");
    // The page is legible inline (host+path as link text), not hidden behind "open".
    expect(text).toContain(
      "Page: <https://plan.agent-native.com/plans/plan-abc123|plan.agent-native.com/plans/plan-abc123>",
    );
    expect(text).not.toContain("|open>");
  });

  it("title-cases hyphenated subdomains", () => {
    const text = contextText(
      buildSlackPayload(
        payload({ pageUrl: "https://analytics.agent-native.com/dashboards/7" }),
      ),
    );
    expect(text).toContain("App: Analytics");
  });

  it("omits the App label for non-app hosts but keeps the page legible", () => {
    const text = contextText(
      buildSlackPayload(
        payload({ pageUrl: "https://www.agent-native.com/pricing" }),
      ),
    );
    expect(text).not.toContain("App:");
    expect(text).toContain("www.agent-native.com/pricing");
  });

  it("falls back gracefully when no page url is present", () => {
    const text = contextText(buildSlackPayload(payload()));
    expect(text).not.toContain("App:");
    expect(text).not.toContain("Page:");
  });
});
