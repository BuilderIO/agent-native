import { describe, expect, it } from "vitest";

import { parseContextMemberships, parseCreativeContexts } from "./actions.js";

describe("creative context client action contracts", () => {
  it("accepts the canonical list result and tolerates an array result", () => {
    const context = { id: "context-1", name: "Campaign", policy: "review" };
    expect(parseCreativeContexts({ contexts: [context] })).toEqual([
      expect.objectContaining(context),
    ]);
    expect(parseCreativeContexts([context])).toEqual([
      expect.objectContaining(context),
    ]);
  });

  it("normalizes membership ranks and accepts nested context metadata", () => {
    expect(
      parseContextMemberships({
        memberships: [
          {
            id: "membership-1",
            contextId: "context-1",
            appId: "slides",
            resourceType: "presentation",
            resourceId: "deck-1",
            rank: "canonical",
            status: "pending",
            context: { id: "context-1", name: "Campaign", policy: "review" },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        rank: "canonical",
        status: "pending",
        context: expect.objectContaining({ name: "Campaign" }),
      }),
    ]);
  });
});
