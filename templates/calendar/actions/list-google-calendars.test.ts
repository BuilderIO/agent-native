import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const listGoogleCalendarsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("../server/lib/google-calendar.js", () => ({
  listGoogleCalendars: listGoogleCalendarsMock,
}));

import action from "./list-google-calendars.js";

describe("list-google-calendars action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("owner@example.com");
  });

  it("discovers sources for the authenticated owner", async () => {
    listGoogleCalendarsMock.mockResolvedValue({ calendars: [], errors: [] });

    await expect((action as any).run({})).resolves.toEqual({
      calendars: [],
      errors: [],
    });
    expect(listGoogleCalendarsMock).toHaveBeenCalledWith("owner@example.com");
  });

  it("refuses unauthenticated discovery", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);

    await expect((action as any).run({})).rejects.toThrow(
      "no authenticated user",
    );
    expect(listGoogleCalendarsMock).not.toHaveBeenCalled();
  });
});
