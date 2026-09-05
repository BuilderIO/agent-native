import { describe, expect, it } from "vitest";

import {
  actionChangeDedupeKey,
  actionChangeMarkerValue,
  parseActionChangeMarker,
} from "./action-change-marker.js";

describe("action change markers", () => {
  it("round-trips the originating browser source through durable sync", () => {
    const marker = actionChangeMarkerValue({
      actionName: "update-project",
      owner: "owner@example.com",
      requestSource: "browser-tab-1",
    });

    expect(parseActionChangeMarker("owner@example.com", marker)).toEqual({
      actionName: "update-project",
      owner: "owner@example.com",
      orgId: undefined,
      requestSource: "browser-tab-1",
    });
  });

  it("uses the marker nonce as a stable fast-path dedupe identity", () => {
    const target = {
      actionName: "update-project",
      owner: "owner@example.com",
      nonce: "marker-123",
    };

    expect(actionChangeDedupeKey(target, `action|${target.nonce}`)).toBe(
      "action|marker-123|update-project|owner@example.com|",
    );
    expect(
      parseActionChangeMarker(
        "owner@example.com",
        actionChangeMarkerValue(target),
      ),
    ).toEqual(expect.objectContaining({ nonce: "marker-123" }));
  });
});
