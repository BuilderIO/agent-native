import { describe, expect, it } from "vitest";

import {
  contentDocumentIdFromPathname,
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
    "sync-local-folder-source",
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
      "document-1",
    );

    expect(calls).toHaveLength(1);
    const [{ filters, options }] = calls as Array<{
      filters: {
        queryKey: string[];
        type: "active";
        predicate: (query: { queryKey: readonly unknown[] }) => boolean;
      };
      options: { cancelRefetch: false };
    }>;
    expect(filters.queryKey).toEqual(["action", "list-comments"]);
    expect(filters.type).toBe("active");
    expect(options).toEqual({ cancelRefetch: false });
    expect(
      filters.predicate({
        queryKey: ["action", "list-comments", { documentId: "document-1" }],
      }),
    ).toBe(true);
    expect(
      filters.predicate({
        queryKey: ["action", "list-comments", { documentId: "document-2" }],
      }),
    ).toBe(false);
  });

  it("scopes document refreshes to the document open in this browser", () => {
    const calls: unknown[] = [];
    refreshContentActionQueries(
      {
        refetchQueries: (filters, options) => {
          calls.push({ filters, options });
        },
      },
      { source: "action", key: "edit-document", requestSource: "agent" },
      "browser-tab",
      "document-1",
    );

    const [{ filters }] = calls as Array<{
      filters: {
        predicate: (query: { queryKey: readonly unknown[] }) => boolean;
      };
    }>;
    expect(
      filters.predicate({
        queryKey: ["action", "get-document", { id: "document-1" }],
      }),
    ).toBe(true);
    expect(
      filters.predicate({
        queryKey: ["action", "get-document", { id: "document-2" }],
      }),
    ).toBe(false);
  });
});

describe("contentDocumentIdFromPathname", () => {
  it("reads only Content document routes", () => {
    expect(contentDocumentIdFromPathname("/page/document-1")).toBe(
      "document-1",
    );
    expect(contentDocumentIdFromPathname("/page/document%202/")).toBe(
      "document 2",
    );
    expect(contentDocumentIdFromPathname("/settings")).toBeUndefined();
  });
});
