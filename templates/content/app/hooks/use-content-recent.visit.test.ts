// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  moveCachedRecentVisitToTop,
  useRecordContentVisit,
} from "./use-content-recent";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  onSuccess: undefined as
    | ((result: unknown, target: unknown) => void)
    | undefined,
  scheduled: [] as Array<() => void>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn(),
  useActionMutation: (
    _action: string,
    options: { onSuccess?: (result: unknown, target: unknown) => void },
  ) => {
    mocks.onSuccess = options.onSuccess;
    return { mutate: mocks.mutate };
  },
}));

vi.mock("@agent-native/core/client/use-after-paint", () => ({
  scheduleAfterStartup: (callback: () => void) => {
    mocks.scheduled.push(callback);
    return () => {};
  },
}));

vi.mock("@agent-native/core/client/org", () => ({ useOrg: vi.fn() }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function entry(documentId: string, visitedAt: string, viewId?: string) {
  return {
    target: viewId
      ? { documentId, databaseId: `db-${documentId}`, viewId }
      : { documentId },
    visitedAt,
    title: documentId,
    icon: null,
    viewName: null,
  };
}

describe("moveCachedRecentVisitToTop", () => {
  it("moves a cached entry to the top without asking for a refetch", () => {
    const queryClient = new QueryClient();
    const key = ["action", "get-content-recent", { scopeKey: "s" }];
    queryClient.setQueryData(key, {
      scopeKey: "s",
      entries: [
        entry("a", "2026-10-31T10:00:00.000Z"),
        entry("b", "2026-10-30T10:00:00.000Z"),
      ],
    });

    expect(
      moveCachedRecentVisitToTop(
        queryClient,
        { documentId: "b" },
        "2026-10-31T11:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      (
        queryClient.getQueryData(key) as {
          entries: Array<{ target: { documentId: string }; visitedAt: string }>;
        }
      ).entries.map((e) => [e.target.documentId, e.visitedAt]),
    ).toEqual([
      ["b", "2026-10-31T11:00:00.000Z"],
      ["a", "2026-10-31T10:00:00.000Z"],
    ]);
  });

  it("asks for a refetch when a list lacks the entry or shows another view", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["action", "get-content-recent", { scopeKey: "s" }],
      {
        scopeKey: "s",
        entries: [entry("a", "2026-10-31T10:00:00.000Z", "view-1")],
      },
    );

    expect(
      moveCachedRecentVisitToTop(
        queryClient,
        { documentId: "a", databaseId: "db-a", viewId: "view-2" },
        "2026-10-31T11:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      moveCachedRecentVisitToTop(
        queryClient,
        { documentId: "new" },
        "2026-10-31T11:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("useRecordContentVisit", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutate.mockReset();
    mocks.scheduled.length = 0;
    container = document.createElement("div");
    root = createRoot(container);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function Visit({ documentId }: { documentId: string | null }) {
    useRecordContentVisit(documentId ? { documentId } : null, true);
    return null;
  }

  function render(documentId: string | null) {
    act(() =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Visit, { documentId }),
        ),
      ),
    );
  }

  it("records the visit once the load settles, even after the page closes", () => {
    render("a");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.scheduled).toHaveLength(1);

    render(null);
    const settle = mocks.scheduled[0];
    if (!settle) throw new Error("the visit wasn't scheduled");
    settle();
    expect(mocks.mutate).toHaveBeenCalledWith({ documentId: "a" });
  });

  it("refetches Recent only when the visited page isn't in it", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(
      ["action", "get-content-recent", { scopeKey: "s" }],
      {
        scopeKey: "s",
        entries: [entry("a", "2026-10-31T10:00:00.000Z")],
      },
    );
    render("a");

    mocks.onSuccess?.({ recorded: true }, { documentId: "a" });
    expect(invalidate).not.toHaveBeenCalled();
    mocks.onSuccess?.({ recorded: true }, { documentId: "b" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "get-content-recent"],
    });
  });
});
