import { describe, expect, it, vi } from "vitest";

const cancelBookingByIdMock = vi.hoisted(() => vi.fn());
const requireActionUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://example.com",
  getRequestContext: getRequestContextMock,
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
    getRequestContextMock.mockReturnValue(undefined);
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

  it("uses the request origin for cancellation links when called from the UI", async () => {
    getRequestContextMock.mockReturnValue({
      requestOrigin: "https://calendar-preview.example",
    });
    requireActionUserEmailMock.mockReturnValue("owner@example.com");
    cancelBookingByIdMock.mockResolvedValue({ success: true });

    await action.run({ id: "booking-1" } as never, undefined as never);

    expect(cancelBookingByIdMock).toHaveBeenCalledWith(
      "booking-1",
      "https://calendar-preview.example",
      { zoomMeetingResolved: undefined },
    );
  });
});
