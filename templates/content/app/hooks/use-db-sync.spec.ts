import { describe, expect, it } from "vitest";

import {
  contentActionRefreshPrefixes,
  refreshContentActionQueries,
} from "./content-action-refresh";

describe("contentActionRefreshPrefixes", () => {
  it.each([
    "add-comment",
    "delete-comment",
    "sync-notion-comments",
    "update-comment",
  ])("refreshes comments after external %s", (key) => {
    expect(
      contentActionRefreshPrefixes(
        { source: "action", key, requestSource: "agent" },
        "browser-tab",
      ),
    ).toEqual([["action", "list-comments"]]);
  });

  it.each([
    "create-and-link-notion-page",
    "delete-document",
    "delete-document-property",
    "edit-document",
    "migrate-content-database-rows",
    "mutate-content-database-block",
    "pull-notion-page",
    "push-notion-page",
    "resolve-notion-sync-conflict",
    "restore-document",
    "restore-document-version",
    "set-document-property",
    "set-image-alt-text",
    "transcribe-media",
    "update-document",
  ])("refreshes the open document after external %s", (key) => {
    expect(
      contentActionRefreshPrefixes(
        { source: "action", key, requestSource: "agent" },
        "browser-tab",
      ),
    ).toEqual([["action", "get-document"]]);
  });

  it("does not duplicate the originating tab's optimistic refresh", () => {
    expect(
      contentActionRefreshPrefixes(
        {
          source: "action",
          key: "update-comment",
          requestSource: "browser-tab",
        },
        "browser-tab",
      ),
    ).toEqual([]);
  });

  it("ignores unrelated sync events", () => {
    expect(
      contentActionRefreshPrefixes(
        { source: "app-state", key: "update-comment" },
        "browser-tab",
      ),
    ).toEqual([]);
    expect(
      contentActionRefreshPrefixes(
        { source: "action", key: "list-comments" },
        "browser-tab",
      ),
    ).toEqual([]);
  });

  it("forces an active refetch at the Content cache boundary", () => {
    const calls: unknown[] = [];
    refreshContentActionQueries(
      {
        refetchQueries: (filters, options) => {
          calls.push({ filters, options });
        },
      },
      { source: "action", key: "update-comment", requestSource: "agent" },
      "browser-tab",
    );

    expect(calls).toEqual([
      {
        filters: {
          queryKey: ["action", "list-comments"],
          type: "active",
        },
        options: { cancelRefetch: false },
      },
    ]);
  });
});
