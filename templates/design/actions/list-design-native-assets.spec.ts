import { describe, expect, it } from "vitest";

import action from "./list-design-native-assets.js";

describe("list-design-native-assets", () => {
  it("exposes a signed-out public read-only catalog", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: false,
    });
  });

  it("returns editable Design-native primitives and components", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      source: "design-native",
      guidance: expect.stringContaining("editable Design-native HTML"),
    });
    expect(result.assets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["button", "card", "hero", "feature-grid"]),
    );
  });

  it("filters assets by category", async () => {
    const result = await action.run({ category: "layout" });

    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.assets.every((asset) => asset.category === "layout")).toBe(
      true,
    );
  });
});
