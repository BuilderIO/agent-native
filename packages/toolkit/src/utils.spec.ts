import { describe, expect, it } from "vitest";

import { cn } from "./utils.js";

describe("cn", () => {
  it("keeps a design-system type step beside a text color", () => {
    expect(cn("text-1", "text-fg-muted")).toBe("text-1 text-fg-muted");
  });

  it("lets a later type step replace an earlier font size", () => {
    expect(cn("text-sm", "text-1")).toBe("text-1");
    expect(cn("text-1", "text-3")).toBe("text-3");
  });

  it("still lets a later color replace an earlier one", () => {
    expect(cn("text-fg-muted", "text-fg-default")).toBe("text-fg-default");
  });

  it("keeps the later of two text styles, and a text style beside a color", () => {
    expect({
      styles: cn("type-body", "type-label"),
      withColor: cn("type-label", "text-fg-muted"),
    }).toEqual({ styles: "type-label", withColor: "type-label text-fg-muted" });
  });
});
