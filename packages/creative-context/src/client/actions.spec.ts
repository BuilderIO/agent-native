import { describe, expect, it } from "vitest";

import {
  parseContextMemberships,
  parseContextMembershipsForResource,
  parseCreativeContexts,
} from "./actions.js";

describe("creative context client action contracts", () => {
  it("accepts the canonical list result and tolerates an array result", () => {
    const context = {
      id: "context-1",
      name: "Campaign",
      kind: "specialty",
      memberCount: 2,
      approvalPolicy: "review",
    };
    expect(parseCreativeContexts({ contexts: [context] })).toEqual([
      expect.objectContaining(context),
    ]);
    expect(parseCreativeContexts([context])).toEqual([
      expect.objectContaining(context),
    ]);
  });

  it("normalizes the server membership result without disclosing opaque handles", () => {
    const memberships = parseContextMemberships({
      memberships: [
        {
          id: "membership-1",
          contextId: "context-1",
          artifactKey: "private://provider/opaque-handle",
          privateMetadata: { token: "secret" },
          rank: "canonical",
          status: "active",
          pendingSubmission: { id: "submission-1", status: "pending" },
        },
      ],
    });
    expect(memberships).toEqual([
      expect.objectContaining({
        rank: "canonical",
        status: "active",
        pendingSubmission: expect.objectContaining({
          id: "submission-1",
          status: "pending",
        }),
      }),
    ]);
    expect(JSON.stringify(memberships)).not.toMatch(/opaque-handle|secret/);
  });

  it("filters resource memberships by the generic artifact identity without returning it", () => {
    const memberships = parseContextMembershipsForResource(
      {
        memberships: [
          {
            id: "keep",
            contextId: "context-1",
            artifactKey: "slides:presentation:deck-1",
            rank: "normal",
            status: "active",
          },
          {
            id: "drop",
            contextId: "context-1",
            artifactKey: "slides:presentation:deck-2",
            rank: "normal",
            status: "active",
          },
        ],
      },
      { appId: "slides", resourceType: "presentation", resourceId: "deck-1" },
    );
    expect(memberships.map((membership) => membership.id)).toEqual(["keep"]);
    expect(JSON.stringify(memberships)).not.toContain(
      "slides:presentation:deck-1",
    );
  });
});
