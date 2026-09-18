import { describe, expect, it } from "vitest";

import { scrubUrl } from "./url-scrub";

describe("scrubUrl", () => {
  it("redacts local Plan bridge credentials carried in a fragment", () => {
    const url =
      "https://plan.agent-native.com/local-plans/local#bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret";

    const scrubbed = scrubUrl(url);

    expect(scrubbed).toBe(
      "https://plan.agent-native.com/local-plans/local#bridge=%3Credacted%3E",
    );
    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).not.toContain("127.0.0.1");
  });

  it("preserves ordinary section anchors", () => {
    expect(scrubUrl("https://plan.agent-native.com/plans/123#overview")).toBe(
      "https://plan.agent-native.com/plans/123#overview",
    );
  });
});
