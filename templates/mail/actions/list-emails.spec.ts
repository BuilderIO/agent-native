/**
 * Behavioral tests for the `list-emails` agent action's Gmail-connected
 * path. Before the shared `server/lib/list-inbox-emails.ts` core existed,
 * this action re-implemented Gmail listing independently from the REST
 * `listEmails` handler and diverged from it in two ways: it never filtered
 * out snoozed threads, and an all-accounts Gmail 429/quota failure threw an
 * unhandled error instead of a graceful result. These tests pin down the
 * fix so the agent's inbox always matches what the human UI shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: vi.fn(),
  getClients: vi.fn(),
  fetchGmailLabelMap: vi.fn(),
  // Consumed internally by the real (unmocked) shared list-inbox-emails.js core.
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT: 100,
  gmailToEmailMessage: vi.fn(),
  listGmailMessages: vi.fn(),
}));

vi.mock("../server/lib/jobs.js", () => ({
  getSnoozedThreadIds: vi.fn(),
  getSyntheticEmailsForView: vi.fn(),
}));

import {
  fetchGmailLabelMap,
  getClients,
  gmailToEmailMessage,
  isConnected,
  listGmailMessages,
} from "../server/lib/google-auth.js";
import { getSnoozedThreadIds } from "../server/lib/jobs.js";
import action from "./list-emails";

const OWNER = "owner@example.com";

function rawMessage(id: string, threadId: string) {
  return { id, threadId, _accountEmail: OWNER };
}

function emailFor(raw: any, overrides: any = {}) {
  return {
    id: raw.id,
    threadId: raw.threadId,
    accountEmail: raw._accountEmail,
    from: { name: "Sender", email: "sender@example.com" },
    subject: `Subject ${raw.id}`,
    snippet: "",
    date: "2024-01-01T00:00:00Z",
    isRead: false,
    isStarred: false,
    isDraft: false,
    isSent: false,
    isArchived: false,
    isTrashed: false,
    labelIds: ["inbox"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  vi.mocked(isConnected).mockResolvedValue(true);
  vi.mocked(getClients).mockResolvedValue([
    { email: OWNER, accessToken: "access-token", refreshToken: "" },
  ] as any);
  vi.mocked(fetchGmailLabelMap).mockResolvedValue(new Map());
  vi.mocked(getSnoozedThreadIds).mockResolvedValue(new Set());
});

describe("list-emails action — Gmail-connected inbox", () => {
  it("excludes snoozed threads from the inbox view, matching the REST handler", async () => {
    const raws = [
      rawMessage("m-snoozed", "thread-snoozed"),
      rawMessage("m-visible", "thread-visible"),
    ];
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: raws,
      errors: [],
      resultSizeEstimate: 2,
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw),
    );
    vi.mocked(getSnoozedThreadIds).mockResolvedValue(
      new Set(["thread-snoozed"]),
    );

    const raw = await action.run({ view: "inbox" });
    const emails = JSON.parse(raw);

    expect(emails.map((e: any) => e.id)).toEqual(["m-visible"]);
    expect(getSnoozedThreadIds).toHaveBeenCalledWith(OWNER);
  });

  it("excludes snoozed threads from the unread view too", async () => {
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

    const raw = await action.run({ view: "unread" });
    const emails = JSON.parse(raw);

    expect(emails).toEqual([]);
  });

  it("returns a graceful JSON error instead of throwing when Gmail rate-limits every account", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [
        {
          email: OWNER,
          error: "429: rateLimitExceeded — retry in 90s",
        },
      ],
    } as any);

    const raw = await action.run({ view: "inbox" });
    const parsed = JSON.parse(raw);

    expect(parsed.error).toContain(OWNER);
    expect(parsed.error).toContain("429");
    expect(parsed.retryAfterSeconds).toBe(90);
  });

  it("does not call getSnoozedThreadIds when the Gmail account is rate-limited", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [{ email: OWNER, error: "429: rateLimitExceeded" }],
    } as any);

    await action.run({ view: "inbox" });

    expect(getSnoozedThreadIds).not.toHaveBeenCalled();
  });
});
