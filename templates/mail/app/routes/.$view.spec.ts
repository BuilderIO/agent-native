import { describe, expect, it } from "vitest";

import { isKnownMailView, loader } from "./$view";

// $view.tsx and $view.$threadId.tsx are dynamic-segment siblings of the
// $.tsx splat 404 route. react-router's route scorer always prefers a
// `:view` dynamic segment over a `*` splat at the same depth, so an
// unmatched single-segment URL (e.g. /this-route-should-not-exist-xyz)
// matches $view.tsx instead of falling through to NotFound. The route can
// only recover 404 behavior by rejecting view values itself.
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

// The splat route only auto-404s when literally no route matched at all;
// since $view.tsx matches every single-segment path, React Router serves a
// bare 200 unless the loader sets the status itself.
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
