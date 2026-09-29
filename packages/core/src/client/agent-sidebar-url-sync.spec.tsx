// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { URLSync } from "./agent-sidebar-url-sync.js";

function RouteControls() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() =>
        navigate(
          "/sessions?app=clips&minDurationMs=300000&hasNetworkErrors=true&emailDomain=gmail.com",
        )
      }
    >
      Filter sessions
    </button>
  );
}

describe("URLSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async () => new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("publishes the current filtered route for a closed-sidebar shell and updates it on navigation", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions"]}>
            <URLSync browserTabId="sessions-tab" />
            <RouteControls />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const writes = () =>
      fetchMock.mock.calls.filter(
        ([url, options]) =>
          String(url).endsWith("/__url__:sessions-tab") &&
          options?.method === "PUT",
      );
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({
      pathname: "/sessions",
      searchParams: {},
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(writes()).toHaveLength(2);
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({
      pathname: "/sessions",
      searchParams: {
        app: "clips",
        minDurationMs: "300000",
        hasNetworkErrors: "true",
        emailDomain: "gmail.com",
      },
    });
    queryClient.clear();
  });
});
