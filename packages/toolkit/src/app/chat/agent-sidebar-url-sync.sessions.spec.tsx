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

describe("URLSync Sessions context", () => {
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

  it("scrubs the hash it publishes but leaves the query filters the agent reads", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={[
              "/sessions?range=7d#access_token=canary-secret&state=canary-secret",
            ]}
          >
            <URLSync browserTabId="sessions-tab" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const [, options] = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/__url__:sessions-tab") && init?.method === "PUT",
    )!;
    expect(JSON.parse(options.body)).toMatchObject({
      pathname: "/sessions",
      search: "?range=7d",
      hash: "#access_token=%3Credacted%3E&state=%3Credacted%3E",
      searchParams: { range: "7d" },
    });
    expect(options.body).not.toContain("canary-secret");
    queryClient.clear();
  });
});
