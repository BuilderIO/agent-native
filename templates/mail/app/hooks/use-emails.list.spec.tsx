// @vitest-environment happy-dom

import type { EmailMessage } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  clearOptimisticOverride,
  prefetchEmails,
  setOptimisticOverride,
  useEmails,
} from "./use-emails";

function message(id: string, threadId: string, isStarred: boolean) {
  return {
    id,
    threadId,
    from: { name: "Ada", email: "ada@example.com" },
    to: [{ name: "Owner", email: "owner@example.com" }],
    subject: id,
    snippet: "",
    body: "",
    date: "2026-11-20T00:00:00.000Z",
    isRead: true,
    isStarred,
    isArchived: true,
    isTrashed: false,
    labelIds: [],
    accountEmail: "owner@example.com",
  } satisfies EmailMessage;
}

let requests: URL[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://mail.test");
      requests.push(url);
      return new Response(
        JSON.stringify({
          emails: [
            message("older", "t1", true),
            message("latest", "t1", false),
            message("other", "t2", true),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  for (const id of ["older", "latest", "other", "first"]) {
    clearOptimisticOverride(id);
  }
  vi.unstubAllGlobals();
});

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useEmails list reads", () => {
  it("reads a list a tab prefetched without asking again", async () => {
    const qc = new QueryClient();
    await prefetchEmails(qc, "all", "receipt");
    expect(requests).toHaveLength(1);

    const { result } = renderHook(() => useEmails("all", "receipt"), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(requests).toHaveLength(1);
  });

  it("sends the inbox filter apart from the search and drops a thread an unstar takes out of Starred", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useEmails("all", undefined, undefined, {
          inboxFilter: "r=starred:is_checked",
        }),
      { wrapper: wrapperFor(qc) },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(requests[0]?.searchParams.get("inboxFilter")).toBe(
      "r=starred:is_checked",
    );
    expect(requests[0]?.searchParams.has("q")).toBe(false);

    act(() => setOptimisticOverride("latest", { isStarred: false }));
    expect(result.current.data?.map((email) => email.id)).toEqual([
      "older",
      "latest",
      "other",
    ]);

    act(() => setOptimisticOverride("older", { isStarred: false }));
    expect(result.current.data?.map((email) => email.id)).toEqual(["other"]);

    act(() => clearOptimisticOverride("older"));
    expect(result.current.data?.map((email) => email.id)).toEqual([
      "older",
      "latest",
      "other",
    ]);
  });

  it("drops a whole conversation from Starred No once any of its messages is starred", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              emails: [
                message("first", "t3", false),
                message("latest", "t3", false),
                message("other", "t4", false),
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useEmails("all", undefined, undefined, {
          inboxFilter: "r=starred:is_unchecked",
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    act(() => setOptimisticOverride("first", { isStarred: true }));
    expect(result.current.data?.map((email) => email.id)).toEqual(["other"]);
  });
});
