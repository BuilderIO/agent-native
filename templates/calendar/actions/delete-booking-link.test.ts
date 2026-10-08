import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildDeepLinkMock, deleteBookingLinkMock } = vi.hoisted(() => ({
  buildDeepLinkMock: vi.fn(() => "/_agent-native/open?view=booking-links"),
  deleteBookingLinkMock: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: buildDeepLinkMock,
}));

vi.mock("../server/handlers/booking-links.js", () => ({
  deleteBookingLinkById: deleteBookingLinkMock,
}));

import action from "./delete-booking-link";

describe("delete-booking-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteBookingLinkMock.mockResolvedValue({
      ok: true,
      title: "Consultation",
      duration: 45,
      slug: "private-slug",
      hosts: ["host@example.com"],
      description: "Private booking details",
    });
  });

  it("returns a compact deletion card linked to the booking-link list", async () => {
    const result = await action.run({ id: "booking-link-1" });

    expect(result).toEqual({
      ok: true,
      change: {
        verb: "deleted",
        kind: "booking-link",
        title: "Consultation",
        detail: "45",
        url: "/_agent-native/open?view=booking-links",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-slug");
    expect(JSON.stringify(result)).not.toContain("host@example.com");
    expect(JSON.stringify(result)).not.toContain("Private booking details");
    expect(buildDeepLinkMock).toHaveBeenCalledWith({
      app: "calendar",
      view: "booking-links",
    });
  });

  it("uses a nonempty title fallback when the deleted link has no title", async () => {
    deleteBookingLinkMock.mockResolvedValueOnce({
      ok: true,
      title: "  ",
      duration: 30,
    });

    const result = await action.run({ id: "booking-link-1" });

    expect(result.change).toMatchObject({
      title: "Booking link",
      detail: "30",
    });
  });

  it("preserves delete failures without returning a change card", async () => {
    deleteBookingLinkMock.mockRejectedValueOnce(new Error("Delete denied"));

    await expect(action.run({ id: "booking-link-1" })).rejects.toThrow(
      "Delete denied",
    );
    expect(buildDeepLinkMock).not.toHaveBeenCalled();
  });
});
