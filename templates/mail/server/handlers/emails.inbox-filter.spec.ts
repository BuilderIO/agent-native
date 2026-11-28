import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@example.com";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  isConnected: vi.fn(),
  readLocalEmails: vi.fn(),
  listInboxEmails: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  createError: (input: unknown) => Object.assign(new Error("h3 error"), input),
  getQuery: () => mocks.query,
  getRouterParam: vi.fn(),
  getHeader: vi.fn(),
  setResponseStatus: mocks.setResponseStatus,
  setResponseHeader: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: vi.fn(async () => ({ email: OWNER })),
  readBody: vi.fn(),
  getAppProductionUrl: vi.fn(),
}));

vi.mock("../lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  getConnectedAccountsWithErrors: vi.fn(async () => ({
    accounts: [OWNER],
    errors: [],
  })),
  getClientsWithErrors: vi.fn(async () => ({
    clients: [{ email: OWNER, accessToken: "token", refreshToken: "" }],
    errors: [],
  })),
  invalidateListCacheForOwner: vi.fn(),
  invalidateHistoryCacheForAccount: vi.fn(),
}));

vi.mock("../lib/gmail-quota.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gmail-quota.js")>()),
  readOwnerGmailCooldowns: vi.fn(async () => new Map()),
}));

vi.mock("../lib/google-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/google-api.js")>()),
  gmailListLabels: vi.fn(async () => ({ labels: [] })),
}));

vi.mock("../lib/local-email-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/local-email-store.js")>()),
  readLocalEmails: mocks.readLocalEmails,
}));

vi.mock("../lib/list-inbox-emails.js", () => ({
  listInboxEmails: mocks.listInboxEmails,
}));

vi.mock("../lib/jobs.js", () => ({
  getSyntheticEmailsForView: vi.fn(async () => []),
  getSnoozedThreadIds: vi.fn(async () => new Set()),
}));

vi.mock("../lib/mail-settings.js", () => ({
  readSettings: vi.fn(async () => ({ savedFilters: [] })),
}));

import { listEmails } from "./emails.js";

const SAME_OR_NEITHER =
  "match=any&g=1:all&r=1/unread:is_checked&r=1/starred:is_checked&g=2:all&r=2/unread:is_unchecked&r=2/starred:is_unchecked";

function message(
  id: string,
  subject: string,
  flags: { isRead: boolean; isStarred: boolean; isArchived?: boolean },
) {
  return {
    id,
    threadId: `thread-${id}`,
    accountEmail: OWNER,
    from: { name: "Ada", email: "ada@example.com" },
    to: [{ name: "Owner", email: OWNER }],
    subject,
    snippet: "",
    body: "",
    date: `2026-11-0${id.length}T00:00:00.000Z`,
    labelIds: [],
    isDraft: false,
    isSent: false,
    isTrashed: false,
    isArchived: flags.isArchived ?? false,
    ...flags,
  };
}

const event = {} as Parameters<typeof listEmails>[0];

async function listIds(query: Record<string, string>) {
  mocks.query = query;
  return (await listEmails(event)) as {
    emails?: Array<{ id: string }>;
    errorCode?: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConnected.mockResolvedValue(false);
  mocks.readLocalEmails.mockResolvedValue([
    message("both", "Invoice", { isRead: false, isStarred: true }),
    message("unread", "Receipt", { isRead: false, isStarred: false }),
    message("starred", "Invoice", {
      isRead: true,
      isStarred: true,
      isArchived: true,
    }),
    message("neither", "Invoice", { isRead: true, isStarred: false }),
  ]);
  mocks.listInboxEmails.mockResolvedValue({
    ok: true,
    emails: [],
    errors: [],
  });
});

describe("listEmails with an inbox filter, on local mail", () => {
  it("keeps only the flag pairs an OR of AND groups names", async () => {
    const body = await listIds({ view: "all", inboxFilter: SAME_OR_NEITHER });

    expect(body.emails?.map((email) => email.id).sort()).toEqual([
      "both",
      "neither",
    ]);
  });

  it("applies the filter to every alternative of an OR search", async () => {
    const body = await listIds({
      view: "all",
      q: "subject:invoice OR subject:receipt",
      inboxFilter: "r=unread:is_checked",
    });

    expect(body.emails?.map((email) => email.id).sort()).toEqual([
      "both",
      "unread",
    ]);
  });

  it("keeps archived starred mail in All Mail filtered by Starred", async () => {
    const body = await listIds({
      view: "all",
      inboxFilter: "r=starred:is_checked",
    });

    expect(body.emails?.map((email) => email.id).sort()).toEqual([
      "both",
      "starred",
    ]);
  });

  it("rejects a filter it can only partly read instead of listing more mail", async () => {
    for (const inboxFilter of [
      "r=unread:is_checked&r=unknown:is_checked",
      "match=all&match=any&r=unread:is_checked&r=starred:is_checked",
    ]) {
      mocks.setResponseStatus.mockClear();
      const body = await listIds({ view: "all", inboxFilter });

      expect(body.errorCode).toBe("invalid_inbox_filter");
      expect(body.emails).toBeUndefined();
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400);
    }
  });

  describe("on a conversation with mixed star and read state", () => {
    beforeEach(() => {
      mocks.readLocalEmails.mockResolvedValue([
        {
          ...message("older", "Plan", { isRead: true, isStarred: true }),
          threadId: "thread-mixed",
          date: "2026-11-01T00:00:00.000Z",
        },
        {
          ...message("reply", "Re: Plan", { isRead: false, isStarred: false }),
          threadId: "thread-mixed",
          date: "2026-11-02T00:00:00.000Z",
        },
        message("plain", "Notes", { isRead: true, isStarred: false }),
      ]);
    });

    it("leaves the conversation out of Starred No and Unread No", async () => {
      for (const inboxFilter of [
        "r=starred:is_unchecked",
        "r=unread:is_unchecked",
      ]) {
        const body = await listIds({ view: "all", inboxFilter });
        expect(body.emails?.map((email) => email.id)).toEqual(["plain"]);
      }
    });

    it("keeps every message of the conversation under Starred Yes", async () => {
      const body = await listIds({
        view: "all",
        inboxFilter: "r=starred:is_checked",
      });

      expect(body.emails?.map((email) => email.id)).toEqual(["reply", "older"]);
    });

    it("judges a search hit by its whole conversation", async () => {
      const body = await listIds({
        view: "all",
        q: "subject:re",
        inboxFilter: "r=starred:is_checked",
      });

      expect(body.emails?.map((email) => email.id)).toEqual(["reply"]);
    });
  });
});

describe("listEmails with an inbox filter, on Gmail", () => {
  it("hands the filter to the Gmail read separately from the search", async () => {
    mocks.isConnected.mockResolvedValue(true);

    await listIds({
      view: "all",
      q: "ada@example.com",
      inboxFilter: "r=unread:is_checked",
    });

    expect(mocks.listInboxEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "all",
        q: "ada@example.com",
        inboxFilter: "r=unread:is_checked",
      }),
    );
  });
});
