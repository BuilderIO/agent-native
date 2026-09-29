// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act, createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { callActionWithRetry, mutateSyncAction, useActionMutation } = vi.hoisted(
  () => ({
    callActionWithRetry: vi.fn(),
    mutateSyncAction: vi.fn(),
    useActionMutation: vi.fn(() => ({ mutateAsync: mutateSyncAction })),
  }),
);

vi.mock("@agent-native/core/client/hooks", () => ({
  callActionWithRetry,
  useActionMutation,
}));

import type {
  InboxThreadItem,
  ListInboxThreadsInput,
  ListInboxThreadsResult,
} from "@shared/inbox-threads";

import {
  inboxSyncRefetchInterval,
  inboxSyncQueryKey,
  useInboxSyncPoller,
  useInboxThreads,
} from "./use-inbox-threads";

afterEach(() => {
  cleanup();
  callActionWithRetry.mockReset();
  mutateSyncAction.mockReset();
  useActionMutation.mockClear();
});

function thread(id: string, threadId: string): InboxThreadItem {
  return {
    id,
    threadId,
    messageIds: [id],
    messageCount: 1,
    unreadCount: 0,
    isAutomated: false,
    isRead: true,
    isStarred: false,
  } as InboxThreadItem;
}

function response(): ListInboxThreadsResult {
  const important = thread("important-message", "important-thread");
  const other = thread("other-message", "other-thread");

  return {
    tabs: [
      {
        id: "important",
        kind: "important",
        name: "Important",
        total: 1,
        unread: 0,
      },
      { id: "other", kind: "other", name: "Other", total: 1, unread: 0 },
    ],
    activeTabId: "important",
    items: [important],
    tabPreviews: { important: [important], other: [other] },
    total: 1,
    complete: true,
    syncing: false,
    accounts: [],
    labels: [],
  };
}

describe("useInboxThreads tab previews", () => {
  it("seeds account-scoped tab pages so switching to a cached tab makes no action request", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    callActionWithRetry.mockResolvedValue(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const accountEmails = ["first@example.com", "second@example.com"];
    const activeInput: ListInboxThreadsInput = {
      tab: "important",
      accountEmails,
      limit: 50,
      offset: 0,
    };
    const otherInput = { ...activeInput, tab: "other" };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(
      ({ input }: { input: ListInboxThreadsInput }) => useInboxThreads(input),
      { initialProps: { input: activeInput }, wrapper },
    );

    await waitFor(() =>
      expect(hook.result.current.data?.items[0]?.id).toBe("important-message"),
    );
    expect(callActionWithRetry).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(["action", "list-inbox-threads", otherInput]),
    ).toMatchObject({
      activeTabId: "other",
      items: [{ id: "other-message" }],
      total: 1,
    });

    clock.mockReturnValue(60_000);
    act(() => hook.rerender({ input: otherInput }));

    expect(hook.result.current.data?.items[0]?.id).toBe("other-message");
    expect(callActionWithRetry).toHaveBeenCalledTimes(1);
    hook.unmount();
    queryClient.clear();
    clock.mockRestore();
  });

  it("does not seed other tabs from an unread-only result", async () => {
    callActionWithRetry.mockResolvedValue(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const input: ListInboxThreadsInput = {
      tab: "important",
      unreadOnly: true,
      limit: 50,
      offset: 0,
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useInboxThreads(input), { wrapper });

    await waitFor(() => expect(hook.result.current.data).toBeDefined());

    expect(
      queryClient.getQueryData([
        "action",
        "list-inbox-threads",
        { ...input, tab: "other" },
      ]),
    ).toBeUndefined();
    hook.unmount();
    queryClient.clear();
  });

  it("does not show the prior tab while an uncached tab is loading", async () => {
    let resolveOtherTab!: (data: ListInboxThreadsResult) => void;
    callActionWithRetry
      .mockResolvedValueOnce({ ...response(), tabPreviews: {} })
      .mockImplementationOnce(
        () =>
          new Promise<ListInboxThreadsResult>((resolve) => {
            resolveOtherTab = resolve;
          }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const activeInput: ListInboxThreadsInput = {
      tab: "important",
      limit: 50,
      offset: 0,
    };
    const otherInput = { ...activeInput, tab: "other" };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(
      ({ input }: { input: ListInboxThreadsInput }) => useInboxThreads(input),
      { initialProps: { input: activeInput }, wrapper },
    );

    await waitFor(() => expect(hook.result.current.data).toBeDefined());
    act(() => hook.rerender({ input: otherInput }));
    await waitFor(() => expect(callActionWithRetry).toHaveBeenCalledTimes(2));
    expect(hook.result.current.data).toBeUndefined();

    await act(async () => {
      resolveOtherTab({
        ...response(),
        activeTabId: "other",
        items: [thread("other-message", "other-thread")],
      });
    });
    await waitFor(() =>
      expect(hook.result.current.data?.items[0]?.id).toBe("other-message"),
    );
    hook.unmount();
    queryClient.clear();
  });

  it("refreshes the active list before continuing after a changed sync step", async () => {
    const requestOrder: string[] = [];
    callActionWithRetry.mockImplementation(async () => {
      requestOrder.push("list");
      return response();
    });
    mutateSyncAction.mockImplementationOnce(async () => {
      requestOrder.push("sync");
      return {
        accounts: [
          {
            accountEmail: "first@example.com",
            state: "initial",
            lastSyncedAt: null,
            changed: true,
            pushGeneration: 4,
            lastPushGeneration: 3,
            pushPending: true,
          },
        ],
      };
    });
    mutateSyncAction.mockImplementationOnce(async () => {
      requestOrder.push("sync");
      return {
        accounts: [
          {
            accountEmail: "first@example.com",
            state: "ready",
            lastSyncedAt: Date.now(),
            changed: false,
            pushGeneration: 4,
            lastPushGeneration: 4,
            pushPending: false,
          },
        ],
      };
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const input: ListInboxThreadsInput = {
      tab: "important",
      accountEmails: ["first@example.com"],
      limit: 50,
      offset: 0,
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const listHook = renderHook(() => useInboxThreads(input), { wrapper });

    await waitFor(() => expect(listHook.result.current.data).toBeDefined());
    const syncHook = renderHook(() => useInboxSyncPoller(input.accountEmails), {
      wrapper,
    });

    await waitFor(() => expect(mutateSyncAction).toHaveBeenCalledTimes(2));
    expect(useActionMutation).toHaveBeenCalledWith("sync-inbox", {
      method: "POST",
      skipActionQueryInvalidation: true,
    });
    expect(mutateSyncAction).toHaveBeenCalledWith({
      accountEmails: ["first@example.com"],
    });
    expect(requestOrder).toEqual(["list", "sync", "list", "sync"]);

    syncHook.unmount();
    listHook.unmount();
    queryClient.clear();
  });

  it("keeps an unchanged sync result idle until its next interval", async () => {
    callActionWithRetry.mockResolvedValue(response());
    mutateSyncAction.mockResolvedValue({
      accounts: [
        {
          accountEmail: "first@example.com",
          state: "ready",
          lastSyncedAt: Date.now(),
          changed: false,
          pushGeneration: 4,
          lastPushGeneration: 4,
          pushPending: false,
        },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const input: ListInboxThreadsInput = {
      tab: "important",
      accountEmails: ["first@example.com"],
      limit: 50,
      offset: 0,
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const listHook = renderHook(() => useInboxThreads(input), { wrapper });

    await waitFor(() => expect(listHook.result.current.data).toBeDefined());
    const syncHook = renderHook(() => useInboxSyncPoller(input.accountEmails), {
      wrapper,
    });
    await waitFor(() => expect(mutateSyncAction).toHaveBeenCalledTimes(1));
    const listCalls = callActionWithRetry.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mutateSyncAction).toHaveBeenCalledTimes(1);
    expect(callActionWithRetry).toHaveBeenCalledTimes(listCalls);
    expect(useActionMutation).toHaveBeenCalledWith("sync-inbox", {
      method: "POST",
      skipActionQueryInvalidation: true,
    });

    syncHook.unmount();
    listHook.unmount();
    queryClient.clear();
  });

  it("keeps the all-accounts sync poll unscoped while a cached account cools down", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = inboxSyncQueryKey();
    queryClient.setQueryData(queryKey, {
      accounts: [
        {
          accountEmail: "first@example.com",
          state: "initial",
          lastSyncedAt: null,
          retryAt: Date.now() + 60_000,
        },
      ],
    } as any);
    await queryClient.invalidateQueries({ queryKey });
    mutateSyncAction.mockResolvedValue({
      accounts: [
        {
          accountEmail: "first@example.com",
          state: "initial",
          lastSyncedAt: null,
          changed: false,
          pushGeneration: 0,
          lastPushGeneration: 0,
          pushPending: false,
          retryAfterSeconds: 60,
        },
        {
          accountEmail: "new@example.com",
          state: "initial",
          lastSyncedAt: null,
          changed: false,
          pushGeneration: 0,
          lastPushGeneration: 0,
          pushPending: false,
        },
      ],
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useInboxSyncPoller(), { wrapper });

    await waitFor(() => expect(mutateSyncAction).toHaveBeenCalledWith({}));

    hook.unmount();
    queryClient.clear();
  });
});

describe("useInboxSyncPoller account discovery", () => {
  it("drops omitted stale accounts from unscoped polls and becomes idle", async () => {
    const staleAccount = {
      accountEmail: "disconnected@example.com",
      state: "initial" as const,
      lastSyncedAt: null,
      changed: false,
      lastPushGeneration: 0,
      pushGeneration: 1,
      pushPending: true,
    };
    mutateSyncAction.mockResolvedValue({ accounts: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      inboxSyncQueryKey(),
      { accounts: [staleAccount] },
      { updatedAt: 0 },
    );
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useInboxSyncPoller(), { wrapper });

    await waitFor(() => expect(mutateSyncAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(hook.result.current.data?.accounts).toEqual([]));
    expect(
      inboxSyncRefetchInterval({
        state: {
          error: hook.result.current.error,
          data: hook.result.current.data,
        },
      }),
    ).toBe(20_000);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mutateSyncAction).toHaveBeenCalledOnce();

    hook.unmount();
    queryClient.clear();
  });

  it("keeps all-account polls unscoped so newly connected accounts are discovered", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const existingAccount = {
      accountEmail: "first@example.com",
      state: "ready" as const,
      lastSyncedAt: Date.now(),
      changed: false,
      lastPushGeneration: 0,
      pushGeneration: 0,
      pushPending: false,
    };
    const connectedAccount = {
      ...existingAccount,
      accountEmail: "new@example.com",
      state: "initial" as const,
      lastSyncedAt: null,
    };
    mutateSyncAction.mockResolvedValue({
      accounts: [existingAccount, connectedAccount],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      inboxSyncQueryKey(),
      { accounts: [existingAccount] },
      { updatedAt: 0 },
    );
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useInboxSyncPoller(), { wrapper });

    await waitFor(() => expect(mutateSyncAction).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(hook.result.current.data?.accounts).toHaveLength(2),
    );
    expect(mutateSyncAction).toHaveBeenCalledWith({});

    hook.unmount();
    queryClient.clear();
    clock.mockRestore();
  });
});
