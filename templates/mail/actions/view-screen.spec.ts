import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppStateForCurrentTab: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  readLocalEmails: vi.fn(),
  readSettings: vi.fn(),
  readInboxThreads: vi.fn(),
  readCachedLabels: vi.fn(),
  isConnected: vi.fn(),
  getClientsWithErrors: vi.fn(),
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT: 100,
  fetchGmailLabelMap: vi.fn(),
  listGmailMessages: vi.fn(),
  gmailToEmailMessage: vi.fn(),
  getSyntheticEmailsForView: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/inbox-store.js", () => ({
  inboxRowToItem: (row: any) => row,
  readCachedLabels: mocks.readCachedLabels,
  readInboxThreads: mocks.readInboxThreads,
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
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT:
    mocks.DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT,
  fetchGmailLabelMap: mocks.fetchGmailLabelMap,
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

import { ALL_TAB_PARAM } from "../shared/inbox-threads.js";
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAppStateForCurrentTab.mockResolvedValue({ view: "inbox" });
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.getUserSetting.mockResolvedValue({ labels: [] });
  mocks.readLocalEmails.mockResolvedValue([]);
  mocks.readInboxThreads.mockResolvedValue([]);
  mocks.readCachedLabels.mockResolvedValue({
    labels: [],
    labelMapByAccount: new Map(),
  });
  mocks.readSettings.mockResolvedValue({ savedFilters: [], pinnedLabels: [] });
  mocks.isConnected.mockResolvedValue(true);
  mocks.getClientsWithErrors.mockResolvedValue({
    clients: [{ email: OWNER, accessToken: "access-token", refreshToken: "" }],
    errors: [],
  });
  mocks.fetchGmailLabelMap.mockResolvedValue(new Map());
  mocks.getSyntheticEmailsForView.mockResolvedValue([]);
  mocks.gmailToEmailMessage.mockImplementation((raw: any) => raw);
});

describe("view-screen Mail preview", () => {
  it("uses a bounded read and reports a truncated preview", async () => {
    const messages = Array.from({ length: 11 }, (_, index) =>
      email(`message-${index}`),
    );
    mocks.listGmailMessages.mockResolvedValue({ messages, errors: [] });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "in:inbox",
      11,
      OWNER,
      undefined,
      expect.objectContaining({
        mode: "threads",
        threadFormat: "metadata",
        threadRecentMessageCandidateLimit: 100,
      }),
    );
    expect(mocks.fetchGmailLabelMap).not.toHaveBeenCalled();
    expect(result.emailList.emails).toHaveLength(10);
    expect(result.emailList.count).toBe(10);
    expect(result.emailList.truncated).toBe(true);
    expect(result.emailList.coverage).toEqual({
      complete: true,
      failedAccounts: [],
    });
  });

  it("keeps the default All preview inclusive of triage and saved-filter mail", async () => {
    mocks.readSettings.mockResolvedValue({
      savedFilters: [{ id: "read", name: "Read", query: "is:read" }],
      pinnedLabels: ["important"],
    });
    mocks.listGmailMessages.mockResolvedValue({
      messages: [email("important"), email("ordinary")],
      errors: [],
    });

    const result = JSON.parse(await action.run({}));

    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["important", "ordinary"]);
  });

  it("reads local-only All snapshots from the authenticated owner's mailbox", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      tab: ALL_TAB_PARAM,
      activeInboxTab: ALL_TAB_PARAM,
    });
    mocks.isConnected.mockResolvedValue(false);
    mocks.readSettings.mockResolvedValue({
      showAllTab: true,
      savedFilters: [],
      pinnedLabels: [],
    });
    mocks.readLocalEmails.mockResolvedValue([email("local-inbox-message")]);

    const result = JSON.parse(await action.run({}));

    expect(mocks.readLocalEmails).toHaveBeenCalledWith(OWNER);
    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["local-inbox-message"]);
    expect(
      result.emailList.tabs.find(
        (tab: { id: string }) => tab.id === "__inbox_all__",
      )?.total,
    ).toBe(1);
    expect(mocks.readInboxThreads).not.toHaveBeenCalled();
  });

  it("matches local saved-filter tabs against the latest inbox thread message", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      activeInboxTab: "owner-replied",
    });
    mocks.isConnected.mockResolvedValue(false);
    mocks.readSettings.mockResolvedValue({
      showAllTab: true,
      savedFilters: [
        {
          id: "owner-replied",
          name: "My replies",
          query: `from:${OWNER}`,
        },
      ],
      pinnedLabels: [],
    });
    mocks.readLocalEmails.mockResolvedValue([
      {
        ...email("received"),
        threadId: "mixed-thread",
        labelIds: ["inbox"],
        date: "2026-09-01T00:00:00.000Z",
      },
      {
        ...email("reply"),
        threadId: "mixed-thread",
        from: { name: "Owner", email: OWNER },
        isSent: true,
        labelIds: ["sent"],
        date: "2026-09-02T00:00:00.000Z",
      },
    ]);

    const result = JSON.parse(await action.run({}));

    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["reply"]);
    expect(
      result.emailList.tabs.find(
        (tab: { id: string }) => tab.id === "owner-replied",
      )?.total,
    ).toBe(1);
  });

  it("keeps saved-filter inbox tab snapshots scoped to inbox mail", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      activeInboxTab: "read",
    });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [{ id: "read", name: "Read", query: "is:read" }],
      pinnedLabels: ["important"],
    });
    const inboxMessage = { ...email("inbox-match"), labelIds: ["INBOX"] };
    const archivedMessage = email("archived-match");
    mocks.listGmailMessages.mockImplementation(async (query: string) => ({
      messages: query.includes("in:inbox")
        ? [inboxMessage]
        : [inboxMessage, archivedMessage],
      errors: [],
    }));

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages.mock.calls[0][0]).toBe("in:inbox is:read");
    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["inbox-match"]);
  });

  it("uses the visible fallback tab when hidden All is requested", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      tab: ALL_TAB_PARAM,
      activeInboxTab: ALL_TAB_PARAM,
    });
    mocks.readSettings.mockResolvedValue({
      showAllTab: false,
      savedFilters: [],
      pinnedLabels: ["important"],
    });
    mocks.listGmailMessages.mockResolvedValue({
      messages: [
        { ...email("important"), labelIds: ["agent-native-important"] },
        email("ordinary"),
      ],
      errors: [],
    });

    const result = JSON.parse(await action.run({}));

    expect(
      result.emailList.emails.map((item: { id: string }) => item.id),
    ).toEqual(["important"]);
  });

  it("refills after inbox filtering removes the provider sentinel", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      label: "important",
    });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [],
      pinnedLabels: ["important"],
    });
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      ...email(`important-${index}`),
      labelIds: ["important"],
    }));
    firstPage.push(email("filtered-sentinel"));
    mocks.listGmailMessages
      .mockResolvedValueOnce({
        messages: firstPage,
        errors: [],
        nextPageTokens: { [OWNER]: "page-2" },
      })
      .mockResolvedValueOnce({
        messages: [{ ...email("important-page-2"), labelIds: ["important"] }],
        errors: [],
      });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(2);
    expect(mocks.listGmailMessages.mock.calls[1]).toEqual([
      "in:inbox",
      11,
      OWNER,
      { [OWNER]: "page-2" },
      expect.objectContaining({
        accountEmails: [OWNER],
        threadRecentMessageCandidateLimit: 100,
      }),
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

  it("reports label-map failures as partial account coverage", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      label: "important",
    });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [],
      pinnedLabels: ["important"],
    });
    mocks.fetchGmailLabelMap.mockRejectedValue(
      new Error("label request failed"),
    );
    mocks.listGmailMessages.mockResolvedValue({
      messages: [email("message")],
      errors: [],
    });

    const result = JSON.parse(await action.run({}));

    expect(result.emailList.coverage).toEqual({
      complete: false,
      failedAccounts: [OWNER],
    });
  });

  it("limits label-map reads to the active account selection", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      label: "important",
      activeAccounts: [OWNER.toUpperCase()],
    });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [],
      pinnedLabels: ["important"],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: OWNER, accessToken: "owner-token", refreshToken: "" }],
      errors: [],
    });
    mocks.listGmailMessages.mockResolvedValue({
      messages: [email("message")],
      errors: [],
    });

    await action.run({});

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(OWNER, [OWNER]);
    expect(mocks.fetchGmailLabelMap).toHaveBeenCalledOnce();
    expect(mocks.fetchGmailLabelMap).toHaveBeenCalledWith("owner-token");
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
      view: "inbox",
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

  it("does not read label maps for saved filters outside Inbox", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({ view: "sent" });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [{ id: "filter", query: "from:sender@example.com" }],
      pinnedLabels: [],
    });
    mocks.listGmailMessages.mockResolvedValue({
      messages: [email("message")],
      errors: [],
    });

    const result = JSON.parse(await action.run({}));

    expect(mocks.fetchGmailLabelMap).not.toHaveBeenCalled();
    expect(result.emailList.coverage).toEqual({
      complete: true,
      failedAccounts: [],
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

  it("caps refill work for a sparse filtered partition", async () => {
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      view: "inbox",
      label: "important",
    });
    mocks.readSettings.mockResolvedValue({
      savedFilters: [],
      pinnedLabels: ["important"],
    });
    const sparsePage = (prefix: string) =>
      Array.from({ length: 11 }, (_, index) => email(`${prefix}-${index}`));
    mocks.listGmailMessages
      .mockResolvedValueOnce({
        messages: sparsePage("page-1"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-2" },
      })
      .mockResolvedValueOnce({
        messages: sparsePage("page-2"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-3" },
      })
      .mockResolvedValueOnce({
        messages: sparsePage("page-3"),
        errors: [],
        nextPageTokens: { [OWNER]: "page-4" },
      });

    const result = JSON.parse(await action.run({}));

    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(3);
    expect(result.emailList.emails).toHaveLength(0);
    expect(result.emailList.truncated).toBe(true);
  });
});
