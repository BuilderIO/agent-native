import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/application-state", () => stateMocks);

const action = (await import("./check-appointment-conflicts")).default;

const plan = {
  planId: "plan-1",
  sourceLabel: "Personal inbox",
  bufferMinutes: 30,
  timezone: "America/Los_Angeles",
  appointments: [
    {
      id: "appointment-1",
      title: "Customer appointment",
      startTime: "2026-01-15T17:00:00.000Z",
      endTime: "2026-01-15T17:30:00.000Z",
      blockStart: "2026-01-15T16:30:00.000Z",
      blockEnd: "2026-01-15T18:00:00.000Z",
    },
  ],
  conflictCheck: {
    status: "not_checked",
    checkedAt: "",
    conflicts: [],
  },
  status: "draft",
  approvedAt: null,
} as const;

beforeEach(() => {
  stateMocks.readAppState.mockReset().mockResolvedValue(plan);
  stateMocks.writeAppState.mockReset().mockResolvedValue(undefined);
});

describe("check-appointment-conflicts", () => {
  it("records a clear check when the connected calendar is empty", async () => {
    const result = await action.run({ calendarText: " \n" });

    expect(result.conflictCheck).toMatchObject({
      status: "clear",
      conflicts: [],
    });
    expect(stateMocks.writeAppState).toHaveBeenCalledWith(
      "appointment-plan",
      expect.objectContaining({
        status: "review",
        conflictCheck: expect.objectContaining({ status: "clear" }),
      }),
    );
  });

  it("still rejects a nonempty snapshot with no parseable events", async () => {
    await expect(
      action.run({ calendarText: "No events found" }),
    ).rejects.toThrow("No calendar events found");
  });
});
