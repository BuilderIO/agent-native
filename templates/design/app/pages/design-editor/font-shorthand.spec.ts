import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { cssStyleAliases, refreshedComputedStyles } from "./code-layer-state";

const info = { computedStyles: {} } as unknown as ElementInfo;

describe("font shorthand", () => {
  it("exposes family, size, weight and line-height as longhands", () => {
    const out = cssStyleAliases({
      font: "600 36px / 40px Inter, ui-sans-serif, sans-serif",
    });
    expect(out.fontWeight).toBe("600");
    expect(out.fontSize).toBe("36px");
    expect(out.lineHeight).toBe("40px");
    expect(out.fontFamily).toBe("Inter, ui-sans-serif, sans-serif");
  });

  it("keeps an explicit longhand that follows the shorthand", () => {
    const out = cssStyleAliases({
      font: "600 36px Inter",
      "font-weight": "300",
    });
    expect(out.fontWeight).toBe("300");
    expect(out.fontSize).toBe("36px");
  });

  it("handles a shorthand with no line-height", () => {
    const out = cssStyleAliases({ font: "italic 700 18px Georgia, serif" });
    expect(out.fontStyle).toBe("italic");
    expect(out.fontWeight).toBe("700");
    expect(out.fontSize).toBe("18px");
    expect(out.fontFamily).toBe("Georgia, serif");
  });

  it("leaves unrelated declarations alone", () => {
    const out = cssStyleAliases({ color: "red", "letter-spacing": "-0.9px" });
    expect(out.color).toBe("red");
    expect(out.letterSpacing).toBe("-0.9px");
    expect(out.fontSize).toBeUndefined();
  });

  it("survives the class-less merge the inspector reads from", () => {
    // sourceClasses empty means computedStyles are dropped, so the shorthand is
    // the only place the typography panel can get a family from.
    const merged = refreshedComputedStyles(
      info,
      { font: "600 36px / 40px Inter, sans-serif" },
      [],
    );
    expect(merged.fontFamily).toBe("Inter, sans-serif");
    expect(merged.fontSize).toBe("36px");
    expect(merged.fontWeight).toBe("600");
  });
});
