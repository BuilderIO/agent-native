import { describe, expect, it } from "vitest";

import { buildPlanMarkdownSectionCopyUrl } from "./PlanMarkdownReader";

describe("buildPlanMarkdownSectionCopyUrl", () => {
  it("removes local bridge tokens from copied section links", () => {
    expect(
      buildPlanMarkdownSectionCopyUrl(
        "https://plan.agent-native.com/local-plans/checkout?bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret&view=review#old",
        "plan-heading-intro-0",
      ),
    ).toBe(
      "https://plan.agent-native.com/local-plans/checkout?view=review#plan-heading-intro-0",
    );
  });

  it("preserves normal copied section links", () => {
    expect(
      buildPlanMarkdownSectionCopyUrl(
        "https://plan.agent-native.com/plans/plan_123?comment=open",
        "plan-heading-details-2",
      ),
    ).toBe(
      "https://plan.agent-native.com/plans/plan_123?comment=open#plan-heading-details-2",
    );
  });
});
