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
    // toolCallable only blocks the sandboxed tools-iframe bridge — it does not
    // remove this action from the agent's own tool list. needsApproval is the
    // gate that actually stops the agent chat loop from cancelling a booking
    // (and emailing the guest) on its own.
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
    );
    expect(result).toEqual({ success: true });
  });
});
