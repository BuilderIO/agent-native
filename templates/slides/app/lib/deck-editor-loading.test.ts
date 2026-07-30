import { describe, expect, it } from "vitest";

import {
  deckAccessCheckKey,
  shouldShowDeckEditorSkeleton,
} from "./deck-editor-loading";

describe("deck editor loading state", () => {
  const accessCheckKey = deckAccessCheckKey("deck-1", "org-1");

  it("keeps the skeleton visible through the org-scoped deck reload", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
      }),
    ).toBe(true);
  });

  it("shows the unavailable state only after the access check settles", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: accessCheckKey,
        retrying: false,
      }),
    ).toBe(false);
  });

  it("returns to the skeleton while a settled error is retried", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: accessCheckKey,
        retrying: true,
      }),
    ).toBe(true);
  });

  it("rechecks the deck when the organization scope changes", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey: deckAccessCheckKey("deck-1", "org-2"),
        checkedAccessKey: accessCheckKey,
        retrying: false,
      }),
    ).toBe(true);
  });

  it("does not cover a loaded deck with a skeleton", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: true,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
      }),
    ).toBe(false);
  });
});
