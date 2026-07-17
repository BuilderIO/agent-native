import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  deleteAppSecret: vi.fn(),
  getRequestUserEmail: vi.fn(),
  lockCalendarAccount: vi.fn(),
  readAppSecret: vi.fn(),
  revokeToken: vi.fn(),
  writeAppState: vi.fn(),
}));

const { operationOrder, schema } = vi.hoisted(() => ({
  operationOrder: [] as string[],
  schema: {
    calendarAccounts: { id: "calendarAccounts.id" },
    calendarEvents: {
      id: "calendarEvents.id",
      calendarAccountId: "calendarEvents.calendarAccountId",
      meetingId: "calendarEvents.meetingId",
    },
    meetings: {
      id: "meetings.id",
      calendarEventId: "meetings.calendarEventId",
      recordingId: "meetings.recordingId",
      trashedAt: "meetings.trashedAt",
    },
  },
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: (...args: unknown[]) => mocks.deleteAppSecret(...args),
  readAppSecret: (...args: unknown[]) => mocks.readAppSecret(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.getRequestUserEmail(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (column: unknown, value: unknown) => ({
    op: "eq",
    column,
    value,
  }),
  inArray: (column: unknown, values: unknown[]) => ({
    op: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ op: "isNull", column }),
  or: (...args: unknown[]) => ({ op: "or", args }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema,
}));

vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  lockCalendarAccount: (...args: unknown[]) => {
    operationOrder.push("lock-account");
    return mocks.lockCalendarAccount(...args);
  },
}));

vi.mock("../server/lib/google-calendar-client.js", () => ({
  revokeToken: (...args: unknown[]) => mocks.revokeToken(...args),
}));

import action from "./disconnect-calendar";

beforeEach(() => {
  vi.clearAllMocks();
  operationOrder.length = 0;
  mocks.assertAccess.mockResolvedValue(undefined);
  mocks.deleteAppSecret.mockResolvedValue(undefined);
  mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
  mocks.lockCalendarAccount.mockResolvedValue(true);
  mocks.readAppSecret.mockResolvedValue(null);
  mocks.revokeToken.mockResolvedValue(undefined);
  mocks.writeAppState.mockResolvedValue(undefined);

  const accountSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([
      {
        id: "account_1",
        ownerEmail: "owner@example.com",
        accessTokenSecretRef: null,
        refreshTokenSecretRef: null,
      },
    ]),
  };
  mockDb.select.mockReturnValue(accountSelect);

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(async () => {
        operationOrder.push("snapshot-events");
        return [{ id: "event_1", meetingId: "meeting_1" }];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn(async () => {
        operationOrder.push("trash-meetings");
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        operationOrder.push(
          table === schema.calendarEvents ? "delete-events" : "delete-account",
        );
      }),
    })),
  };
  mockDb.transaction.mockImplementation(async (callback) => callback(tx));
});

describe("disconnect-calendar action", () => {
  it("locks cleanup against materialization before snapshotting calendar events", async () => {
    const result = await action.run({ id: "account_1" });

    expect(result).toEqual({ id: "account_1", disconnected: true });
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(operationOrder).toEqual([
      "lock-account",
      "snapshot-events",
      "trash-meetings",
      "delete-events",
      "delete-account",
    ]);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });
});
