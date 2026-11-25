// @vitest-environment happy-dom
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useDbSync } from "./use-db-sync.js";

it("refreshes an active action query without opening realtime when explicitly requested", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let cards = 3;
  const read = vi.fn(async () => cards);
  function Screen() {
    useDbSync({ queryClient: client, realtime: false });
    useDbSync({ queryClient: client, realtime: false });
    const query = useQuery({
      queryKey: ["action", "get-deck", "owned"],
      queryFn: read,
    });
    return <span>{query.data}</span>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toBe("3"));
    cards = 4;
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    });
    await vi.waitFor(() => expect(container.textContent).toBe("4"));
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.unstubAllGlobals();
  }
});
