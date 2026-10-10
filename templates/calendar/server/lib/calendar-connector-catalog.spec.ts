import { describe, expect, it } from "vitest";

import { CALENDAR_CONNECTOR_CATALOG } from "./calendar-connector-catalog";

describe("Calendar MCP connector catalog", () => {
  it("exposes only deterministic event inventory reads", () => {
    expect(CALENDAR_CONNECTOR_CATALOG).toEqual(["list-events"]);
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("search-events");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("get-event");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("create-event");
  });
});
