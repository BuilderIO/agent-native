import { describe, expect, it } from "vitest";

import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
} from "./review-state.js";

describe("triage review state", () => {
  it("does not reopen unchanged provider evidence", () => {
    const snapshot = {
      title: "Issue",
      summary: "A bug",
      sourceUrl: "https://example.com/item",
      lastSeenAt: "2026-08-12T12:00:00.000Z",
    };

    expect(hasTriageSourceChanged(snapshot, snapshot)).toBe(false);
    expect(statusAfterTriageSourceUpdate("shadow_decided", false, "received"))
      .toBe("shadow_decided");
  });

  it("reopens an item when the source evidence changes", () => {
    const snapshot = {
      title: "Issue",
      summary: "A bug",
      lastSeenAt: "2026-08-12T12:00:00.000Z",
    };

    expect(
      hasTriageSourceChanged(snapshot, {
        ...snapshot,
        lastSeenAt: "2026-08-12T13:00:00.000Z",
      }),
    ).toBe(true);
    expect(statusAfterTriageSourceUpdate("needs_manual", true, "received"))
      .toBe("received");
  });
});
