import { describe, expect, it } from "vitest";

import { shouldInvalidateMailQueryForActionEvent } from "./sync-invalidation";

describe("shouldInvalidateMailQueryForActionEvent", () => {
  it("refreshes action-backed reads such as the queued draft list", () => {
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: ["action", "list-queued-drafts", {}],
      }),
    ).toBe(true);
  });

  it("does not broadly refresh Gmail or provider reads", () => {
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: ["emails", "inbox"],
      }),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: ["integration-data", "apollo", "person@example.com"],
      }),
    ).toBe(false);
  });
});
