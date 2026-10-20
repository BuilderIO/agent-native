import { describe, expect, it } from "vitest";

import { isCalendarConnectionComplete } from "./calendar-connection";

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
