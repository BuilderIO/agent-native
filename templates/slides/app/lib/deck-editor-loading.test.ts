import { describe, expect, it } from "vitest";

import {
  deckAccessCheckKey,
  retryMissingDeck,
  shouldShowDeckEditorSkeleton,
} from "./deck-editor-loading";

describe("deck editor loading state", () => {
  const accessCheckKey = deckAccessCheckKey("deck-1", "org-1");

  it("refreshes access status after organization and deck reloads on retry", async () => {
    const calls: string[] = [];

    await retryMissingDeck({
      refetchOrg: async () => {
        calls.push("org");
      },
      reloadDecks: async () => {
        calls.push("decks");
      },
      refetchAccessStatus: async () => {
        calls.push("access-status");
      },
    });

    expect(calls).toEqual(["org", "decks", "access-status"]);
  });

  it("keeps the skeleton visible through the org-scoped deck reload", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
        deckAccessDeniedConfirmed: false,
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
        deckAccessDeniedConfirmed: false,
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
        deckAccessDeniedConfirmed: false,
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
        deckAccessDeniedConfirmed: false,
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
        deckAccessDeniedConfirmed: false,
      }),
    ).toBe(false);
  });

  it("shows the access pane before the protected deck list settles", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: true,
        orgLoading: true,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
        deckAccessDeniedConfirmed: true,
      }),
    ).toBe(false);
  });

  it("shows an organization deck denial before the list request settles", () => {
    const accessStatus = {
      exists: true,
      hasAccess: false,
      visibility: "org",
    };

    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: true,
        orgLoading: true,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
        deckAccessDeniedConfirmed:
          accessStatus.exists && !accessStatus.hasAccess,
      }),
    ).toBe(false);
  });
});
