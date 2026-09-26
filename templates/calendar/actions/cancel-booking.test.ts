import { describe, expect, it, vi } from "vitest";

const cancelBookingByIdMock = vi.hoisted(() => vi.fn());
const requireActionUserEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://example.com",
}));

vi.mock("../server/handlers/bookings.js", () => ({
  cancelBookingById: cancelBookingByIdMock,
}));

vi.mock("./event-action-helpers.js", () => ({
  requireActionUserEmail: requireActionUserEmailMock,
}));

import action from "./cancel-booking";

describe("cancel-booking", () => {
  it("requires human approval before an agent can send the cancellation email and delete the event", () => {
    expect(action.needsApproval).toBe(true);
  });

  it("still cancels the booking once approved", async () => {
    requireActionUserEmailMock.mockReturnValue("owner@example.com");
    cancelBookingByIdMock.mockResolvedValue({ success: true });

    const result = await action.run(
      { id: "booking-1" } as never,
      undefined as never,
    );

    expect(cancelBookingByIdMock).toHaveBeenCalledWith(
      "booking-1",
      "https://example.com",
      { zoomMeetingResolved: undefined },
    );
    expect(result).toEqual({ success: true });
  });
});
