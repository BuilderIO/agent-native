import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());
const isConnectedMock = vi.hoisted(() => vi.fn());
const getAuthStatusMock = vi.hoisted(() => vi.fn());
const getEventMock = vi.hoisted(() => vi.fn());
const updateEventMock = vi.hoisted(() => vi.fn());
const listCalendarEventsMock = vi.hoisted(() => vi.fn());
const findBookedGoogleEventsMock = vi.hoisted(() => vi.fn());
const resolveCalendarEventRangeMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
  getRequestOrgId: getRequestOrgIdMock,
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  isConnected: isConnectedMock,
  getAuthStatus: getAuthStatusMock,
  getEvent: getEventMock,
  updateEvent: updateEventMock,
}));

vi.mock("./list-events.js", () => ({
  listCalendarEvents: listCalendarEventsMock,
  findBookedGoogleEvents: findBookedGoogleEventsMock,
  resolveCalendarEventRange: resolveCalendarEventRangeMock,
}));

import action from "./update-events";

const OWNER = "owner@example.com";
const RANGE = {
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-09-08T00:00:00.000Z",
  timezone: "UTC",
};

function run(args: Record<string, unknown>) {
  return action.run(args as never, undefined as never) as Promise<
    Record<string, unknown>
  >;
}

describe("update-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue(OWNER);
    getRequestOrgIdMock.mockReturnValue(undefined);
    isConnectedMock.mockResolvedValue(true);
    getAuthStatusMock.mockResolvedValue({ accounts: [{ email: OWNER }] });
    findBookedGoogleEventsMock.mockResolvedValue([]);
    resolveCalendarEventRangeMock.mockReturnValue(RANGE);
  });

  it("counts an explicit-id lookup failure in the aggregate failed total", async () => {
    getEventMock.mockRejectedValue(new Error("boom"));

    const result = await run({
      ids: ["missing-id"],
      accountEmail: OWNER,
      shiftMinutes: 15,
      sendUpdates: "none",
    });

    // Before the fix this stayed 0: the summary only counted failures out of
    // `updated`, so a lookup that never made it into that array vanished from
    // the aggregate while the per-event list still said "failed".
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        id: "google-missing-id",
        outcome: "failed",
        reason: "boom",
      }),
    );
  });

  it("also counts explicit-id lookup failures in a dry run", async () => {
    getEventMock.mockRejectedValue(new Error("boom"));

    const result = await run({
      ids: ["missing-id"],
      accountEmail: OWNER,
      shiftMinutes: 15,
      sendUpdates: "none",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.failed).toBe(1);
  });

  it("skips an all-day event instead of corrupting it with a minute shift", async () => {
    listCalendarEventsMock.mockResolvedValue({
      events: [
        {
          id: "e1",
          googleEventId: "g1",
          title: "Standup",
          start: "2026-09-02T09:00:00.000Z",
          end: "2026-09-02T09:30:00.000Z",
          allDay: false,
          accountEmail: OWNER,
          source: "google",
        },
        {
          id: "e2",
          googleEventId: "g2",
          title: "Offsite",
          start: "2026-09-03",
          end: "2026-09-04",
          allDay: true,
          accountEmail: OWNER,
          source: "google",
        },
      ],
      errors: [],
    });
    updateEventMock.mockResolvedValue(undefined);

    const result = await run({
      from: "2026-09-01",
      to: "2026-09-08",
      shiftMinutes: 15,
      sendUpdates: "none",
    });

    expect(updateEventMock).toHaveBeenCalledTimes(1);
    expect(updateEventMock).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        start: "2026-09-02T09:15:00.000Z",
        end: "2026-09-02T09:45:00.000Z",
      }),
      expect.anything(),
    );
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        id: "google-g2",
        outcome: "skipped",
        reason: expect.stringContaining("all-day"),
      }),
    );
  });
});
