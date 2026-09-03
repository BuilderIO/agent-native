import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getSetting: vi.fn(),
  readSettings: vi.fn(),
  isConnected: vi.fn(),
  getClients: vi.fn(),
  fetchGmailLabelMap: vi.fn(),
  listGmailMessages: vi.fn(),
  gmailToEmailMessage: vi.fn(),
  getSyntheticEmailsForView: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
}));

vi.mock("../server/lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  getClients: mocks.getClients,
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
  mocks.readAppState.mockResolvedValue({ view: "inbox" });
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.getSetting.mockResolvedValue(null);
  mocks.readSettings.mockResolvedValue({ savedFilters: [], pinnedLabels: [] });
  mocks.isConnected.mockResolvedValue(true);
  mocks.getClients.mockResolvedValue([
    { email: OWNER, accessToken: "access-token", refreshToken: "" },
  ]);
  mocks.fetchGmailLabelMap.mockResolvedValue(new Map());
  mocks.getSyntheticEmailsForView.mockResolvedValue([]);
  mocks.gmailToEmailMessage.mockImplementation((raw: any) => raw);
});

describe("view-screen Mail preview", () => {
  it("uses a bounded cheap read and reports a truncated preview", async () => {
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
        threadRecentMessageCandidateLimit: undefined,
      }),
    );
    expect(mocks.fetchGmailLabelMap).not.toHaveBeenCalled();
    expect(result.emailList.emails).toHaveLength(10);
    expect(result.emailList.count).toBe(10);
    expect(result.emailList.truncated).toBe(true);
  });
});
