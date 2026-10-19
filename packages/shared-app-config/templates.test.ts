import { describe, expect, it } from "vitest";

import { allTemplateNames, getTemplate, visibleTemplates } from "./templates.js";

describe("Slides 2 template metadata", () => {
  it("resolves internally without appearing in visible template catalogs", () => {
    expect(allTemplateNames()).toContain("slides-2");
    expect(getTemplate("slides-2")).toMatchObject({
      name: "slides-2",
      label: "Slides 2",
      hidden: true,
      devPort: 8087,
      prodUrl: "https://slides-2.agent-native.com",
      core: false,
    });
    expect(visibleTemplates().some((template) => template.name === "slides-2")).toBe(
      false,
    );
  });
});
