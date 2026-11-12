// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import { trustedActionQueryCacheBindingPendingContext } from "./action-query-cache-context.js";
import { setAgentNativeApiDisabled } from "./api-surface.js";
import { runActionQueryRead, useActionQueryCanFetch } from "./use-action.js";

const KEY = ["action", "list-rows", { folder: "a" }];

function refused(status: number) {
  return Object.assign(new Error(`refused ${status}`), { status });
}

describe("runActionQueryRead", () => {
  afterEach(() => vi.clearAllMocks());

  async function readOnce(
    queryClient: QueryClient,
    read: () => Promise<string>,
  ) {
    await queryClient
      .fetchQuery({
        queryKey: KEY,
        queryFn: ({ signal }) =>
          runActionQueryRead(queryClient, KEY, signal, read),
        retry: false,
        staleTime: 0,
      })
      .catch(() => undefined);
  }

  it("drops the rows a hand-written read showed once a reread is refused", async () => {
    const queryClient = new QueryClient();
    await readOnce(queryClient, async () => "rows");
    expect(queryClient.getQueryData(KEY)).toBe("rows");

    await readOnce(queryClient, async () => {
      throw refused(403);
    });

    expect(queryClient.getQueryData(KEY)).toBeUndefined();
    expect(queryClient.getQueryState(KEY)?.status).toBe("error");
  });

  it("keeps the rows through a failure a retry can fix", async () => {
    const queryClient = new QueryClient();
    await readOnce(queryClient, async () => "rows");

    await readOnce(queryClient, async () => {
      throw refused(503);
    });

    expect(queryClient.getQueryData(KEY)).toBe("rows");
  });
});

describe("useActionQueryCanFetch", () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    roots.length = 0;
    document.body.replaceChildren();
    setAgentNativeApiDisabled(null);
    vi.unstubAllGlobals();
  });

  async function canFetch(
    queryClient: QueryClient,
    {
      bindingPending = false,
      key = KEY as readonly unknown[] | undefined,
    } = {},
  ) {
    let answer: boolean | undefined;
    function Probe() {
      answer = useActionQueryCanFetch(key);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <trustedActionQueryCacheBindingPendingContext.Provider
            value={bindingPending}
          >
            <Probe />
          </trustedActionQueryCacheBindingPendingContext.Provider>
        </QueryClientProvider>,
      ),
    );
    return answer;
  }

  it("lets a read start once the browser's saved results are bound", async () => {
    expect(await canFetch(new QueryClient())).toBe(true);
  });

  it("holds a read with nothing to show until the binding settles", async () => {
    const queryClient = new QueryClient();
    expect(await canFetch(queryClient, { bindingPending: true })).toBe(false);
    expect(
      await canFetch(queryClient, { bindingPending: true, key: undefined }),
    ).toBe(false);

    queryClient.setQueryData(KEY, "rows");
    expect(await canFetch(queryClient, { bindingPending: true })).toBe(true);
  });

  it("never lets a read start while the app's API is off", async () => {
    setAgentNativeApiDisabled("builder shell canvas");
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, "rows");

    expect(await canFetch(queryClient)).toBe(false);
  });
});
