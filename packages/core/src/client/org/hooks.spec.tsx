// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgInfo } from "../../org/types.js";
import { useOrgMembers } from "./hooks.js";

const org: OrgInfo = {
  email: "admin@example.test",
  orgId: "org-1",
  orgName: "Example team",
  role: "admin",
  orgs: [],
  pendingInvitations: [],
  domainMatches: [],
  allowedDomain: "example.test",
  workspaceUrl: null,
  requiredAuthProvider: "google",
};

describe("useOrgMembers", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(["org-me"], org);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("normalizes member search into the request and cache key", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        members: [],
        totalCount: 0,
        hasMore: false,
        nextOffset: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      useOrgMembers(25, "  MoRgAn@Example.Test ");
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "/_agent-native/org/members?limit=25&offset=25&search=morgan%40example.test",
    );
    expect(init).toMatchObject({ credentials: "include" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(
      queryClient.getQueryState([
        "org-members",
        "org-1",
        25,
        "morgan@example.test",
      ]),
    ).toBeDefined();
  });
});
