import { readFileSync } from "node:fs";

import type { EmailMessage } from "@shared/types";
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  consumeExternalEmailRefresh,
  filterSuppressedThreads,
  markExternalEmailRefresh,
  rebasePinnedLabelsUpdate,
  suppressThread,
  unsuppressThread,
} from "./use-emails";

function makeEmail(id: string, threadId: string): EmailMessage {
  return {
    id,
    threadId,
    from: { name: "Sender", email: "sender@example.com" },
    to: [{ name: "Recipient", email: "recipient@example.com" }],
    subject: "Subject",
    snippet: "Snippet",
    body: "Body",
    date: "2026-06-25T12:00:00.000Z",
    isRead: false,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: ["inbox"],
  };
}

function emailsHookSource(): string {
  return readFileSync(new URL("./use-emails.ts", import.meta.url), "utf8");
}

describe("filterSuppressedThreads", () => {
  afterEach(() => {
    unsuppressThread("thread-archived");
    consumeExternalEmailRefresh();
    vi.useRealTimers();
  });

  it("keeps an archived thread hidden from stale inbox refetches", () => {
    suppressThread("thread-archived", "archive");

    const visible = filterSuppressedThreads(
      [
        makeEmail("msg-archived", "thread-archived"),
        makeEmail("msg-visible", "thread-visible"),
      ],
      "inbox",
    );

    expect(visible.map((email) => email.id)).toEqual(["msg-visible"]);
  });

  it("allows an archived thread in the archive destination view", () => {
    suppressThread("thread-archived", "archive");

    const visible = filterSuppressedThreads(
      [makeEmail("msg-archived", "thread-archived")],
      "archive",
    );

    expect(visible.map((email) => email.id)).toEqual(["msg-archived"]);
  });
});

describe("consumeExternalEmailRefresh", () => {
  afterEach(() => {
    consumeExternalEmailRefresh();
    vi.useRealTimers();
  });

  it("uses each forced Gmail list refresh once per list scope", () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-26T12:00:00.000Z").getTime();
    vi.setSystemTime(now);

    markExternalEmailRefresh();

    expect(consumeExternalEmailRefresh("inbox")).toBe(now);
    expect(consumeExternalEmailRefresh("important")).toBe(now);
    expect(consumeExternalEmailRefresh("inbox")).toBeUndefined();
    expect(consumeExternalEmailRefresh("important")).toBeUndefined();
  });

  it("drops expired forced Gmail list refreshes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    markExternalEmailRefresh();

    vi.advanceTimersByTime(5000);

    expect(consumeExternalEmailRefresh()).toBeUndefined();
  });
});

describe("useLabels", () => {
  it("keeps the last label data during a failed refresh", () => {
    const source = emailsHookSource();

    expect(source).toContain("placeholderData: (previousData) => previousData");
    expect(source).toContain("export const EMPTY_LABELS: Label[] = [];");
    expect(source).toContain(
      "export function useLabels(accountEmails?: readonly string[])",
    );
    expect(source).toContain('useActionQuery<Label[]>(\n    "list-labels",');
  });
});

describe("useEmails query warming", () => {
  it("shares the infinite-query fetcher with tab prefetches", () => {
    const source = emailsHookSource();
    const useEmailsSource = source.slice(
      source.indexOf("export function useEmails("),
    );

    expect(useEmailsSource).toContain(
      "placeholderData: (previousData) => previousData",
    );
    expect(useEmailsSource).toContain(
      "const canPaginate = !q.isPlaceholderData;",
    );
    expect(useEmailsSource).toContain(
      "hasNextPage: canPaginate && q.hasNextPage",
    );
    expect(useEmailsSource).toContain(
      "isFetchingNextPage: canPaginate && q.isFetchingNextPage",
    );
    expect(useEmailsSource).toContain(
      "const hasCurrentQueryData = Boolean(q.data) && !q.isPlaceholderData;",
    );
    expect(useEmailsSource).toContain(
      "isError: q.isError && !hasCurrentQueryData",
    );
    expect(source).toContain("function emailQueryOptions(");
    expect(source).toContain("prefetchInfiniteQuery({");
    expect(source).toContain('const prefetchKey = ["email-prefetch"');
    expect(source).toContain("EMAIL_PREFETCH_TIMEOUT_MS");
    expect(source).toContain("queryClient.removeQueries");
    expect(source).toContain("queryKey: prefetchKey");
    expect(source).toContain("...emailQueryOptions(view, search, label)");
  });
});

describe("serializePinnedLabelsUpdate", () => {
  it("runs pinned-label writes in order", async () => {
    const { serializePinnedLabelsUpdate } = await import("./use-emails");
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = serializePinnedLabelsUpdate(
      () =>
        new Promise<void>((resolve) => {
          events.push("first");
          releaseFirst = resolve;
        }),
    );
    const second = serializePinnedLabelsUpdate(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first", "second"]);
  });
});

describe("rebasePinnedLabelsUpdate", () => {
  it("drops a failed queued pin from the later payload", () => {
    expect(
      rebasePinnedLabelsUpdate([], ["important"], ["important", "travel"]),
    ).toEqual(["travel"]);
  });

  it("keeps a later reorder aligned with confirmed pins", () => {
    expect(
      rebasePinnedLabelsUpdate(
        ["inbox", "sent"],
        ["inbox", "sent"],
        ["sent", "inbox"],
      ),
    ).toEqual(["sent", "inbox"]);
  });

  it("preserves confirmed order when a queued intent keeps the same order", () => {
    expect(
      rebasePinnedLabelsUpdate(
        ["sent", "inbox"],
        ["inbox", "sent"],
        ["inbox", "sent"],
      ),
    ).toEqual(["sent", "inbox"]);
  });
});

describe("useUpdateSettings", () => {
  it("serializes pinned-label snapshots without touching other settings writes", () => {
    const source = emailsHookSource();

    expect(source).toContain('"pinnedLabels" in data');
    expect(source).toContain("serializePinnedLabelsUpdate(() =>");
    expect(source).toContain("rebasePinnedLabelsUpdate(");
    expect(source).toContain("resetPinnedLabelsState(owner)");
    expect(source).toContain("settingsLoading || !prev || !owner");
    expect(source).toContain("requestSource: TAB_ID");
  });
});
