import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CALENDAR_CONNECTOR_CATALOG } from "./calendar-connector-catalog";

describe("Calendar MCP connector catalog", () => {
  it("exposes only deterministic event inventory reads", () => {
    expect(CALENDAR_CONNECTOR_CATALOG).toEqual(["list-events"]);
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("search-events");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("get-event");
    expect(CALENDAR_CONNECTOR_CATALOG).not.toContain("create-event");
  });

  it("wires the catalog into MCP and keeps the action authenticated read-only", () => {
    const root = process.cwd();
    const plugin = readFileSync(
      join(root, "server", "plugins", "agent-chat.ts"),
      "utf8",
    );
    const action = readFileSync(
      join(root, "actions", "list-events.ts"),
      "utf8",
    );

    expect(plugin).toContain("connectorCatalog: [");
    expect(plugin).toContain("...CALENDAR_CONNECTOR_CATALOG");
    expect(action).toContain("readOnly: true");
    expect(action).toContain(
      "publicAgent: { expose: true, readOnly: true, requiresAuth: true }",
    );
  });
});
