import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./DesignCanvas.tsx", import.meta.url)),
  "utf8",
);

describe("DesignCanvas spacing overlay bridge", () => {
  it("injects editable spacing chrome instead of the old passive padding inset", () => {
    expect(source).toContain("data-agent-native-spacing-overlay");
    expect(source).toContain("data-agent-native-spacing-region");
    expect(source).toContain("data-agent-native-spacing-badge");
    expect(source).not.toContain("data-agent-native-padding-overlay");
  });

  it("persists dragged padding and gap values through visual style changes", () => {
    expect(source).toContain("function startSpacingDrag");
    expect(source).toContain("styles[handle.property] = finalValue + 'px'");
    expect(source).toContain(
      "styles[handle.oppositeProperty] = finalValue + 'px'",
    );
    expect(source).toContain("addAxisGaps('x', 'columnGap'");
    expect(source).toContain("addAxisGaps('y', 'rowGap'");
  });

  it("shows spacing affordances when hovering the selected element or its children", () => {
    expect(source).toContain("selectedSpacingHovered = Boolean");
    expect(source).toContain("hoveredEl === selectedEl");
    expect(source).toContain("selectedEl.contains(hoveredEl)");
  });
});
