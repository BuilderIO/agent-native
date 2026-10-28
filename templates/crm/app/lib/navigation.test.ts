import { describe, expect, it } from "vitest";

import {
  crmNavigationPath,
  parseCrmNavigationSelection,
  viewFromPath,
} from "./navigation";

describe("CRM Intelligence navigation", () => {
  it("maps the Intelligence settings tab to its CRM › General area", () => {
    expect(
      crmNavigationPath({ view: "settings", settingsSection: "intelligence" }),
    ).toBe("/settings/app/intelligence");
    expect(viewFromPath("/settings/app/intelligence")).toBe("settings");
    expect(
      parseCrmNavigationSelection("/settings/app/intelligence"),
    ).toMatchObject({ settingsSection: "intelligence" });
  });

  it("still reads today's /settings/<section> links", () => {
    expect(parseCrmNavigationSelection("/settings/fields")).toMatchObject({
      settingsSection: "fields",
    });
    expect(
      parseCrmNavigationSelection("/settings/app")?.settingsSection,
    ).toBeUndefined();
    expect(
      parseCrmNavigationSelection("/settings/integrations")?.settingsSection,
    ).toBeUndefined();
  });

  it("keeps the MCP settings tab readable from its semantic path", () => {
    expect(
      crmNavigationPath({ view: "settings", settingsSection: "mcp" }),
    ).toBe("/settings/mcp");
    expect(parseCrmNavigationSelection("/settings/mcp")).toMatchObject({
      settingsSection: "mcp",
    });
  });

  it("keeps the list, kind, and board-mode targets the route hook used to drop", () => {
    expect(crmNavigationPath({ view: "board", listId: "list_1" })).toBe(
      "/views?list=list_1&mode=board",
    );
    expect(crmNavigationPath({ view: "records", kind: "person" })).toBe(
      "/records?kind=person",
    );
  });
});
