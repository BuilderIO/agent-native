import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
  listEvents: vi.fn(),
  recordCalendarFetchError: vi.fn(),
  recordCalendarFetchSuccess: vi.fn(),
  resolveCalendarAccessToken: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/event-bus", () => ({
  emit: mocks.emit,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(async () => mocks.accounts),
      };
      return builder;
    },
  }),
  schema: {
    calendarAccounts: {
      id: "calendarAccounts.id",
      status: "calendarAccounts.status",
    },
    calendarAccountShares: "calendarAccountShares",
  },
}));

vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  recordCalendarFetchError: mocks.recordCalendarFetchError,
  recordCalendarFetchSuccess: mocks.recordCalendarFetchSuccess,
  resolveCalendarAccessToken: mocks.resolveCalendarAccessToken,
  shouldMarkNeedsReauth: vi.fn(() => false),
}));

vi.mock("../server/lib/google-calendar-client.js", () => ({
  listEvents: mocks.listEvents,
  pickJoinUrl: vi.fn(),
}));

import action from "./sync-calendars";

const calendarAccount = {
  id: "calendar-1",
  provider: "google",
  ownerEmail: "owner@example.com",
};

describe("sync-calendars calendar status writes", () => {
  beforeEach(() => {
    mocks.accounts = [calendarAccount];
    mocks.emit.mockReset();
    mocks.listEvents.mockReset();
    mocks.recordCalendarFetchError.mockReset();
    mocks.recordCalendarFetchSuccess.mockReset();
    mocks.resolveCalendarAccessToken.mockReset();
    mocks.writeAppState.mockReset();
  });

  it("marks a null token as an explicit reauthentication failure", async () => {
    mocks.resolveCalendarAccessToken.mockResolvedValue(null);
    mocks.recordCalendarFetchError.mockResolvedValue({
      accountId: calendarAccount.id,
      error: "Token refresh failed",
      needsReauth: true,
    });

    await action.run(action.schema.parse({}));

    expect(mocks.recordCalendarFetchError).toHaveBeenCalledWith(
      calendarAccount,
      expect.objectContaining({ message: "Token refresh failed" }),
      { needsReauth: true },
    );
    expect(mocks.recordCalendarFetchSuccess).not.toHaveBeenCalled();
  });

  it("uses the guarded shared helper after a successful sweep", async () => {
    mocks.resolveCalendarAccessToken.mockResolvedValue("access-token");
    mocks.listEvents.mockResolvedValue({ items: [] });
    mocks.recordCalendarFetchSuccess.mockResolvedValue(undefined);

    await action.run(action.schema.parse({}));

    expect(mocks.recordCalendarFetchSuccess).toHaveBeenCalledWith(
      calendarAccount,
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      "calendar-synced",
      expect.objectContaining({ accountId: calendarAccount.id }),
    );
  });
});
