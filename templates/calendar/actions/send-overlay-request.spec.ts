import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const isEmailConfiguredMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const mutateUserSettingMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const selectRowsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
  isEmailConfigured: isEmailConfiguredMock,
  sendEmail: sendEmailMock,
  toAbsoluteOpenUrl: (path: string) => `https://example.com${path}`,
  getAppProductionUrl: () => "https://example.com",
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  mutateUserSetting: mutateUserSettingMock,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));
const renderOverlayRequestEmailMock = vi.hoisted(() =>
  vi.fn(() => ({
    subject: "sample subject",
    html: "<p>sample</p>",
    text: "sample",
  })),
);
vi.mock("../server/lib/overlay-request-emails.js", () => ({
  renderOverlayRequestEmail: renderOverlayRequestEmailMock,
}));
vi.mock("../server/lib/emails.js", () => ({
  CALENDAR_OVERLAY_REQUEST_EMAIL_ID: "calendar.overlay-request",
}));
vi.mock("../server/lib/booking-og-image.js", () => ({
  displayNameFromIdentifier: (_name: unknown, email: string) => email,
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    bookingLinks: { id: "id", ownerEmail: "ownerEmail", hosts: "hosts" },
  },
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => selectRowsMock() }) }),
  }),
}));

import action from "./send-overlay-request";

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const PEER = "peer@example.com";
const OTHER_PEER = "other@example.com";
const REQUESTS_KEY = "calendar-overlay-requests";

type StoredState = {
  perPeer: Record<string, string>;
  dailyCounts: Record<string, number>;
};

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Record<string, unknown>
  >;
}

function settings(requests: Record<string, string> | null = null) {
  return async (email: string, key: string) => {
    if (key === "calendar-overlay-people") {
      return { people: [{ email: PEER, color: "#fff" }] };
    }
    if (key === REQUESTS_KEY) return requests;
    return null;
  };
}

let requestsStore: Record<string, StoredState | null>;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function seedRequests(perPeer: Record<string, string> | null) {
  requestsStore[OWNER] = perPeer ? { perPeer, dailyCounts: {} } : null;
}

function seedState(state: StoredState) {
  requestsStore[OWNER] = state;
}

async function waitForReservation() {
  for (let i = 0; i < 50 && !requestsStore[OWNER]?.perPeer?.[PEER]; i++) {
    await Promise.resolve();
  }
}

describe("send-overlay-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestsStore = {};
    getRequestUserEmailMock.mockReturnValue(OWNER);
    isEmailConfiguredMock.mockResolvedValue(true);
    sendEmailMock.mockResolvedValue(undefined);
    assertAccessMock.mockResolvedValue({ role: "editor" });
    mutateUserSettingMock.mockImplementation(
      async (
        email: string,
        key: string,
        updater: (current: unknown) => unknown,
      ) => {
        const current =
          key === REQUESTS_KEY ? (requestsStore[email] ?? null) : null;
        const next = await updater(current);
        if (key === REQUESTS_KEY) {
          requestsStore[email] = next as StoredState;
        }
        return next;
      },
    );
    getUserSettingMock.mockImplementation(settings());
    selectRowsMock.mockResolvedValue([
      { ownerEmail: OWNER, hosts: JSON.stringify([{ email: PEER }]) },
    ]);
  });

  it("rejects an email that is not in the owner's overlay list", async () => {
    await expect(run({ email: OTHER_PEER })).rejects.toThrow(
      "not in the owner's calendar overlay list",
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends and records the timestamp on success", async () => {
    const result = await run({ email: PEER });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
      to: PEER,
      replyTo: OWNER,
    });
    expect(result.emailSent).toBe(true);
    expect(typeof result.requestSentAt).toBe("string");
    expect(requestsStore[OWNER]?.perPeer?.[PEER]).toBe(result.requestSentAt);
    expect(requestsStore[OWNER]?.dailyCounts?.[todayKey()]).toBe(1);

    expect(renderOverlayRequestEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appLink: `https://example.com/shared-availability/add?email=${encodeURIComponent(OWNER)}`,
      }),
    );
  });

  it("returns the existing timestamp without resending inside the cooldown", async () => {
    const sentAt = new Date(Date.now() - 60_000).toISOString();
    seedRequests({ [PEER]: sentAt });

    const result = await run({ email: PEER });

    expect(result).toEqual({
      email: PEER,
      requestSentAt: sentAt,
      emailSent: false,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("blocks a concurrent send while one is already in flight for the same peer", async () => {
    let releaseSend: () => void = () => {};
    sendEmailMock.mockImplementation(
      () => new Promise<void>((resolve) => (releaseSend = resolve)),
    );

    const first = run({ email: PEER });
    await waitForReservation();

    const second = await run({ email: PEER });
    expect(second).toEqual({
      email: PEER,
      requestSentAt: null,
      emailSent: false,
      skippedReason: "send-in-progress",
    });

    releaseSend();
    const firstResult = await first;
    expect(firstResult.emailSent).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale reservation clobber a newer one that reclaimed the slot", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);

    let releaseFirstSend: () => void = () => {};
    sendEmailMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFirstSend = resolve)),
    );

    const first = run({ email: PEER });
    await waitForReservation();

    vi.setSystemTime(start + 3 * 60 * 1000);
    sendEmailMock.mockResolvedValueOnce(undefined);
    const second = await run({ email: PEER });
    expect(second.emailSent).toBe(true);
    const secondTimestamp = requestsStore[OWNER]?.perPeer?.[PEER];
    expect(secondTimestamp).toBeDefined();

    releaseFirstSend();
    const firstResult = await first;
    expect(firstResult.emailSent).toBe(true);
    expect(requestsStore[OWNER]?.perPeer?.[PEER]).toBe(secondTimestamp);

    vi.useRealTimers();
  });

  it("rejects sending to a peer who has already added the owner back", async () => {
    getUserSettingMock.mockImplementation(
      async (email: string, key: string) => {
        if (key !== "calendar-overlay-people") return null;
        if (email === OWNER)
          return { people: [{ email: PEER, color: "#fff" }] };
        if (email === PEER)
          return { people: [{ email: OWNER, color: "#fff" }] };
        return null;
      },
    );

    await expect(run({ email: PEER })).rejects.toThrow(
      "already added the owner back",
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
  });

  it("releases the reservation when the email send fails, allowing a retry", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("smtp down"));

    await expect(run({ email: PEER })).rejects.toThrow("smtp down");
    expect(requestsStore[OWNER]?.perPeer?.[PEER]).toBeUndefined();
    expect(requestsStore[OWNER]?.dailyCounts?.[todayKey()]).toBe(0);

    sendEmailMock.mockResolvedValueOnce(undefined);
    const retry = await run({ email: PEER });
    expect(retry.emailSent).toBe(true);
    expect(requestsStore[OWNER]?.dailyCounts?.[todayKey()]).toBe(1);
  });

  it("resends once the cooldown has elapsed", async () => {
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    seedRequests({ [PEER]: sentAt });

    const result = await run({ email: PEER });

    expect(result.emailSent).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("counts every resend to the same peer against the daily cap, not just distinct peers", async () => {
    seedState({ perPeer: {}, dailyCounts: { [todayKey()]: 19 } });
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    requestsStore[OWNER]!.perPeer[PEER] = sentAt;

    const first = await run({ email: PEER });
    expect(first.emailSent).toBe(true);
    expect(requestsStore[OWNER]?.dailyCounts?.[todayKey()]).toBe(20);

    requestsStore[OWNER]!.perPeer[PEER] = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    await expect(run({ email: PEER })).rejects.toThrow(
      "Too many calendar-access requests sent today",
    );
  });

  it("rejects once the daily cap is reached", async () => {
    seedState({ perPeer: {}, dailyCounts: { [todayKey()]: 20 } });

    await expect(run({ email: PEER })).rejects.toThrow(
      "Too many calendar-access requests sent today",
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports email-not-configured explicitly instead of a fake success", async () => {
    isEmailConfiguredMock.mockResolvedValue(false);

    const result = await run({ email: PEER });

    expect(result).toEqual({
      email: PEER,
      requestSentAt: null,
      emailSent: false,
      skippedReason: "email-not-configured",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
  });

  it("prunes entries older than a day when recording a new one", async () => {
    const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    seedRequests({ "stale@example.com": stale });

    await run({ email: PEER });

    expect(
      requestsStore[OWNER]?.perPeer?.["stale@example.com"],
    ).toBeUndefined();
    expect(requestsStore[OWNER]?.perPeer?.[PEER]).toBeDefined();
  });

  it("resolves owner identity from the row for a shared editor", async () => {
    getRequestUserEmailMock.mockReturnValue(EDITOR);

    await run({ email: PEER, bookingLinkId: "link-1" });

    expect(assertAccessMock).toHaveBeenCalledWith(
      "booking-link",
      "link-1",
      "editor",
    );
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ replyTo: OWNER });
  });

  it("rejects a shared editor's request for an email not on this link's hosts", async () => {
    getRequestUserEmailMock.mockReturnValue(EDITOR);
    getUserSettingMock.mockImplementation(async (email, key) => {
      if (key === "calendar-overlay-people") {
        return {
          people: [
            { email: PEER, color: "#fff" },
            { email: OTHER_PEER, color: "#fff" },
          ],
        };
      }
      return null;
    });

    await expect(
      run({ email: OTHER_PEER, bookingLinkId: "link-1" }),
    ).rejects.toThrow("not a host on this booking link");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not scope to link hosts when the caller is the owner", async () => {
    getUserSettingMock.mockImplementation(async (email, key) => {
      if (key === "calendar-overlay-people") {
        return {
          people: [
            { email: PEER, color: "#fff" },
            { email: OTHER_PEER, color: "#fff" },
          ],
        };
      }
      return null;
    });

    const result = await run({
      email: OTHER_PEER,
      bookingLinkId: "link-1",
    });

    expect(result.emailSent).toBe(true);
  });
});
