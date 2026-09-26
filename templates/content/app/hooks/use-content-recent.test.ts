// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";

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
  let orgRefetch: ReturnType<typeof vi.fn>;
  const scopeKey = JSON.stringify(["user@example.test", "org-1", "space-1"]);

  function contextChangedError() {
    return Object.assign(new Error("Navigation context changed."), {
      errorCode: "context_changed",
    });
  }

  function Probe() {
    const recent = useContentRecent("space-1");
    const [, rerender] = useState(0);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "output",
        { "data-testid": "recent-state" },
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

  function app() {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(Probe),
    );
  }

  async function flush() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    orgRefetch = vi
      .fn()
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
    hookMocks.org.refetch = orgRefetch;
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

    expect(orgRefetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.textContent).toBe("error");

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(orgRefetch).toHaveBeenCalledTimes(2);
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
    expect(orgRefetch).toHaveBeenCalledTimes(3);
  });
});
