import { describe, expect, it } from "vitest";

import { contentActionInvalidatePredicate } from "./content-action-refresh";

describe("Content notification prefs refresh invalidation", () => {
  const query = {
    queryKey: ["action", "get-content-notification-prefs", undefined],
  };

  it("refreshes the preference after another tab or the agent changes it", () => {
    const predicate = contentActionInvalidatePredicate("/settings");
    expect(
      predicate(query, [
        { source: "action", key: "update-content-notification-prefs" },
      ]),
    ).toBe(true);
  });

  it("ignores unrelated mutations", () => {
    const predicate = contentActionInvalidatePredicate("/settings");
    expect(
      predicate(query, [{ source: "action", key: "update-document" }]),
    ).toBe(false);
  });
});
