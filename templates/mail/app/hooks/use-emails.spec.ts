import { readFileSync } from "node:fs";

import type { EmailMessage } from "@shared/types";
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  consumeExternalEmailRefresh,
  filterSuppressedThreads,
  markExternalEmailRefresh,
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
  });
});
