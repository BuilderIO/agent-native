import { describe, expect, it } from "vitest";

import { setRunTurnIdHeader } from "./run-turn-id-header.js";

function responseEvent() {
  return { res: { headers: new Headers() } } as unknown as Parameters<
    typeof setRunTurnIdHeader
  >[0] & { res: { headers: Headers } };
}

describe("setRunTurnIdHeader", () => {
  it("sends the turn the run is stored under", () => {
    const event = responseEvent();
    setRunTurnIdHeader(event, "turn-approval-1");
    expect(event.res.headers.get("X-Turn-Id")).toBe("turn-approval-1");
  });

  it.each(["turn-✓", "turn\nsplit"])(
    "leaves out a turn id a header cannot carry, without throwing: %j",
    (turnId) => {
      const event = responseEvent();
      expect(() => setRunTurnIdHeader(event, turnId)).not.toThrow();
      expect(event.res.headers.get("X-Turn-Id")).toBeNull();
    },
  );
});
