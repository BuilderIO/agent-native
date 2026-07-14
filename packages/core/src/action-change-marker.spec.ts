import { describe, expect, it } from "vitest";

import {
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
});
