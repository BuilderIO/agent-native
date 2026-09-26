import { describe, expect, it } from "vitest";

import {
  deckAccessCheckFor,
  deckAccessCheckKey,
  deckAccessRequestStateFor,
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
        accessCheck: "allowed",
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
        accessCheck: "allowed",
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
        accessCheck: "allowed",
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
        accessCheck: "allowed",
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
        accessCheck: "allowed",
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
        accessCheck: "denied",
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
        accessCheck: deckAccessCheckFor({
          data: accessStatus,
          isError: false,
          isLoading: false,
        }),
      }),
    ).toBe(false);
  });

  it("stops the skeleton when the access probe fails", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: true,
        orgLoading: true,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
        accessCheck: "failed",
      }),
    ).toBe(false);
  });

  it("shows not-found without waiting on the protected deck list", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: true,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: null,
        retrying: false,
        accessCheck: "missing",
      }),
    ).toBe(false);
  });

  it("keeps the skeleton while the access probe is loading", () => {
    expect(
      shouldShowDeckEditorSkeleton({
        deckFound: false,
        decksLoading: false,
        orgLoading: false,
        accessCheckKey,
        checkedAccessKey: accessCheckKey,
        retrying: false,
        accessCheck: "loading",
      }),
    ).toBe(true);
  });

  it("classifies access probe results", () => {
    const probe = (data: { exists: boolean; hasAccess: boolean } | null) =>
      deckAccessCheckFor({ data, isError: false, isLoading: false });

    expect(probe({ exists: true, hasAccess: false })).toBe("denied");
    expect(probe({ exists: true, hasAccess: true })).toBe("allowed");
    expect(probe({ exists: false, hasAccess: false })).toBe("missing");
    expect(probe(null)).toBe("failed");
    expect(
      deckAccessCheckFor({ data: null, isError: false, isLoading: true }),
    ).toBe("loading");
    expect(
      deckAccessCheckFor({ data: null, isError: true, isLoading: false }),
    ).toBe("failed");
  });

  it("derives the access request state from this page or the record", () => {
    const idle = { isPending: false, isError: false };

    expect(deckAccessRequestStateFor(idle, null)).toEqual({ status: "idle" });
    expect(
      deckAccessRequestStateFor({ ...idle, isPending: true }, null),
    ).toEqual({ status: "pending" });
    expect(deckAccessRequestStateFor({ ...idle, isError: true }, null)).toEqual(
      { status: "failed" },
    );
    expect(
      deckAccessRequestStateFor(
        { ...idle, data: { notifiedOwner: false } },
        { notifiedOwner: true },
      ),
    ).toEqual({ status: "sent", ownerNotified: false });
    expect(deckAccessRequestStateFor(idle, { notifiedOwner: true })).toEqual({
      status: "sent",
      ownerNotified: true,
    });
  });
});
