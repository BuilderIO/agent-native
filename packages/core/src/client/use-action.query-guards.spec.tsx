// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import {
  ACTION_BROWSER_PERSIST_ALLOW,
  ACTION_BROWSER_PERSIST_HEADER,
} from "../shared/action-browser-persist.js";
import { trustedActionQueryCacheBindingPendingContext } from "./action-query-cache-context.js";
import { setAgentNativeApiDisabled } from "./api-surface.js";
import {
  getAccessDeniedActionQueryBinding,
  isBrowserPersistableActionQuery,
  registerActionQueryCacheRevoker,
  runActionQueryRead,
  setActionQueryCacheBindingToken,
  useActionQueryCanFetch,
} from "./use-action.js";

const KEY = ["action", "list-rows", { folder: "a" }];

function refused(status: number) {
  return Object.assign(new Error(`refused ${status}`), { status });
}

describe("runActionQueryRead", () => {
  afterEach(() => {
    setActionQueryCacheBindingToken(undefined);
    vi.clearAllMocks();
  });

  async function readOnce(
    queryClient: QueryClient,
    read: (onResponse: (response: Response) => void) => Promise<string>,
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

  function cachedQuery(queryClient: QueryClient) {
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: KEY, exact: true });
    if (!query) throw new Error("the query isn't cached");
    return query;
  }

  it.each([401, 403, 404])(
    "drops the rows a hand-written read showed once a reread is refused with %i",
    async (status) => {
      const queryClient = new QueryClient();
      await readOnce(queryClient, async () => "rows");
      expect(queryClient.getQueryData(KEY)).toBe("rows");

      await readOnce(queryClient, async () => {
        throw refused(status);
      });

      expect(queryClient.getQueryData(KEY)).toBeUndefined();
      expect(queryClient.getQueryState(KEY)?.status).toBe("error");
    },
  );

  it("keeps the rows and the browser's saved results through a failure a retry can fix", async () => {
    const queryClient = new QueryClient();
    const revoke = vi.fn();
    registerActionQueryCacheRevoker(queryClient, revoke);
    await readOnce(queryClient, async () => "rows");

    await readOnce(queryClient, async () => {
      throw refused(503);
    });

    expect(queryClient.getQueryData(KEY)).toBe("rows");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("discards the browser's saved results when a read is refused", async () => {
    const queryClient = new QueryClient();
    const revoke = vi.fn();
    registerActionQueryCacheRevoker(queryClient, revoke);

    await readOnce(queryClient, async () => {
      throw refused(403);
    });

    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("passes on the refusal of a read whose query isn't cached", async () => {
    const queryClient = new QueryClient();
    const revoke = vi.fn();
    registerActionQueryCacheRevoker(queryClient, revoke);
    const refusal = refused(403);

    await expect(
      runActionQueryRead(queryClient, KEY, undefined, async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("leaves everything alone when the refused read was already cancelled", async () => {
    const queryClient = new QueryClient();
    const revoke = vi.fn();
    registerActionQueryCacheRevoker(queryClient, revoke);
    queryClient.setQueryData(KEY, "rows");
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(
      runActionQueryRead(queryClient, KEY, cancelled.signal, async () => {
        throw refused(403);
      }),
    ).rejects.toThrow("refused 403");

    expect(queryClient.getQueryData(KEY)).toBe("rows");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("marks a refused query against the binding it began in until a read succeeds", async () => {
    const queryClient = new QueryClient();
    const binding = {};
    setActionQueryCacheBindingToken(binding);
    await readOnce(queryClient, async () => "rows");

    await readOnce(queryClient, async () => {
      throw refused(403);
    });
    expect(getAccessDeniedActionQueryBinding(cachedQuery(queryClient))).toBe(
      binding,
    );

    // A success that was cancelled before it landed doesn't count.
    const cancelled = new AbortController();
    cancelled.abort();
    await runActionQueryRead(
      queryClient,
      KEY,
      cancelled.signal,
      async () => "late rows",
    );
    expect(getAccessDeniedActionQueryBinding(cachedQuery(queryClient))).toBe(
      binding,
    );

    await readOnce(queryClient, async () => "rows again");
    expect(
      getAccessDeniedActionQueryBinding(cachedQuery(queryClient)),
    ).toBeUndefined();
  });

  it("saves a success in the browser only when the response it passes on allows it", async () => {
    const queryClient = new QueryClient();
    const allowed = new Response(null, {
      headers: {
        [ACTION_BROWSER_PERSIST_HEADER]: ACTION_BROWSER_PERSIST_ALLOW,
      },
    });

    await readOnce(queryClient, async (onResponse) => {
      onResponse(allowed);
      return "rows";
    });
    expect(isBrowserPersistableActionQuery(cachedQuery(queryClient))).toBe(
      true,
    );

    await readOnce(queryClient, async () => {
      throw refused(403);
    });
    expect(isBrowserPersistableActionQuery(cachedQuery(queryClient))).toBe(
      false,
    );

    await readOnce(queryClient, async () => "rows");
    expect(isBrowserPersistableActionQuery(cachedQuery(queryClient))).toBe(
      false,
    );
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
    { bindingPending = false, withKey = true } = {},
  ) {
    let answer: boolean | undefined;
    function Probe() {
      answer = useActionQueryCanFetch(withKey ? KEY : undefined);
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

    queryClient.setQueryData(KEY, "rows");
    expect(await canFetch(queryClient, { bindingPending: true })).toBe(true);
    // A new read, such as a prefetch, still waits.
    expect(
      await canFetch(queryClient, { bindingPending: true, withKey: false }),
    ).toBe(false);
  });

  it("lets a read already under way go on while the binding settles", async () => {
    const queryClient = new QueryClient();
    void queryClient.prefetchQuery({
      queryKey: KEY,
      queryFn: () => new Promise<string>(() => {}),
    });

    expect(await canFetch(queryClient, { bindingPending: true })).toBe(true);
  });

  it("counts only its own query's rows while the binding settles", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData([...KEY, "next page"], "rows");

    expect(await canFetch(queryClient, { bindingPending: true })).toBe(false);
  });

  it("never lets a read start while the app's API is off", async () => {
    setAgentNativeApiDisabled("builder shell canvas");
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, "rows");

    expect(await canFetch(queryClient)).toBe(false);
  });
});
