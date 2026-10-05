import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  setResponseStatus: vi.fn(),
  setResponseHeader: vi.fn(),
  readOwnerGmailCooldowns: vi.fn(),
  countGmailCooldown: vi.fn(),
  readCachedInboxEmails: vi.fn(),
  listInboxEmails: vi.fn(),
  getClientsWithErrors: vi.fn(),
  gmailListLabels: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  createError: (input: unknown) => Object.assign(new Error("h3 error"), input),
  getQuery: () => mocks.query,
  getRouterParam: vi.fn(),
  getHeader: vi.fn(),
  setResponseStatus: mocks.setResponseStatus,
  setResponseHeader: mocks.setResponseHeader,
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: vi.fn(async () => ({ email: OWNER })),
  readBody: vi.fn(),
  getAppProductionUrl: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: vi.fn(async () => [{ accountId: ACCOUNT }]),
  setOAuthDisplayName: vi.fn(),
}));

vi.mock("../lib/gmail-quota.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gmail-quota.js")>()),
  readOwnerGmailCooldowns: mocks.readOwnerGmailCooldowns,
  countGmailCooldown: mocks.countGmailCooldown,
}));

vi.mock("../lib/google-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/google-api.js")>()),
  gmailListLabels: mocks.gmailListLabels,
}));

vi.mock("../lib/google-auth.js", () => ({
  isConnected: vi.fn(async () => true),
  getConnectedAccountsWithErrors: vi.fn(async () => ({
    accounts: [ACCOUNT],
    errors: [],
  })),
  getClientsWithErrors: mocks.getClientsWithErrors,
  getAccountDisplayName: vi.fn(() => "Inbox"),
  setAccountDisplayName: vi.fn(),
  invalidateListCacheForOwner: vi.fn(),
  invalidateHistoryCacheForAccount: vi.fn(),
}));

vi.mock("../lib/cached-inbox-reads.js", () => ({
  readCachedInboxEmails: mocks.readCachedInboxEmails,
}));

vi.mock("../lib/list-inbox-emails.js", () => ({
  listInboxEmails: mocks.listInboxEmails,
}));

vi.mock("../lib/mail-settings.js", () => ({
  readSettings: vi.fn(async () => ({ savedFilters: [] })),
}));

import { GmailQuotaCooldownError } from "../lib/google-api.js";
import { listEmails } from "./emails.js";

const event = {} as never;
const NOW = new Date("2026-10-01T12:00:00.000Z").getTime();

function cachedRows(syncedAt = NOW - 60_000) {
  return {
    emails: [{ id: "m1", threadId: "t1", subject: "Cached" }],
    totalEstimate: 1,
    syncedAt,
  };
}

describe("listEmails during a Gmail cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.query = { view: "inbox" };
    mocks.readOwnerGmailCooldowns.mockResolvedValue(new Map());
    mocks.readCachedInboxEmails.mockResolvedValue(cachedRows());
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: ACCOUNT, accessToken: "token", refreshToken: "" }],
      errors: [],
    });
    mocks.gmailListLabels.mockResolvedValue({ labels: [] });
    mocks.listInboxEmails.mockResolvedValue({
      ok: true,
      emails: [{ id: "live", threadId: "live-thread" }],
      errors: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the synced inbox store as cached data, with no Gmail or token work", async () => {
    const until = NOW + 45_000;
    mocks.query = { view: "unread" };
    mocks.readOwnerGmailCooldowns.mockResolvedValue(
      new Map([[ACCOUNT, until]]),
    );

    const body: any = await (listEmails as any)(event);

    expect(body.emails).toEqual(cachedRows().emails);
    expect(body.read).toEqual({
      freshness: "cached",
      staleSince: NOW - 60_000,
      cooldownUntil: until,
      retryAfterMs: 45_000,
    });
    expect(body.error).toBeUndefined();
    expect(mocks.setResponseStatus).not.toHaveBeenCalled();
    expect(mocks.getClientsWithErrors).not.toHaveBeenCalled();
    expect(mocks.gmailListLabels).not.toHaveBeenCalled();
    expect(mocks.listInboxEmails).not.toHaveBeenCalled();
    expect(mocks.readCachedInboxEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "unread",
        accountEmails: [ACCOUNT],
      }),
    );
    expect(mocks.countGmailCooldown).toHaveBeenCalledTimes(1);
    expect(mocks.countGmailCooldown).toHaveBeenCalledWith(
      "served_cached",
      "cached",
    );
  });

  it("reports old cached rows as stale", async () => {
    mocks.readOwnerGmailCooldowns.mockResolvedValue(
      new Map([[ACCOUNT, NOW + 5_000]]),
    );
    mocks.readCachedInboxEmails.mockResolvedValue(
      cachedRows(NOW - 30 * 60_000),
    );

    const body: any = await (listEmails as any)(event);

    expect(body.read.freshness).toBe("stale");
    expect(mocks.countGmailCooldown).toHaveBeenCalledWith(
      "served_cached",
      "stale",
    );
  });

  it("answers a view the store cannot serve with a typed 429, not an empty list", async () => {
    mocks.query = { view: "drafts" };
    mocks.readOwnerGmailCooldowns.mockResolvedValue(
      new Map([[ACCOUNT, NOW + 45_000]]),
    );
    mocks.readCachedInboxEmails.mockResolvedValue(null);

    const body: any = await (listEmails as any)(event);

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 429);
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      event,
      "Retry-After",
      "45",
    );
    expect(body).toMatchObject({
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 45_000,
      cooldownUntil: NOW + 45_000,
    });
    expect(body.emails).toBeUndefined();
    expect(mocks.listInboxEmails).not.toHaveBeenCalled();
    expect(mocks.countGmailCooldown).toHaveBeenCalledTimes(1);
    expect(mocks.countGmailCooldown).toHaveBeenCalledWith("typed_429");
  });

  it("does not serve page one again for a later page", async () => {
    mocks.query = { view: "inbox", pageToken: "next-page" };
    mocks.readOwnerGmailCooldowns.mockResolvedValue(
      new Map([[ACCOUNT, NOW + 45_000]]),
    );

    const body: any = await (listEmails as any)(event);

    expect(mocks.readCachedInboxEmails).not.toHaveBeenCalled();
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 429);
    expect(body.errorCode).toBe("gmail_quota_cooldown");
  });

  it("answers a live Gmail quota failure from the store instead of a bare 429", async () => {
    mocks.listInboxEmails.mockResolvedValue({
      ok: false,
      isQuotaError: true,
      retryAfterSeconds: 30,
      message: "busy",
    });

    const body: any = await (listEmails as any)(event);

    expect(body.emails).toEqual(cachedRows().emails);
    expect(body.read).toMatchObject({
      freshness: "cached",
      cooldownUntil: NOW + 30_000,
      retryAfterMs: 30_000,
    });
    expect(mocks.setResponseStatus).not.toHaveBeenCalled();
  });

  it("answers a thrown cooldown from token resolution the same way", async () => {
    mocks.getClientsWithErrors.mockRejectedValue(
      new GmailQuotaCooldownError(20_000),
    );

    const body: any = await (listEmails as any)(event);

    expect(body.read).toMatchObject({
      freshness: "cached",
      cooldownUntil: NOW + 20_000,
    });
  });

  it("does not cache an empty label map after a label read hit the cooldown", async () => {
    const labelsAccount = "labels@example.com";
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        { email: labelsAccount, accessToken: "token", refreshToken: "" },
      ],
      errors: [],
    });
    mocks.gmailListLabels
      .mockRejectedValueOnce(new GmailQuotaCooldownError(20_000))
      .mockResolvedValueOnce({ labels: [{ id: "Label_1", name: "Pylon" }] });

    await (listEmails as any)(event);
    await (listEmails as any)(event);

    // The second request asks Gmail again instead of reusing the failed read.
    expect(mocks.gmailListLabels).toHaveBeenCalledTimes(2);
    const secondCall = mocks.listInboxEmails.mock.calls[1]?.[0];
    expect(secondCall.labelMap.get("Label_1")).toBe("Pylon");
  });

  it("goes live again once the cooldown window has passed, and for a partial cooldown", async () => {
    // One of two accounts cooling down: a live read can still succeed.
    mocks.readOwnerGmailCooldowns.mockResolvedValue(
      new Map([["other@example.com", NOW + 45_000]]),
    );
    const partial: any = await (listEmails as any)(event);
    expect(partial.emails).toEqual([{ id: "live", threadId: "live-thread" }]);
    expect(partial.read).toBeUndefined();

    // The window has passed: nothing is cooling down.
    mocks.readOwnerGmailCooldowns.mockResolvedValue(new Map());
    const recovered: any = await (listEmails as any)(event);
    expect(recovered.emails).toEqual([{ id: "live", threadId: "live-thread" }]);
    expect(mocks.readCachedInboxEmails).not.toHaveBeenCalled();
  });
});
