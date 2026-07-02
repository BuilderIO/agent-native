import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignEditor motion dock transition", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("opens after a painted collapsed frame so height can transition", () => {
    const openStart = source.indexOf("const setMotionDockOpenAnimated");
    const openEnd = source.indexOf(
      "const handleMotionDockExitComplete",
      openStart,
    );
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);

    const openBlock = source.slice(openStart, openEnd);
    const mountIndex = openBlock.indexOf("setMotionDockMounted(true)");
    const firstFrameIndex = openBlock.indexOf("window.requestAnimationFrame");
    const secondFrameIndex = openBlock.indexOf(
      "motionDockOpenAnimationFrameRef.current =\n              window.requestAnimationFrame",
      firstFrameIndex + 1,
    );
    const openIndex = openBlock.indexOf(
      "setMotionDockOpen(true)",
      firstFrameIndex,
    );

    expect(mountIndex).toBeGreaterThanOrEqual(0);
    expect(firstFrameIndex).toBeGreaterThan(mountIndex);
    expect(secondFrameIndex).toBeGreaterThan(firstFrameIndex);
    expect(openIndex).toBeGreaterThan(secondFrameIndex);
  });

  it("cancels pending enter animation work on close and unmount", () => {
    expect(source).toContain(
      "clearMotionDockOpenAnimationFrame();\n      if (open)",
    );
    expect(source).toContain("window.cancelAnimationFrame");
    expect(source).toContain("clearMotionDockOpenAnimationFrame();\n    },");
  });
});
