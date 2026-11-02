import { describe, expect, it } from "vitest";

import manageEventDraft from "../../actions/manage-event-draft";
import { CALENDAR_CONNECTOR_CATALOG } from "./calendar-connector-catalog";

describe("Calendar MCP connector catalog", () => {
  it("opts unsent drafts into MCP beside the event inventory allowlist", () => {
    expect(manageEventDraft.mcpTool).toBe(true);
    expect(manageEventDraft.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("keeps the shared inventory allowlist read-only", () => {
    expect(CALENDAR_CONNECTOR_CATALOG).toEqual(["list-events"]);
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("search-events");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("get-event");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("create-event");
  });
});
