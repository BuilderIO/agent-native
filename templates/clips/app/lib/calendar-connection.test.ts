import { describe, expect, it } from "vitest";

import { isCalendarConnectionComplete } from "./calendar-connection";

const connected = {
  id: "account-1",
  status: "connected",
};
const connectedWithStaleMetadata = {
  ...connected,
  lastSyncError: "stale error",
  updatedAt: "changed",
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

  it("ignores sync metadata changes on an existing account", () => {
    expect(
      isCalendarConnectionComplete([connected], [connectedWithStaleMetadata]),
    ).toBe(false);
  });
});
