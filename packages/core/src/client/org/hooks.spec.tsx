// @vitest-environment happy-dom

import type { OrgInfo } from "@agent-native/core/org/types";
import {
  IsRestoringProvider,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAgentNativeApiDisabled } from "../api-surface.js";
import { notifySessionInvalidated } from "../use-session.js";
import {
  useOrg,
  useOrgInvitations,
  useOrgMembers,
  useSwitchOrg,
} from "./hooks.js";

vi.mock("../use-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-session.js")>()),
  notifySessionInvalidated: vi.fn(() => Promise.resolve()),
}));

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
    setAgentNativeApiDisabled(null);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    setAgentNativeApiDisabled(null);
    vi.unstubAllGlobals();
  });

  it("normalizes member search into the request and cache key", async () => {
    queryClient.setQueryData(["org-me"], org);
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

  it("does not fetch the active org when the query is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      useOrg({ enabled: false });
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

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch org APIs while the surface is disabled", async () => {
    const fetchMock = vi.fn(async () => Response.json(org));
    vi.stubGlobal("fetch", fetchMock);
    setAgentNativeApiDisabled("builder shell canvas");

    function Probe() {
      useOrg();
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(["org-me"])).toMatchObject({
      error: null,
      fetchFailureCount: 0,
      fetchStatus: "idle",
      status: "pending",
    });
  });

  it("keeps dependent org queries idle when cached org data exists but the API is disabled", async () => {
    queryClient.setQueryData(["org-me"], org);
    const fetchMock = vi.fn(async () => Response.json(org));
    vi.stubGlobal("fetch", fetchMock);
    setAgentNativeApiDisabled("builder shell canvas");

    function Probe() {
      useOrg();
      useOrgMembers();
      useOrgInvitations();
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(["org-me"])).toMatchObject({
      error: null,
      fetchStatus: "idle",
      status: "success",
    });
    expect(
      queryClient.getQueryState(["org-members", "org-1", 0, ""]),
    ).toMatchObject({
      error: null,
      fetchFailureCount: 0,
      fetchStatus: "idle",
      status: "pending",
    });
    expect(
      queryClient.getQueryState(["org-invitations", "org-1"]),
    ).toMatchObject({
      error: null,
      fetchFailureCount: 0,
      fetchStatus: "idle",
      status: "pending",
    });
  });

  it("reads the current API-surface state when a mounted org query reruns", async () => {
    const fetchMock = vi.fn(async () => Response.json(org));
    vi.stubGlobal("fetch", fetchMock);
    setAgentNativeApiDisabled("builder shell canvas");

    function Probe() {
      useOrg();
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
    expect(queryClient.getQueryState(["org-me"])).toMatchObject({
      error: null,
      fetchFailureCount: 0,
      fetchStatus: "idle",
      status: "pending",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    setAgentNativeApiDisabled(null);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-me"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/_agent-native/org/me");
    expect(queryClient.getQueryData(["org-me"])).toEqual(org);
  });

  it("still fetches the active org while the surface is enabled", async () => {
    const fetchMock = vi.fn(async () => Response.json(org));
    vi.stubGlobal("fetch", fetchMock);

    function Probe() {
      useOrg();
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
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/_agent-native/org/me");
  });

  it("refetches org-scoped queries only after the session re-read resolves", async () => {
    let finishSessionRead!: () => void;
    vi.mocked(notifySessionInvalidated).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSessionRead = resolve;
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true })),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    let switchOrg!: (orgId: string) => Promise<unknown>;

    function Probe() {
      switchOrg = useSwitchOrg().mutateAsync;
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    let switching!: Promise<unknown>;
    await act(async () => {
      switching = switchOrg("org-2");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(notifySessionInvalidated).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      finishSessionRead();
      await switching;
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useOrg while the action cache restore holds queries", () => {
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

  it("reports the org as loading, not as absent, until the held query fetches it", async () => {
    const fetchMock = vi.fn(async () => Response.json(org));
    vi.stubGlobal("fetch", fetchMock);
    const seen: Array<{
      isLoading: boolean;
      isInitialLoading: boolean;
      orgId?: string;
    }> = [];

    function Probe() {
      const result = useOrg();
      seen.push({
        isLoading: result.isLoading,
        isInitialLoading: result.isInitialLoading,
        orgId: result.data?.orgId,
      });
      return null;
    }

    const render = (restoring: boolean) =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <IsRestoringProvider value={restoring}>
            <Probe />
          </IsRestoringProvider>
        </QueryClientProvider>,
      );

    await act(async () => render(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen.at(-1)).toEqual({
      isLoading: true,
      isInitialLoading: true,
      orgId: undefined,
    });

    await act(async () => render(false));
    await vi.waitFor(() => expect(seen.at(-1)?.orgId).toBe("org-1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual({
      isLoading: false,
      isInitialLoading: false,
      orgId: "org-1",
    });
  });
});
