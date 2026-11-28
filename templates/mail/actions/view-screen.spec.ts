import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppStateForCurrentTab: vi.fn(),
  getRequestUserEmail: vi.fn(),
  readLocalEmails: vi.fn(),
  readSettings: vi.fn(),
  isConnected: vi.fn(),
  getClientsWithErrors: vi.fn(),
  listGmailMessages: vi.fn(),
  gmailToEmailMessage: vi.fn(),
  getSyntheticEmailsForView: vi.fn(),
  listInboxThreads: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./list-inbox-threads.js", () => ({
  default: { run: mocks.listInboxThreads },
}));

vi.mock("../server/lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  getClientsWithErrors: mocks.getClientsWithErrors,
  listGmailMessages: mocks.listGmailMessages,
  gmailToEmailMessage: mocks.gmailToEmailMessage,
}));

vi.mock("../server/lib/jobs.js", () => ({
  getSyntheticEmailsForView: mocks.getSyntheticEmailsForView,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetThread: vi.fn(),
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: vi.fn(),
  fetchLabelMap: vi.fn(),
}));

vi.mock("../server/lib/queued-drafts.js", () => ({
  listQueuedDrafts: vi.fn(),
  requireQueuedDraft: vi.fn(),
}));

import { ALL_TAB_ID } from "../shared/inbox-threads.js";
import action from "./view-screen";

const OWNER = "owner@example.com";

function email(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    accountEmail: OWNER,
    from: { name: "Sender", email: `${id}@example.com` },
    subject: id,
    snippet: "",
    date: "2026-09-03T00:00:00.000Z",
    isRead: true,
    isStarred: false,
    labelIds: [],
  };
}

function inboxResult(overrides: Record<string, unknown> = {}) {
  return {
    tabs: [
      {
        id: "important",
        kind: "important",
        name: "Important",
        total: 4,
        unread: 2,
      },
      { id: "other", kind: "other", name: "Other", total: 3, unread: 1 },
    ],
    activeTabId: "important",
    items: [email("first"), email("second")],
    tabPreviews: {},
    total: 4,
    hasMore: false,
    reachedCap: false,
    syncing: false,
    accounts: [{ accountEmail: OWNER, state: "ready", lastSyncedAt: 1 }],
    labels: [],
    read: { freshness: "live" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppStateForCurrentTab.mockResolvedValue({ view: "all" });
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.readLocalEmails.mockResolvedValue([]);
  mocks.readSettings.mockResolvedValue({ savedFilters: [], pinnedLabels: [] });
  mocks.isConnected.mockResolvedValue(true);
  mocks.getClientsWithErrors.mockResolvedValue({
    clients: [{ email: OWNER, accessToken: "access-token", refreshToken: "" }],
    errors: [],
  });
  mocks.getSyntheticEmailsForView.mockResolvedValue([]);
  mocks.gmailToEmailMessage.mockImplementation((raw: any) => raw);
  mocks.listInboxThreads.mockResolvedValue(inboxResult());
});

describe("view-screen inbox preview", () => {
  it("reads the inbox through list-inbox-threads, the read the inbox UI makes", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      activeInboxTab: "other",
      activeAccounts: [OWNER],
    });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listInboxThreads).toHaveBeenCalledWith({
      tab: "other",
      limit: 10,
      offset: 0,
      accountEmails: [OWNER],
    });
    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["first", "second"]);
    expect(result.emailList.tabs).toEqual([
      {
        id: "important",
        kind: "important",
        name: "Important",
        total: 4,
        unread: 2,
      },
      { id: "other", kind: "other", name: "Other", total: 3, unread: 1 },
    ]);
    expect(result.emailList.activeTabId).toBe("important");
    expect(result.emailList.truncated).toBe(false);
    expect(result.emailList.coverage).toEqual({
      complete: true,
      failedAccounts: [],
      freshness: "live",
    });
  });

  it("passes the Filter menu's rules and reports them", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      activeInboxTab: ALL_TAB_ID,
      inboxFilter: "r=starred:is_checked&r=starred:is_checked",
    });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listInboxThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: ALL_TAB_ID,
        inboxFilter: "r=starred:is_checked",
      }),
    );
    expect(result.emailList.inboxFilter).toBe("r=starred:is_checked");
  });

  it("keeps the synced inbox's coverage: failed, partial and capped accounts", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({ view: "inbox" });
    mocks.listInboxThreads.mockResolvedValue(
      inboxResult({
        reachedCap: true,
        accounts: [
          {
            accountEmail: OWNER,
            state: "ready",
            reachedCap: true,
            lastSyncedAt: 1,
          },
          {
            accountEmail: "second@example.com",
            state: "initial",
            lastSyncedAt: null,
          },
          {
            accountEmail: "third@example.com",
            state: "needs_reauth",
            lastSyncedAt: 1,
          },
        ],
        read: { freshness: "stale" },
      }),
    );

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.truncated).toBe(true);
    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: ["third@example.com"],
      partialAccounts: [OWNER, "second@example.com"],
      freshness: "stale",
    });
  });

  it("reports a failed inbox read instead of an empty inbox", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({ view: "inbox" });
    mocks.listInboxThreads.mockRejectedValue(
      new Error("Bearer secret-token request failed"),
    );

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.emails).toEqual([]);
    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: [],
      error: "Bearer [redacted] request failed",
    });
  });

  it("searches the inbox through Gmail, as the inbox's search does", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      search: "receipt",
      inboxFilter: "r=unread:is_unchecked",
    });
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    await action.run({});

    expect(mocks.listInboxThreads).not.toHaveBeenCalled();
    expect(mocks.listGmailMessages.mock.calls[0][0]).toBe(
      "in:inbox (receipt) -is:unread",
    );
  });
});

describe("view-screen Mail preview", () => {
  it("uses a bounded read and reports a truncated preview", async () => {
    const messages = Array.from({ length: 11 }, (_, index) =>
      email(`message-${index}`),
    );
    mocks.listGmailMessages.mockResolvedValue({ messages, errors: [] });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "",
      11,
      OWNER,
      undefined,
      expect.objectContaining({ mode: "threads", threadFormat: "metadata" }),
    );
    expect(result.emailList.emails).toHaveLength(10);
    expect(result.emailList.count).toBe(10);
    expect(result.emailList.truncated).toBe(true);
    expect(result.emailList.coverage).toEqual({
      complete: true,
      failedAccounts: [],
    });
  });

  it("reads All Mail through the Starred filter with the old Starred page's Gmail query", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "all",
      inboxFilter: "r=starred:is_checked",
    });
    mocks.listGmailMessages.mockResolvedValue({
      messages: [
        {
          ...email("archived-starred"),
          isStarred: true,
          labelIds: ["STARRED"],
        },
      ],
      errors: [],
    });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages.mock.calls[0][0]).toBe("is:starred");
    expect(result.emailList.inboxFilter).toBe("r=starred:is_checked");
    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["archived-starred"]);
  });

  it("keeps archived starred mail in a local All Mail filtered by Starred", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "all",
      inboxFilter: "r=starred:is_checked",
    });
    mocks.isConnected.mockResolvedValue(false);
    mocks.readLocalEmails.mockResolvedValue([
      { ...email("archived-starred"), isStarred: true, isArchived: true },
      { ...email("inbox-starred"), isStarred: true, labelIds: ["inbox"] },
      { ...email("archived-plain"), isArchived: true },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(
      result.emailList.emails.map((item: { id: string }) => item.id).sort(),
    ).toEqual(["archived-starred", "inbox-starred"]);
  });

  describe("on a conversation with mixed star and read state", () => {
    const mixed = [
      {
        ...email("older"),
        threadId: "thread-mixed",
        date: "2026-09-01T00:00:00.000Z",
        isRead: true,
        isStarred: true,
        labelIds: ["Label_work"],
      },
      {
        ...email("reply"),
        threadId: "thread-mixed",
        date: "2026-09-02T00:00:00.000Z",
        isRead: false,
        isStarred: false,
      },
      {
        ...email("plain"),
        date: "2026-08-01T00:00:00.000Z",
        labelIds: ["Label_work"],
      },
    ];

    it("reports the conversation's flags, not its latest message's", async () => {
      mocks.listGmailMessages.mockResolvedValue({
        messages: mixed,
        errors: [],
      });

      const result = JSON.parse(await action.run({}));

      expect(result.emailList.emails[0]).toMatchObject({
        id: "reply",
        isRead: false,
        isStarred: true,
      });
    });

    it("leaves the conversation out of Starred No on Gmail and on local mail", async () => {
      mocks.readAppStateForCurrentTab.mockResolvedValue({
        view: "all",
        inboxFilter: "r=starred:is_unchecked",
      });
      mocks.listGmailMessages.mockResolvedValue({
        messages: mixed,
        errors: [],
      });

      const gmail = JSON.parse(await action.run({}));
      mocks.isConnected.mockResolvedValue(false);
      mocks.readLocalEmails.mockResolvedValue(mixed);
      const local = JSON.parse(await action.run({}));

      for (const result of [gmail, local]) {
        expect(
          result.emailList.emails.map((item: { id: string }) => item.id),
        ).toEqual(["plain"]);
      }
    });

    it("keeps the label the list shows and sizes Gmail's window to the preview", async () => {
      mocks.readAppStateForCurrentTab.mockResolvedValue({
        view: "all",
        label: "work",
        inboxFilter: "r=starred:is_checked",
      });
      mocks.listGmailMessages.mockResolvedValue({
        messages: mixed,
        errors: [],
      });

      const result = JSON.parse(await action.run({}));

      expect(mocks.listGmailMessages).toHaveBeenCalledWith(
        "label:work is:starred",
        11,
        OWNER,
        undefined,
        expect.objectContaining({ threadCandidateLimit: 40 }),
      );
      expect(result.emailList.label).toBe("work");
      expect(
        result.emailList.emails.map((item: { id: string }) => item.id),
      ).toEqual(["reply"]);
    });

    it("keeps the label on local mail too", async () => {
      mocks.readAppStateForCurrentTab.mockResolvedValue({
        view: "all",
        label: "Label_work",
      });
      mocks.isConnected.mockResolvedValue(false);
      mocks.readLocalEmails.mockResolvedValue(mixed);

      const result = JSON.parse(await action.run({}));

      expect(
        result.emailList.emails.map((item: { id: string }) => item.id),
      ).toEqual(["older", "plain"]);
    });
  });

  it("ignores a filter left on a view without the Filter menu", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "sent",
      inboxFilter: "r=starred:is_checked",
    });
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages.mock.calls[0][0]).toBe("in:sent");
    expect(result.emailList.inboxFilter).toBeNull();
  });

  it("refills when one thread's messages fill the first page", async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) =>
      email(`message-${index}`),
    );
    firstPage.push({ ...email("same-thread"), threadId: "thread-message-0" });
    mocks.listGmailMessages
      .mockResolvedValueOnce({
        messages: firstPage,
        errors: [],
        nextPageTokens: { [OWNER]: "page-2" },
      })
      .mockResolvedValueOnce({
        messages: [email("page-2")],
        errors: [],
      });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(2);
    expect(mocks.listGmailMessages.mock.calls[1]).toEqual([
      "",
      11,
      OWNER,
      { [OWNER]: "page-2" },
      expect.objectContaining({ accountEmails: [OWNER] }),
    ]);
    expect(result.emailList.emails).toHaveLength(10);
    expect(result.emailList.truncated).toBe(true);
  });

  it("reports partial provider coverage separately from truncation", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [email("healthy")],
      errors: [{ email: "failed@example.com", error: "token expired" }],
    });

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: ["failed@example.com"],
    });
    expect(result.emailList.truncated).toBe(false);
  });

  it("reports OAuth refresh failures as partial account coverage", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [{ email: OWNER, error: "refresh failed" }],
    });
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: [OWNER],
    });
  });

  it("reports selected accounts that no longer resolve", async () => {
    const missingAccount = "missing@example.com";
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "all",
      activeAccounts: [missingAccount],
    });
    mocks.getClientsWithErrors.mockResolvedValue({ clients: [], errors: [] });
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: [missingAccount],
    });
  });

  it("returns sanitized context for unexpected preview failures", async () => {
    mocks.readSettings.mockRejectedValue(
      new Error("Bearer secret-token request failed"),
    );

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: [],
      error: "Bearer [redacted] request failed",
    });
  });

  it("caps refill work when every page collapses into one thread", async () => {
    const onePage = (prefix: string) =>
      Array.from({ length: 11 }, (_, index) => ({
        ...email(`${prefix}-${index}`),
        threadId: "one-thread",
      }));
    mocks.listGmailMessages
      .mockResolvedValueOnce({
        messages: onePage("page-1"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-2" },
      })
      .mockResolvedValueOnce({
        messages: onePage("page-2"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-3" },
      })
      .mockResolvedValueOnce({
        messages: onePage("page-3"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-4" },
      });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(3);
    expect(result.emailList.emails).toHaveLength(1);
    expect(result.emailList.truncated).toBe(true);
  });
});
