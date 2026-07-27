// @vitest-environment happy-dom

import type { DocumentSyncStatus } from "@shared/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAllAutoSyncToggles,
  currentRedirectTarget,
  documentSyncRefetchIntervalMs,
  invalidateDocumentQueries,
  openNotionOAuthUrl,
} from "./use-notion";

function status(
  overrides: Partial<DocumentSyncStatus> = {},
): DocumentSyncStatus {
  return {
    provider: "notion",
    connected: true,
    documentId: "doc-1",
    pageId: "page-1",
    pageUrl: "https://notion.so/page-1",
    state: "linked",
    lastSyncedAt: null,
    lastKnownRemoteUpdatedAt: null,
    lastPushedLocalUpdatedAt: null,
    hasConflict: false,
    remoteChanged: false,
    localChanged: false,
    lastError: null,
    warnings: [],
    ...overrides,
  };
}

describe("documentSyncRefetchIntervalMs", () => {
  it("polls every 2s when linked, connected, and auto-sync is on", () => {
    expect(documentSyncRefetchIntervalMs(status(), true)).toBe(2_000);
  });

  it("polls every 30s when linked and connected but auto-sync is off", () => {
    expect(documentSyncRefetchIntervalMs(status(), false)).toBe(30_000);
  });

  it("backs off to a slow heartbeat when the document has no linked page", () => {
    expect(documentSyncRefetchIntervalMs(status({ pageId: null }), true)).toBe(
      60_000,
    );
  });

  it("backs off to a slow heartbeat when the workspace is disconnected", () => {
    expect(
      documentSyncRefetchIntervalMs(status({ connected: false }), true),
    ).toBe(60_000);
  });

  it("falls back to the normal cadence before any data has loaded", () => {
    // No response yet (first mount) — keep the requested cadence instead of
    // guessing "unlinked", otherwise a freshly linked doc would wait a full
    // heartbeat cycle before its first fast poll.
    expect(documentSyncRefetchIntervalMs(undefined, true)).toBe(2_000);
    expect(documentSyncRefetchIntervalMs(undefined, false)).toBe(30_000);
  });
});

describe("invalidateDocumentQueries", () => {
  it("only invalidates the affected document/list/sync-status keys, never the bare action cache", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as Parameters<
      typeof invalidateDocumentQueries
    >[0];

    invalidateDocumentQueries(queryClient, "doc-1");

    const calledKeys = invalidateQueries.mock.calls.map(
      (call) => call[0]?.queryKey,
    );

    // Must never invalidate the app-wide ["action"] key — that would refetch
    // every mounted query (sidebar tree, comments, database views, search,
    // connect-notion-status, ...) on every sync cycle.
    expect(
      calledKeys.some(
        (key) => Array.isArray(key) && key.length === 1 && key[0] === "action",
      ),
    ).toBe(false);

    expect(calledKeys).toContainEqual([
      "action",
      "get-document",
      { id: "doc-1" },
    ]);
    expect(calledKeys).toContainEqual(["action", "list-documents"]);
  });
});

describe("clearAllAutoSyncToggles", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("removes every per-document auto-sync toggle but leaves unrelated keys alone", () => {
    window.localStorage.setItem("notion-auto-sync:doc-1", "true");
    window.localStorage.setItem("notion-auto-sync:doc-2", "true");
    window.localStorage.setItem("some-other-setting", "keep-me");

    clearAllAutoSyncToggles();

    expect(window.localStorage.getItem("notion-auto-sync:doc-1")).toBeNull();
    expect(window.localStorage.getItem("notion-auto-sync:doc-2")).toBeNull();
    expect(window.localStorage.getItem("some-other-setting")).toBe("keep-me");
  });
});

describe("currentRedirectTarget", () => {
  it("returns the current path plus query string", () => {
    window.history.pushState({}, "", "/page/abc123?tab=comments");
    expect(currentRedirectTarget()).toBe("/page/abc123?tab=comments");
  });

  it("falls back to / at the root with no query string", () => {
    window.history.pushState({}, "", "/");
    expect(currentRedirectTarget()).toBe("/");
  });
});

describe("openNotionOAuthUrl / fetchNotionAuthUrl redirect param", () => {
  const originalFetch = window.fetch;

  afterEach(() => {
    window.fetch = originalFetch;
    window.history.pushState({}, "", "/");
  });

  it("sends the current location as the redirect query param", async () => {
    window.history.pushState({}, "", "/page/doc-42?panel=notion");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://api.notion.com/v1/oauth/authorize?x=1",
      }),
    });
    window.fetch = fetchMock as unknown as typeof fetch;

    const url = await openNotionOAuthUrl();

    expect(url).toBe("https://api.notion.com/v1/oauth/authorize?x=1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("/api/notion/auth-url");
    expect(requestedUrl).toContain(
      `redirect=${encodeURIComponent("/page/doc-42?panel=notion")}`,
    );
  });

  it("falls back to / when the app is at the root", async () => {
    window.history.pushState({}, "", "/");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://api.notion.com/v1/oauth/authorize" }),
    });
    window.fetch = fetchMock as unknown as typeof fetch;

    await openNotionOAuthUrl();

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain(`redirect=${encodeURIComponent("/")}`);
  });
});
