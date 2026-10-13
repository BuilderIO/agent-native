import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const getHostOverlayStatusesMock = vi.hoisted(() => vi.fn());
const selectRowsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));
vi.mock("../server/lib/booking-host-availability.js", () => ({
  getHostOverlayStatuses: getHostOverlayStatusesMock,
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    bookingLinks: { id: "id", ownerEmail: "ownerEmail", hosts: "hosts" },
  },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => selectRowsMock(),
      }),
    }),
  }),
}));

import action from "./get-host-overlay-status";

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const PEER = "peer@example.com";
const OTHER_PEER = "other@example.com";

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Array<Record<string, unknown>>
  >;
}

function status(email: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    isOverlaidByOwner: true,
    reciprocal: true,
    hasWorkingHours: true,
    timezone: "Europe/Berlin",
    displayName: "Peer",
    ...overrides,
  };
}

describe("get-host-overlay-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue(OWNER);
    getUserSettingMock.mockResolvedValue(null);
    assertAccessMock.mockResolvedValue({ role: "editor" });
    getHostOverlayStatusesMock.mockResolvedValue([]);
    selectRowsMock.mockResolvedValue([
      { ownerEmail: OWNER, hosts: JSON.stringify([{ email: PEER }]) },
    ]);
  });

  it("throws when there is no authenticated caller", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);

    await expect(run({ emails: [PEER] })).rejects.toThrow(
      "no authenticated user",
    );
  });

  it("uses the caller as owner for a brand-new unsaved draft", async () => {
    await run({ emails: [PEER] });

    expect(assertAccessMock).not.toHaveBeenCalled();
    expect(getHostOverlayStatusesMock).toHaveBeenCalledWith(OWNER, [PEER]);
  });

  it("resolves the owner from the row rather than the caller", async () => {
    getRequestUserEmailMock.mockReturnValue(EDITOR);

    await run({ emails: [PEER], bookingLinkId: "link-1" });

    expect(getHostOverlayStatusesMock).toHaveBeenCalledWith(OWNER, [PEER]);
  });

  it("requires editor access, never mere viewer access", async () => {
    await run({ emails: [PEER], bookingLinkId: "link-1" });

    expect(assertAccessMock).toHaveBeenCalledWith(
      "booking-link",
      "link-1",
      "editor",
    );
  });

  it("rejects a caller who only has public viewer access", async () => {
    getRequestUserEmailMock.mockReturnValue("stranger@example.com");
    assertAccessMock.mockRejectedValue(
      new Error("Requires editor role on booking-link link-1 (have viewer)"),
    );

    await expect(
      run({ emails: [PEER], bookingLinkId: "link-1" }),
    ).rejects.toThrow("Requires editor role");
    expect(getHostOverlayStatusesMock).not.toHaveBeenCalled();
  });

  it("scopes requested emails to the link's own hosts for a non-owner caller", async () => {
    getRequestUserEmailMock.mockReturnValue(EDITOR);

    await run({ emails: [PEER, OTHER_PEER], bookingLinkId: "link-1" });

    expect(getHostOverlayStatusesMock).toHaveBeenCalledWith(OWNER, [PEER]);
  });

  it("does not scope to link hosts when the caller is the owner", async () => {
    await run({ emails: [PEER, OTHER_PEER], bookingLinkId: "link-1" });

    expect(getHostOverlayStatusesMock).toHaveBeenCalledWith(OWNER, [
      PEER,
      OTHER_PEER,
    ]);
  });

  it("attaches requestSentAt and strips isOverlaidByOwner", async () => {
    getHostOverlayStatusesMock.mockResolvedValue([status(PEER)]);
    getUserSettingMock.mockResolvedValue({
      [PEER]: "2026-09-01T10:00:00.000Z",
    });

    const result = await run({ emails: [PEER] });

    expect(result).toEqual([
      {
        email: PEER,
        reciprocal: true,
        hasWorkingHours: true,
        timezone: "Europe/Berlin",
        displayName: "Peer",
        requestSentAt: "2026-09-01T10:00:00.000Z",
      },
    ]);
  });

  it("never surfaces an in-flight pending reservation as requestSentAt", async () => {
    getHostOverlayStatusesMock.mockResolvedValue([status(PEER)]);
    getUserSettingMock.mockResolvedValue({
      [PEER]: "pending:2026-09-01T10:00:00.000Z",
    });

    const result = await run({ emails: [PEER] });

    expect(result[0].requestSentAt).toBeUndefined();
  });

  it("throws when the booking link is not found", async () => {
    selectRowsMock.mockResolvedValue([]);

    await expect(
      run({ emails: [PEER], bookingLinkId: "missing" }),
    ).rejects.toThrow("Booking link not found");
  });
});
