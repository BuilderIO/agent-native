import { describe, expect, it } from "vitest";

import { mergeDataDictionaryEntry } from "./data-dictionary-overlays.js";

describe("data dictionary overlays", () => {
  it("preserves generated source-index freshness over stored overlay values", () => {
    const generated = {
      id: "generated-monthly-members",
      sourceIndex: true,
      sourceIndexStale: true,
      sourceIndexAgeDays: 90,
      sourceIndexStaleAfterDays: 30,
      sourceIndexGeneratedAt: "2000-01-01T00:00:00.000Z",
      sqlProjectedColumns: "user_id, organization_id",
      inferredMembershipKeys: ["user_id", "organization_id"],
      inferredMembershipKeyRoles: {
        user: "user_id",
        organization: "organization_id",
      },
    };
    const overlay = {
      id: generated.id,
      approved: true,
      sourceIndexStale: false,
      sourceIndexAgeDays: 0,
      sourceIndexStaleAfterDays: 36_500,
      sqlProjectedColumns: "account_id AS user_id",
      inferredMembershipKeys: ["account_id", "organization_id"],
      inferredMembershipKeyRoles: {
        user: "account_id",
        organization: "organization_id",
      },
    };

    expect(mergeDataDictionaryEntry(generated, overlay)).toMatchObject({
      approved: true,
      sourceIndex: true,
      sourceIndexStale: true,
      sourceIndexAgeDays: 90,
      sourceIndexStaleAfterDays: 30,
      sourceIndexGeneratedAt: "2000-01-01T00:00:00.000Z",
      sqlProjectedColumns: "user_id, organization_id",
      inferredMembershipKeys: ["user_id", "organization_id"],
      inferredMembershipKeyRoles: {
        user: "user_id",
        organization: "organization_id",
      },
    });
  });
});
