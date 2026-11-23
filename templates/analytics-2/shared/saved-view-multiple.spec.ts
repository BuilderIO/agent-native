import { describe, expect, it } from "vitest";

import { savedViewStateSchema } from "./saved-view-contract";
describe("saved creator selections", () => {
  it("round-trips multiple creators without replacing legacy single selections", () => {
    const filters = {
      creator: ["current-user", "other@example.test"],
      status: "Published",
    };
    const state = savedViewStateSchema.parse({ filters });
    expect(
      savedViewStateSchema.parse(JSON.parse(JSON.stringify(state))).filters,
    ).toEqual(filters);
    expect(
      savedViewStateSchema.parse({ filters: { creator: "current-user" } })
        .filters.creator,
    ).toBe("current-user");
  });
});
