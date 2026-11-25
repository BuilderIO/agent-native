import type { LoaderFunctionArgs } from "react-router";
import { describe, expect, it } from "vitest";

import { isKnownMailView, loader } from "./$view";

function runLoader(view: string, search = "") {
  return loader({
    params: { view },
    request: new Request(`http://localhost/${view}${search}`),
    context: {},
  } as LoaderFunctionArgs);
}

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
    const result = runLoader("this-route-should-not-exist-xyz");
    expect(result).toMatchObject({ init: { status: 404 } });
  });

  it("does not set a 404 status for a known view", () => {
    const result = runLoader("inbox");
    expect(result).toBeNull();
  });

  it("sends Scheduled to Drafts, where scheduled emails now live", () => {
    const result = runLoader("scheduled", "?accountEmail=a%40example.com");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe(
      "/drafts?accountEmail=a%40example.com",
    );
  });
});
