import { describe, expect, it } from "vitest";

import { pathForView, viewFromPath } from "./navigation";

describe("CRM Intelligence navigation", () => {
  it("maps the Intelligence settings tab to a navigable semantic path", () => {
    expect(pathForView("settings", undefined, "intelligence")).toBe(
      "/settings/intelligence",
    );
    expect(viewFromPath("/settings/intelligence")).toBe("settings");
  });
});
