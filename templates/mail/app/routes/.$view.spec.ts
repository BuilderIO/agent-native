import { describe, expect, it } from "vitest";

import { isKnownMailView, loader } from "./$view";

describe("isKnownMailView", () => {
  it("accepts every system view the app links to", () => {
    for (const view of [
      "inbox",
      "unread",
      "starred",
      "snoozed",
      "scheduled",
      "sent",
      "drafts",
      "archive",
      "trash",
      "all",
    ]) {
      expect(isKnownMailView(view)).toBe(true);
    }
  });

  it("rejects an unmatched path segment so the route can fall through to 404", () => {
    expect(isKnownMailView("this-route-should-not-exist-xyz")).toBe(false);
  });
});

describe("$view loader", () => {
  it("responds 404 for an unmatched view", () => {
    const result = loader({
      params: { view: "this-route-should-not-exist-xyz" },
    });
    expect(result).toMatchObject({ init: { status: 404 } });
  });

  it("does not set a 404 status for a known view", () => {
    const result = loader({ params: { view: "inbox" } });
    expect(result).toBeNull();
  });
});
