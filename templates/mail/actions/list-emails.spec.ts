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
  getUserSetting: vi.fn(),
  cursorState: null as any,
  createInventoryCursor: vi.fn(),
  claimInventoryCursor: vi.fn(),
  settleInventoryCursorClaim: vi.fn(),
  releaseInventoryCursorClaim: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/inventory-cursor.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/inventory-cursor.js")>();
  return {
    ...actual,
    createInventoryCursor: mocks.createInventoryCursor,
    claimInventoryCursor: mocks.claimInventoryCursor,
    settleInventoryCursorClaim: mocks.settleInventoryCursorClaim,
    releaseInventoryCursorClaim: mocks.releaseInventoryCursorClaim,
  };
});

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: vi.fn(),
  getClients: vi.fn(),
  getConnectedAccounts: vi.fn(),
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
  getConnectedAccounts,
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
  vi.mocked(getConnectedAccounts).mockResolvedValue([OWNER]);
  vi.mocked(fetchGmailLabelMap).mockResolvedValue(new Map());
  vi.mocked(getSnoozedThreadIds).mockResolvedValue(new Set());
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.cursorState = null;
  mocks.createInventoryCursor.mockImplementation(async (_owner, state) => {
    mocks.cursorState = structuredClone(state);
    return "cursor-1";
  });
  mocks.claimInventoryCursor.mockImplementation(
    async (ownerEmail, id, queryFingerprint) =>
      id === "cursor-1" && mocks.cursorState
        ? {
            id,
            claimId: "claim-1",
            ownerEmail,
            queryFingerprint,
            version: 1,
            state: structuredClone(mocks.cursorState),
          }
        : null,
  );
  mocks.settleInventoryCursorClaim.mockResolvedValue(undefined);
  mocks.releaseInventoryCursorClaim.mockResolvedValue(undefined);
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

describe("list-emails action — coverage-aware inventory", () => {
  const BUSY = "busy@example.com";
  const QUIET = "quiet@example.com";
  const EMPTY = "empty@example.com";
  const FAILED = "failed@example.com";

  beforeEach(() => {
    vi.mocked(getConnectedAccounts).mockResolvedValue([
      BUSY,
      QUIET,
      EMPTY,
      FAILED,
    ]);
  });

  it("reports busy, quiet, empty, and failed accounts without silent partial coverage", async () => {
    const busy = rawMessage("busy-1", "busy-thread");
    busy._accountEmail = BUSY;
    const quiet = rawMessage("quiet-1", "quiet-thread");
    quiet._accountEmail = QUIET;
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [busy, quiet],
      errors: [{ email: FAILED, error: "429: rateLimitExceeded" }],
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw, {
        date:
          raw._accountEmail === BUSY
            ? "2026-07-13T12:00:00Z"
            : "2026-07-13T11:00:00Z",
      }),
    );

    const result = (await action.run(
      { view: "inbox", format: "inventory", limit: 10 },
      { caller: "mcp" } as any,
    )) as any;

    expect(result.version).toBe(1);
    expect(result.requestedAccounts).toBeNull();
    expect(result.resolvedAccounts).toEqual([BUSY, QUIET, EMPTY, FAILED]);
    expect(result.queriedAccounts).toEqual([BUSY, QUIET, EMPTY, FAILED]);
    expect(result.items.map((item: any) => item.accountEmail)).toEqual([
      BUSY,
      QUIET,
    ]);
    expect(result.items.every((item: any) => !("body" in item))).toBe(true);
    expect(result.accounts).toEqual([
      expect.objectContaining({
        accountEmail: BUSY,
        status: "ok",
        count: 1,
        exhausted: true,
      }),
      expect.objectContaining({
        accountEmail: QUIET,
        status: "ok",
        count: 1,
        exhausted: true,
      }),
      expect.objectContaining({
        accountEmail: EMPTY,
        status: "ok",
        count: 0,
        exhausted: true,
      }),
      expect.objectContaining({
        accountEmail: FAILED,
        status: "error",
        count: 0,
        exhausted: false,
        error: expect.objectContaining({
          code: "rate_limited",
          retryable: true,
        }),
      }),
    ]);
    expect(result.coverageComplete).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.page).toEqual({ returned: 2, hasMore: false });
  });

  it("validates and forwards an account filter before unrelated provider work", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [],
    } as any);

    const result = (await action.run(
      { format: "inventory", accountEmails: [QUIET] },
      { caller: "mcp" } as any,
    )) as any;

    expect(result.requestedAccounts).toEqual([QUIET]);
    expect(result.resolvedAccounts).toEqual([QUIET]);
    expect(listGmailMessages).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listGmailMessages).mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({
        accountEmails: [QUIET],
        threadFormat: "metadata",
        threadRecentMessageCandidateLimit: undefined,
      }),
    );
    expect(getClients).not.toHaveBeenCalled();
    expect(fetchGmailLabelMap).not.toHaveBeenCalled();
  });

  it("accepts singular account as the inventory account alias", async () => {
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [],
      errors: [],
    } as any);

    const result = (await action.run({ format: "inventory", account: QUIET }, {
      caller: "mcp",
    } as any)) as any;

    expect(result.requestedAccounts).toEqual([QUIET]);
    expect(result.resolvedAccounts).toEqual([QUIET]);
    expect(vi.mocked(listGmailMessages).mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ accountEmails: [QUIET] }),
    );
  });

  it("rejects ambiguous singular and plural account filters", async () => {
    await expect(
      action.run(
        {
          format: "inventory",
          account: QUIET,
          accountEmails: [BUSY],
        },
        { caller: "mcp" } as any,
      ),
    ).rejects.toThrow("Pass account or accountEmails, not both.");
    expect(getConnectedAccounts).not.toHaveBeenCalled();
  });

  it("preserves account provenance when Gmail thread ids collide", async () => {
    const fromBusy = rawMessage("busy-message", "shared-thread");
    fromBusy._accountEmail = BUSY;
    const fromQuiet = rawMessage("quiet-message", "shared-thread");
    fromQuiet._accountEmail = QUIET;
    vi.mocked(listGmailMessages).mockResolvedValue({
      messages: [fromBusy, fromQuiet],
      errors: [],
    } as any);
    vi.mocked(gmailToEmailMessage).mockImplementation((raw: any) =>
      emailFor(raw),
    );

    const result = (await action.run(
      {
        format: "inventory",
        accountEmails: [BUSY, QUIET],
        limit: 10,
      },
      { caller: "mcp" } as any,
    )) as any;

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item: any) => item.accountEmail).sort()).toEqual([
      BUSY,
      QUIET,
    ]);
  });

  it("validates and filters plural account selection against local mail accounts", async () => {
    const LOCAL_ONE = "local-one@example.com";
    const LOCAL_TWO = "local-two@example.com";
    vi.mocked(getConnectedAccounts).mockResolvedValue([]);
    vi.mocked(isConnected).mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        emailFor(
          {
            ...rawMessage("local-one", "thread-one"),
            _accountEmail: LOCAL_ONE,
          },
          { date: "2026-07-13T13:00:00Z" },
        ),
        emailFor(
          {
            ...rawMessage("local-two", "thread-two"),
            _accountEmail: LOCAL_TWO,
          },
          { date: "2026-07-13T12:00:00Z" },
        ),
      ],
    });

    const result = (await action.run(
      { format: "inventory", accountEmails: [LOCAL_TWO] },
      { caller: "mcp" } as any,
    )) as any;

    expect(result.requestedAccounts).toEqual([LOCAL_TWO]);
    expect(result.resolvedAccounts).toEqual([LOCAL_TWO]);
    expect(result.items.map((item: any) => item.id)).toEqual(["local-two"]);
    expect(listGmailMessages).not.toHaveBeenCalled();
  });

  it("accepts singular account selection for a local mail account", async () => {
    const LOCAL_ONE = "local-one@example.com";
    const LOCAL_TWO = "local-two@example.com";
    vi.mocked(getConnectedAccounts).mockResolvedValue([]);
    vi.mocked(isConnected).mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        emailFor({
          ...rawMessage("local-one", "thread-one"),
          _accountEmail: LOCAL_ONE,
        }),
        emailFor({
          ...rawMessage("local-two", "thread-two"),
          _accountEmail: LOCAL_TWO,
        }),
      ],
    });

    const result = (await action.run(
      { format: "inventory", account: LOCAL_ONE },
      { caller: "mcp" } as any,
    )) as any;

    expect(result.requestedAccounts).toEqual([LOCAL_ONE]);
    expect(result.resolvedAccounts).toEqual([LOCAL_ONE]);
    expect(result.items.map((item: any) => item.id)).toEqual(["local-one"]);
  });

  it("rejects an account selection absent from local mail", async () => {
    vi.mocked(getConnectedAccounts).mockResolvedValue([]);
    vi.mocked(isConnected).mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [rawMessage("local-one", "thread-one")].map((raw) =>
        emailFor({ ...raw, _accountEmail: "local-one@example.com" }),
      ),
    });

    await expect(
      action.run(
        { format: "inventory", accountEmails: ["missing@example.com"] },
        { caller: "mcp" } as any,
      ),
    ).rejects.toThrow(
      "Account missing@example.com is not available in local mail for this user.",
    );
    expect(listGmailMessages).not.toHaveBeenCalled();
  });

  it("pages local inventory without prefix loss when OAuth is absent", async () => {
    vi.mocked(getConnectedAccounts).mockResolvedValue([]);
    vi.mocked(isConnected).mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        emailFor(rawMessage("local-3", "thread-3"), {
          date: "2026-07-13T13:00:00Z",
        }),
        emailFor(rawMessage("local-2", "thread-2"), {
          date: "2026-07-13T12:00:00Z",
        }),
        emailFor(rawMessage("local-1", "thread-1"), {
          date: "2026-07-13T11:00:00Z",
        }),
      ],
    });

    const first = (await action.run({ format: "inventory", limit: 2 }, {
      caller: "mcp",
    } as any)) as any;
    const second = (await action.run(
      { format: "inventory", limit: 2, cursor: first.page.nextCursor },
      { caller: "mcp" } as any,
    )) as any;

    expect(first.resolvedAccounts).toEqual([OWNER]);
    expect(first.items.map((row: any) => row.id)).toEqual([
      "local-3",
      "local-2",
    ]);
    expect(first.page).toEqual({
      returned: 2,
      hasMore: true,
      nextCursor: "cursor-1",
    });
    expect(second.items.map((row: any) => row.id)).toEqual(["local-1"]);
    expect(second.complete).toBe(true);
    expect([...first.items, ...second.items].map((row: any) => row.id)).toEqual(
      ["local-3", "local-2", "local-1"],
    );
    expect(mocks.settleInventoryCursorClaim).toHaveBeenCalledTimes(1);
  });

  it("releases a continuation lease when settlement fails", async () => {
    vi.mocked(getConnectedAccounts).mockResolvedValue([]);
    vi.mocked(isConnected).mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        emailFor(rawMessage("local-2", "thread-2"), {
          date: "2026-07-13T12:00:00Z",
        }),
        emailFor(rawMessage("local-1", "thread-1"), {
          date: "2026-07-13T11:00:00Z",
        }),
      ],
    });
    const first = (await action.run({ format: "inventory", limit: 1 }, {
      caller: "mcp",
    } as any)) as any;
    mocks.settleInventoryCursorClaim.mockRejectedValueOnce(
      new Error("temporary database failure"),
    );

    await expect(
      action.run(
        { format: "inventory", limit: 1, cursor: first.page.nextCursor },
        { caller: "mcp" } as any,
      ),
    ).rejects.toThrow("temporary database failure");
    expect(mocks.releaseInventoryCursorClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cursor-1", claimId: "claim-1" }),
    );
  });
});
