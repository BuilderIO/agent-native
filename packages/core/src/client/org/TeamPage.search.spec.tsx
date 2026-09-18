// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgInfo } from "../../org/types.js";
import { DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS } from "../sharing/share-controller-helpers.js";

const mocks = vi.hoisted(() => ({
  action: { error: null, isPending: false, mutate: vi.fn() },
  groups: { data: [], isLoading: false },
}));

vi.mock("../use-action.js", () => ({
  useActionMutation: () => mocks.action,
  useActionQuery: () => mocks.groups,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string, options?: { count?: number }) => {
    if (key === "org.memberCount") return `${options?.count ?? 0} members`;
    if (key === "org.searchPeople") return "Search people";
    if (key === "org.noPeopleFound") return "No people found";
    if (key === "agentChat.share.loadPeopleFailed")
      return "Could not load people.";
    if (key === "agentChat.common.retry") return "Retry";
    return key;
  },
}));

import { TeamPage } from "./TeamPage.js";

const org: OrgInfo = {
  email: "admin@example.test",
  orgId: "org-search-test",
  orgName: "Example team",
  role: "admin",
  orgs: [],
  pendingInvitations: [],
  domainMatches: [],
  allowedDomain: "example.test",
  workspaceUrl: null,
  requiredAuthProvider: null,
};

describe("TeamPage member search recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

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
    vi.useRealTimers();
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function waitForUI(assertion: () => void) {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assertion();
    });
  }

  it("shows a failed search and retries the same query to recover its members", async () => {
    let failSearch = true;
    const searchRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          "http://localhost",
        );
        if (url.pathname.endsWith("/invitations")) {
          return Response.json({ invitations: [] });
        }
        if (url.pathname.endsWith("/members")) {
          const isSearch = url.searchParams.has("search");
          if (isSearch) {
            searchRequests.push(url.search);
            if (failSearch) {
              return Response.json(
                { error: "Service unavailable" },
                { status: 503 },
              );
            }
          }
          return Response.json({
            members: [
              {
                email: isSearch ? "morgan@example.test" : "admin@example.test",
                role: isSearch ? "member" : "admin",
                joinedAt: 0,
              },
            ],
            totalCount: 1,
            hasMore: false,
            nextOffset: null,
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TeamPage showTitle={false} />
        </QueryClientProvider>,
      );
    });
    await waitForUI(() => {
      expect(container.textContent).toContain("admin@example.test");
    });

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search people"]',
    );
    expect(search).not.toBeNull();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(search, "  Morgan  ");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitForUI(() => {
      expect(container.textContent).toContain("Could not load people.");
    });
    expect(container.textContent).not.toContain("No people found");
    expect(searchRequests).toEqual(["?limit=25&offset=0&search=morgan"]);

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    failSearch = false;
    await act(async () => retry!.click());

    await waitForUI(() => {
      expect(container.textContent).toContain("morgan@example.test");
      expect(container.textContent).not.toContain("Could not load people.");
    });
    expect(searchRequests).toEqual([
      "?limit=25&offset=0&search=morgan",
      "?limit=25&offset=0&search=morgan",
    ]);
    expect(search!.value).toBe("  Morgan  ");
    expect(container.textContent).not.toContain("No people found");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("starts a new member search from its first page after paging during the debounce", async () => {
    const searchRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          "http://localhost",
        );
        if (url.pathname.endsWith("/invitations")) {
          return Response.json({ invitations: [] });
        }
        if (url.pathname.endsWith("/members")) {
          const search = url.searchParams.get("search");
          const offset = Number(url.searchParams.get("offset"));
          if (search === "morgan") {
            searchRequests.push(url.search);
            return Response.json({
              members: [
                {
                  email:
                    offset === 0
                      ? "morgan-first@example.test"
                      : "morgan-page-two@example.test",
                  role: "member",
                  joinedAt: 0,
                },
              ],
              totalCount: 50,
              hasMore: false,
              nextOffset: null,
            });
          }
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    queryClient.setQueryData(["org-members", org.orgId, 0, ""], {
      members: [
        { email: "page-one@example.test", role: "member", joinedAt: 0 },
      ],
      totalCount: 75,
      hasMore: true,
      nextOffset: 25,
    });
    queryClient.setQueryData(["org-members", org.orgId, 25, ""], {
      members: [
        { email: "page-two@example.test", role: "member", joinedAt: 0 },
      ],
      totalCount: 75,
      hasMore: true,
      nextOffset: 50,
    });
    queryClient.setQueryData(["org-members", org.orgId, 50, ""], {
      members: [
        { email: "page-three@example.test", role: "member", joinedAt: 0 },
      ],
      totalCount: 75,
      hasMore: false,
      nextOffset: null,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TeamPage showTitle={false} />
        </QueryClientProvider>,
      );
    });
    await waitForUI(() => {
      expect(container.textContent).toContain("page-one@example.test");
    });

    const nextPage = container.querySelector<HTMLAnchorElement>(
      '[aria-label="org.nextMemberPage"]',
    );
    expect(nextPage).not.toBeNull();
    act(() => nextPage!.click());
    await waitForUI(() => {
      expect(container.textContent).toContain("page-two@example.test");
    });

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search people"]',
    );
    expect(search).not.toBeNull();
    vi.useFakeTimers();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(search, "Morgan");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => nextPage!.click());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_MEMBER_SEARCH_DEBOUNCE_MS);
    });
    expect(searchRequests).toEqual(["?limit=25&offset=0&search=morgan"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await waitForUI(() => {
      expect(container.textContent).toContain("morgan-first@example.test");
    });
  });
});
