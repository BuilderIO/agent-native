// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contentRecentQueryArgs,
  isContentRecentContextChanged,
  useContentRecent,
} from "./use-content-recent";

const hookMocks = vi.hoisted(() => ({
  org: {
    data: null as { email: string; orgId: string | null } | null,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  query: {
    data: undefined as { scopeKey: string; entries: unknown[] } | undefined,
    error: null as unknown,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: vi.fn(),
  useActionQuery: () => hookMocks.query,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => hookMocks.org,
}));

describe("contentRecentQueryArgs", () => {
  it("never serializes an empty optional space ID", () => {
    expect(contentRecentQueryArgs(undefined, undefined)).toBeUndefined();
    expect(contentRecentQueryArgs("scope", undefined)).toEqual({
      scopeKey: "scope",
    });
    expect(contentRecentQueryArgs("scope", "")).toEqual({ scopeKey: "scope" });
    expect(contentRecentQueryArgs("scope", "space-1")).toEqual({
      scopeKey: "scope",
      spaceId: "space-1",
    });
  });
});

describe("isContentRecentContextChanged", () => {
  it("recognizes only the server's stale-navigation-scope response", () => {
    expect(
      isContentRecentContextChanged(
        Object.assign(new Error("Navigation context changed."), {
          errorCode: "context_changed",
        }),
      ),
    ).toBe(true);
    expect(
      isContentRecentContextChanged(
        Object.assign(new Error(), { status: 409 }),
      ),
    ).toBe(false);
    expect(isContentRecentContextChanged(new Error("failed"))).toBe(false);
  });
});

describe("useContentRecent context recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let activeSpaceId: string;
  const scopeKey = JSON.stringify(["user@example.test", "org-1", "space-1"]);

  function contextChangedError() {
    return Object.assign(new Error("Navigation context changed."), {
      errorCode: "context_changed",
    });
  }

  function Probe({ spaceId }: { spaceId: string }) {
    const recent = useContentRecent(spaceId);
    const [, rerender] = useState(0);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "output",
        { "data-testid": "recent-state", "data-space-id": spaceId },
        recent.isError
          ? "error"
          : recent.isLoading
            ? "loading"
            : recent.data?.entries.length === 0
              ? "empty"
              : "loaded",
      ),
      React.createElement(
        "button",
        {
          onClick: async () => {
            await recent.refetch();
            rerender((value) => value + 1);
          },
        },
        "Retry",
      ),
    );
  }

  function app(spaces = [activeSpaceId]) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        React.Fragment,
        null,
        ...spaces.map((spaceId, index) =>
          React.createElement(Probe, { key: index, spaceId }),
        ),
      ),
    );
  }

  async function flush() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    activeSpaceId = "space-1";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    hookMocks.org.refetch
      .mockReset()
      .mockResolvedValueOnce({ isError: true })
      .mockResolvedValueOnce({ isError: false })
      .mockResolvedValueOnce({ isError: false });
    hookMocks.org.data = {
      email: "user@example.test",
      orgId: "org-1",
    };
    hookMocks.org.isLoading = false;
    hookMocks.org.isFetching = false;
    hookMocks.org.isError = false;
    hookMocks.query.data = undefined;
    hookMocks.query.error = contextChangedError();
    hookMocks.query.isError = true;
    hookMocks.query.isLoading = false;
    hookMocks.query.isFetching = false;
    hookMocks.query.refetch = vi.fn(async () => {
      hookMocks.query.error = contextChangedError();
      hookMocks.query.isError = true;
      return { isError: true };
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allows Retry after org refresh fails and clears the guard after ordinary errors", async () => {
    await act(async () => {
      root.render(app());
      await flush();
    });

    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("error");

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "action",
        "get-content-recent",
        { scopeKey, spaceId: "space-1" },
      ],
      exact: true,
    });

    hookMocks.query.data = { scopeKey, entries: [] };
    hookMocks.query.error = null;
    hookMocks.query.isError = false;
    await act(async () => {
      root.render(app());
      await flush();
    });
    expect(container.querySelector("output")?.textContent).toBe("empty");

    hookMocks.query.data = undefined;
    hookMocks.query.error = new Error("Temporary query failure");
    hookMocks.query.isError = true;
    await act(async () => {
      root.render(app());
      await flush();
    });

    hookMocks.query.error = contextChangedError();
    await act(async () => {
      root.render(app());
      await flush();
    });
    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(3);
  });

  it("keeps an in-flight recovery guard when another scope has an ordinary error", async () => {
    let finishRefresh!: (result: { isError: boolean }) => void;
    const pendingRefresh = new Promise<{ isError: boolean }>((resolve) => {
      finishRefresh = resolve;
    });
    hookMocks.org.refetch.mockReset().mockImplementation(() => pendingRefresh);

    await act(async () => {
      root.render(app());
      await flush();
    });
    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(1);

    activeSpaceId = "space-2";
    hookMocks.query.error = new Error("Other scope failed");
    await act(async () => {
      root.render(app());
      await flush();
    });

    activeSpaceId = "space-1";
    hookMocks.query.error = contextChangedError();
    await act(async () => {
      root.render(app());
      await flush();
    });
    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRefresh({ isError: true });
      await flush();
    });
    expect(container.querySelector("output")?.textContent).toBe("error");
  });

  it("keeps overlapping scopes loading while shared org refresh is in flight", async () => {
    let finishRefresh!: (result: { isError: boolean }) => void;
    const pendingRefresh = new Promise<{ isError: boolean }>((resolve) => {
      finishRefresh = resolve;
    });
    hookMocks.org.refetch.mockReset().mockImplementation(() => pendingRefresh);

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      root.render(app(["space-1", "space-2"]));
      await flush();
    });

    expect(hookMocks.org.refetch).toHaveBeenCalledTimes(2);
    expect(hookMocks.org.refetch).toHaveBeenNthCalledWith(1, {
      cancelRefetch: false,
    });
    expect(hookMocks.org.refetch).toHaveBeenNthCalledWith(2, {
      cancelRefetch: false,
    });
    expect(
      Array.from(container.querySelectorAll("output")).map(
        (output) => output.textContent,
      ),
    ).toEqual(["loading", "loading"]);

    await act(async () => {
      finishRefresh({ isError: false });
      await flush();
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
