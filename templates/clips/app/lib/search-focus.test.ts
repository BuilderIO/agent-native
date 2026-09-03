import { describe, expect, it } from "vitest";

import {
  clearSearchFocusRequest,
  hasSearchFocusRequest,
  SEARCH_FOCUS_PARAM,
  SEARCH_FOCUS_VALUE,
} from "./search-focus";

describe("recordings search focus requests", () => {
  it("recognizes the command-menu handoff without treating other queries as focus requests", () => {
    expect(
      hasSearchFocusRequest(
        new URLSearchParams({
          [SEARCH_FOCUS_PARAM]: SEARCH_FOCUS_VALUE,
        }),
      ),
    ).toBe(true);
    expect(hasSearchFocusRequest(new URLSearchParams({ q: "pricing" }))).toBe(
      false,
    );
  });

  it("clears only the focus marker and preserves the rest of the route state", () => {
    const next = clearSearchFocusRequest(
      new URLSearchParams({
        [SEARCH_FOCUS_PARAM]: SEARCH_FOCUS_VALUE,
        folder: "folder-1",
      }),
    );

    expect(next.toString()).toBe("folder=folder-1");
  });
});
