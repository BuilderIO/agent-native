import { describe, expect, it } from "vitest";

import { crmNavigationPath, viewFromPath } from "./navigation";

describe("CRM Intelligence navigation", () => {
  it("maps the Intelligence settings tab to a navigable semantic path", () => {
    expect(
      crmNavigationPath({ view: "settings", settingsSection: "intelligence" }),
    ).toBe("/settings/intelligence");
    expect(viewFromPath("/settings/intelligence")).toBe("settings");
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
