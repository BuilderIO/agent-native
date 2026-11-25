import { describe, expect, it } from "vitest";

import {
  findUnreportedCalendarConnection,
  isCalendarConnectionComplete,
} from "./calendar-connection";

const connected = {
  id: "account-1",
  status: "connected",
};

describe("isCalendarConnectionComplete", () => {
  it("waits without an OAuth completion marker", () => {
    expect(isCalendarConnectionComplete([connected], null)).toBe(false);
  });

  it("recognizes an already-connected account updated by OAuth", () => {
    expect(isCalendarConnectionComplete([connected], "account-1")).toBe(true);
  });

  it("recognizes a newly connected account", () => {
    expect(
      isCalendarConnectionComplete(
        [connected, { ...connected, id: "account-2" }],
        "account-2",
      ),
    ).toBe(true);
  });

  it("requires the account targeted by reconnect", () => {
    expect(
      isCalendarConnectionComplete(
        [
          { ...connected, status: "needs-reauth" },
          { ...connected, id: "account-2" },
        ],
        "account-2",
        "account-1",
      ),
    ).toBe(false);
  });

  it("accepts the targeted account only after it is connected", () => {
    expect(
      isCalendarConnectionComplete(
        [{ ...connected, status: "needs-reauth" }],
        "account-1",
        "account-1",
      ),
    ).toBe(false);
  });
});

describe("findUnreportedCalendarConnection", () => {
  const stale = { ...connected, status: "needs-reauth" };

  it("finds a reconnect the popup never reported", () => {
    expect(
      findUnreportedCalendarConnection([stale], [connected], "account-1"),
    ).toBe("account-1");
  });

  it("finds a new account the popup never reported", () => {
    expect(
      findUnreportedCalendarConnection(
        [connected],
        [connected, { ...connected, id: "account-2" }],
      ),
    ).toBe("account-2");
  });

  it("ignores accounts that were already connected", () => {
    expect(findUnreportedCalendarConnection([connected], [connected])).toBe(
      null,
    );
  });

  it("finds nothing when the reconnect was cancelled", () => {
    expect(
      findUnreportedCalendarConnection([stale], [stale], "account-1"),
    ).toBe(null);
  });

  it("requires the account targeted by reconnect", () => {
    expect(
      findUnreportedCalendarConnection(
        [stale],
        [stale, { ...connected, id: "account-2" }],
        "account-1",
      ),
    ).toBe(null);
  });
});
