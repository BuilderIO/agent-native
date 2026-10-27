import { describe, expect, it } from "vitest";

import { chosenColor } from "./ColorSubmenu";

describe("chosenColor", () => {
  it("resets only the kind of colour its default names", () => {
    expect(chosenColor("blue_bg", "default")).toBe("blue_bg");
    expect(chosenColor("blue_bg", "default_bg")).toBeNull();
    expect(chosenColor("blue", "default_bg")).toBe("blue");
    expect(chosenColor("blue", "default")).toBeNull();
    expect(chosenColor(null, "default")).toBeNull();
  });

  it("replaces the colour with any other choice", () => {
    expect(chosenColor("blue_bg", "red")).toBe("red");
    expect(chosenColor("blue", "red_bg")).toBe("red_bg");
  });
});
