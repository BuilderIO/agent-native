/**
 * Tests for list-inbox-emails.ts — the shared Gmail listing core called by
 * both the `list-emails` agent action and the REST `listEmails` handler.
 *
 * Before this file existed, the two callers re-implemented Gmail
 * query-build + pagination + thread-scoping independently and drifted: the
 * REST handler filtered out snoozed threads and handled Gmail 429/quota
 * errors gracefully, the agent action did neither. These tests pin down the
 * merged (superset) behaviour so that regression can't creep back in for
 * either caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./google-auth.js", () => ({
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT: 100,
  gmailToEmailMessage: vi.fn(),
  listGmailMessages: vi.fn(),
}));

vi.mock("./jobs.js", () => ({
  getSnoozedThreadIds: vi.fn(),
}));

import {
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT,
  gmailToEmailMessage,
  listGmailMessages,
} from "./google-auth.js";
import { getSnoozedThreadIds } from "./jobs.js";
import { listInboxEmails } from "./list-inbox-emails.js";

const OWNER = "owner@example.com";

function rawMessage(id: string, threadId: string, overrides: any = {}) {
  return { id, threadId, _accountEmail: OWNER, ...overrides };
}

/** Minimal EmailMessage-shaped stand-in for gmailToEmailMessage's output. */
function emailFor(raw: any, overrides: any = {}) {
  return {
    id: raw.id,
    threadId: raw.threadId,
    accountEmail: raw._accountEmail,
    from: { name: "Sender", email: "sender@example.com" },
    subject: `Subject ${raw.id}`,
    snippet: "",
    date: overrides.date ?? "2024-01-01T00:00:00Z",
    isRead: overrides.isRead ?? false,
    isStarred: false,
    isDraft: false,
    isSent: false,
    isArchived: false,
    isTrashed: false,
    labelIds: ["inbox"],
    ...overrides,
  };
}

function accountTokens() {
  return [{ email: OWNER, accessToken: "access-token" }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSnoozedThreadIds).mockResolvedValue(new Set());
});

describe("listInboxEmails", () => {
  it("fetches, thread-scopes, and sorts messages newest-first", async () => {
    const raws = [rawMessage("m1", "thread-1"), rawMessage("m2", "thread-2")];
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: raws,
      errors: [],
      nextPageTokens: undefined,
      resultSizeEstimate: 2,
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw, {
        date: raw.id === "m1" ? "2024-01-01T00:00:00Z" : "2024-06-01T00:00:00Z",
      }),
    );

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.emails.map((e) => e.id)).toEqual(["m2", "m1"]);
    expect(listGmailMessages).toHaveBeenCalledWith(
      "in:inbox -in:sent",
      50,
      OWNER,
      undefined,
      expect.objectContaining({
        mode: "threads",
        threadRecentMessageCandidateLimit:
          DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT,
      }),
    );
  });

  it("excludes snoozed threads from an inbox listing", async () => {
    const raws = [
      rawMessage("m-snoozed", "thread-snoozed"),
      rawMessage("m-visible", "thread-visible"),
    ];
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: raws,
      errors: [],
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw),
    );
    vi.mocked(getSnoozedThreadIds).mockResolvedValue(
      new Set(["thread-snoozed"]),
    );

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.emails.map((e) => e.id)).toEqual(["m-visible"]);
    expect(getSnoozedThreadIds).toHaveBeenCalledWith(OWNER);
  });

  it("excludes snoozed threads from an unread listing too", async () => {
    const raws = [rawMessage("m-snoozed", "thread-snoozed")];
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: raws,
      errors: [],
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw, { isRead: false }),
    );
    vi.mocked(getSnoozedThreadIds).mockResolvedValue(
      new Set(["thread-snoozed"]),
    );

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "unread",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.emails).toEqual([]);
  });

  it("skips snooze filtering when the caller is searching", async () => {
    const raws = [rawMessage("m-snoozed", "thread-snoozed")];
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: raws,
      errors: [],
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw),
    );
    vi.mocked(getSnoozedThreadIds).mockResolvedValue(
      new Set(["thread-snoozed"]),
    );

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      q: "invoice",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.emails.map((e) => e.id)).toEqual(["m-snoozed"]);
    expect(getSnoozedThreadIds).not.toHaveBeenCalled();
  });

  it("returns a graceful quota-error result instead of throwing on a Gmail 429", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [
        {
          email: OWNER,
          error: "429: rateLimitExceeded — retry in 90s",
        },
      ],
    } as any);

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.isQuotaError).toBe(true);
    expect(result.retryAfterSeconds).toBe(90);
    expect(result.message).toContain(OWNER);
    // The 429 short-circuit must happen before the snooze lookup.
    expect(getSnoozedThreadIds).not.toHaveBeenCalled();
  });

  it("returns a non-quota failure result (no retryAfterSeconds) for other Gmail errors", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [{ email: OWNER, error: "500: Internal error" }],
    } as any);

    const result = await listInboxEmails({
      ownerEmail: OWNER,
      view: "inbox",
      limit: 50,
      accountTokens: accountTokens(),
      labelMap: new Map(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.isQuotaError).toBe(false);
    expect(result.retryAfterSeconds).toBeUndefined();
  });
});
