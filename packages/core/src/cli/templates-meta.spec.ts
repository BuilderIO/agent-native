import { describe, expect, it } from "vitest";

import { getTemplate, visibleTemplates } from "./templates-meta.js";

describe("Slides 2 template metadata", () => {
  it("keeps the hidden template metadata mirrored without listing it publicly", () => {
    expect(getTemplate("slides-2")).toMatchObject({
      hidden: true,
      prodUrl: "https://slides-2.agent-native.com",
      devPort: 8087,
    });
    expect(
      visibleTemplates().some((template) => template.name === "slides-2"),
    ).toBe(false);
  });
});
