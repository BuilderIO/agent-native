import { describe, expect, it } from "vitest";

import { isCalendarConnectionComplete } from "./calendar-connection";

const connected = {
  id: "account-1",
  status: "connected",
  lastSyncError: null,
  updatedAt: "2026-09-01T10:00:00.000Z",
};

describe("isCalendarConnectionComplete", () => {
  it("waits when the existing account has not changed", () => {
    expect(isCalendarConnectionComplete([connected], [connected])).toBe(false);
  });

  it("recognizes a reconnected existing account", () => {
    expect(
      isCalendarConnectionComplete(
        [{ ...connected, status: "needs-reauth" }],
        [connected],
      ),
    ).toBe(true);
  });

  it("recognizes a newly connected account", () => {
    expect(
      isCalendarConnectionComplete(
        [connected],
        [connected, { ...connected, id: "account-2" }],
      ),
    ).toBe(true);
  });

  it("recognizes a refreshed OAuth timestamp", () => {
    expect(
      isCalendarConnectionComplete(
        [connected],
        [{ ...connected, updatedAt: "2026-09-01T10:01:00.000Z" }],
      ),
    ).toBe(true);
  });
});
