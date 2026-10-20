import { describe, expect, it } from "vitest";

import { collapseConsecutiveInboxEvents } from "./collapse-inbox-events.js";

describe("collapseConsecutiveInboxEvents", () => {
  it("keeps the latest of consecutive identical summaries", () => {
    const collapsed = collapseConsecutiveInboxEvents([
      {
        id: "1",
        action: "babysit-factory-pull-request",
        summary: "#3961 waiting; already asked.",
      },
      {
        id: "2",
        action: "babysit-factory-pull-request",
        summary: "#3961 waiting; already asked.",
      },
      {
        id: "3",
        action: "babysit-factory-pull-request",
        summary: "#3961 posted the feedback-fix request.",
      },
    ]);

    expect(collapsed.map((event) => event.id)).toEqual(["2", "3"]);
  });
});
