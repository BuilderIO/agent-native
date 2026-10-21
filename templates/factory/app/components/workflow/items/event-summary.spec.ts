import { describe, expect, it } from "vitest";

import { endedDetail, errorDetail, lastEventText } from "./event-summary";

describe("endedDetail", () => {
  it("keeps the reason and drops the outcome and status the event already records", () => {
    expect(
      endedDetail("dismissed: Not a bug (status dismissed)", "dismissed"),
    ).toBe("Not a bug");
    expect(
      endedDetail(
        "needsManual: Risky change: triage owner told (status needs_manual)",
        "needsManual",
      ),
    ).toBe("Risky change: triage owner told");
  });

  it("has nothing to add when the engine wrote no reason", () => {
    expect(endedDetail("done (status resolved)", "done")).toBeNull();
    expect(endedDetail("released", "released")).toBeNull();
  });

  it("trims a group member's line", () => {
    expect(
      endedDetail("done: grouped (status resolved), through item-1", "done"),
    ).toBe("grouped");
  });

  it("leaves text that does not start with the outcome as written", () => {
    expect(endedDetail("finished early", "done")).toBe("finished early");
  });
});

describe("errorDetail", () => {
  it("strips the recorded code from the front of the message", () => {
    expect(
      errorDetail("provider_error: HubSpot returned 401", "provider_error"),
    ).toBe("HubSpot returned 401");
  });

  it("does not strip anything it was not told is the code", () => {
    expect(errorDetail("HTTP 500: server down", null)).toBe(
      "HTTP 500: server down",
    );
    expect(errorDetail("other_code: x", "provider_error")).toBe(
      "other_code: x",
    );
  });
});

describe("lastEventText", () => {
  it("leaves an end out, since the chip and the reason already say it", () => {
    expect(
      lastEventText({ kind: "ended", summary: "needsManual: Risky change" }),
    ).toBeNull();
  });

  it("leaves a park out, since the row already says where the item waits", () => {
    expect(
      lastEventText({
        kind: "parked",
        summary: "Waiting for a reply, up to 24 h",
      }),
    ).toBeNull();
  });

  it("shows any other event as written, and nothing for an empty one", () => {
    expect(
      lastEventText({ kind: "error", summary: "provider_error: HubSpot 401" }),
    ).toBe("provider_error: HubSpot 401");
    expect(lastEventText({ kind: "taken", summary: "new message" })).toBe(
      "new message",
    );
    expect(lastEventText({ kind: "entered", summary: "  " })).toBeNull();
  });
});
