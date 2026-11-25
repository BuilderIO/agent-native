// @vitest-environment happy-dom

import type { ListInboxThreadsResult } from "@shared/inbox-threads";
import type { EmailMessage } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  enqueue: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  cancelOrWait: vi.fn(),
}));

vi.mock("@/lib/gmail-mutation-queue", () => ({ gmailMutationQueue: queue }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { clearThreadCache, setCachedThread } from "@/lib/thread-cache";

import {
  clearOptimisticOverride,
  setOptimisticOverride,
  useMarkRead,
} from "./use-emails";
import {
  applyInboxMutationOverlay,
  INBOX_THREADS_QUERY_KEY,
} from "./use-inbox-threads";

const ACCOUNT = "recipient@example.com";
const QUERY_KEY = [...INBOX_THREADS_QUERY_KEY, { offset: 0 }];
const OLDER_QUERY_KEY = [...INBOX_THREADS_QUERY_KEY, { tab: "other" }];

function message(id: string, isRead: boolean): EmailMessage {
  return {
    id,
    threadId: "t1",
    from: { name: "Sender", email: "sender@example.com" },
    to: [{ name: "Recipient", email: ACCOUNT }],
    subject: "Subject",
    snippet: "Snippet",
    body: "Body",
    date: "2026-11-24T12:00:00.000Z",
    isRead,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: ["inbox"],
    accountEmail: ACCOUNT,
  };
}

type Row = { messageCount: number; unreadCount: number };

function listResult(row: Row, clientSnapshotId: number) {
  return {
    activeTabId: "important",
    items: [
      { ...message("m1", row.unreadCount === 0), ...row, messageIds: ["m1"] },
    ],
    tabs: [{ id: "important", total: 1, unread: row.unreadCount > 0 ? 1 : 0 }],
    accounts: [],
    total: 1,
    syncing: false,
    clientSnapshotId,
  };
}

function setup(row: Row, olderRow?: Row) {
  const qc = new QueryClient();
  if (olderRow) {
    qc.setQueryData(OLDER_QUERY_KEY, listResult(olderRow, 1));
  }
  qc.setQueryData(QUERY_KEY, listResult(row, 2));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useMarkRead(), { wrapper });
  return {
    press: (isRead: boolean) =>
      act(async () => {
        await result.current
          .mutateAsync({
            id: "m1",
            isRead,
            accountEmail: ACCOUNT,
            threadId: "t1",
          })
          .catch(() => {});
      }),
    unreadCount: () =>
      applyInboxMutationOverlay(
        qc,
        qc.getQueryData(QUERY_KEY) as ListInboxThreadsResult,
      ).items[0]?.unreadCount,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  queue.enqueue.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  clearThreadCache();
  clearOptimisticOverride("m1");
  vi.useRealTimers();
});

describe("useMarkRead inbox row", () => {
  it("marks the row unread at once when a refetch left the open thread's cached copy unread", async () => {
    const inbox = setup({ messageCount: 1, unreadCount: 0 });
    setCachedThread("t1", [message("m1", false)], ACCOUNT);
    setOptimisticOverride("m1", { isRead: true });

    await inbox.press(false);

    expect(inbox.unreadCount()).toBe(1);
  });

  it("marks the row of a thread that was never opened unread at once", async () => {
    const inbox = setup({ messageCount: 1, unreadCount: 0 });

    await inbox.press(false);

    expect(inbox.unreadCount()).toBe(1);
  });

  it("toggles the row on every press", async () => {
    const inbox = setup({ messageCount: 1, unreadCount: 0 });
    setCachedThread("t1", [message("m1", false)], ACCOUNT);
    setOptimisticOverride("m1", { isRead: true });

    const counts: Array<number | undefined> = [];
    for (const isRead of [false, true, false]) {
      await inbox.press(isRead);
      counts.push(inbox.unreadCount());
    }

    expect(counts).toEqual([1, 0, 1]);
  });

  it("does not count a message that is already unread twice", async () => {
    const inbox = setup({ messageCount: 2, unreadCount: 1 });
    setCachedThread("t1", [message("m1", false)], ACCOUNT);

    await inbox.press(false);

    expect(inbox.unreadCount()).toBe(1);
  });

  it("goes by the list that was fetched last", async () => {
    const inbox = setup(
      { messageCount: 2, unreadCount: 2 },
      { messageCount: 2, unreadCount: 0 },
    );
    setCachedThread("t1", [message("m1", false)], ACCOUNT);

    await inbox.press(false);

    expect(inbox.unreadCount()).toBe(2);
  });

  it("puts the row back when Gmail refuses the change", async () => {
    const inbox = setup({ messageCount: 1, unreadCount: 0 });
    queue.enqueue.mockRejectedValue(new Error("refused"));

    await inbox.press(false);

    expect(inbox.unreadCount()).toBe(0);
  });
});
