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

  it("keeps the motion dock behind the secondary-panel experiment", () => {
    expect(source).toContain(
      "SHOW_DESIGN_SECONDARY_LEFT_PANELS &&\n      !initialGenerationChromeLimited &&\n      activeFile &&\n      motionDockMounted",
    );
    expect(source).toContain(
      "motionDisabled={!activeFile || initialGenerationChromeLimited}",
    );
  });

  it("keeps inspector motion controls gated and preserves explicit collapse", () => {
    expect(source).toContain(
      "motionKeyframeState: SHOW_DESIGN_SECONDARY_LEFT_PANELS\n      ? motionKeyframeState\n      : undefined,",
    );
    expect(source).toContain(
      "onToggleMotionKeyframe:\n      SHOW_DESIGN_SECONDARY_LEFT_PANELS && canEditDesign\n        ? handleToggleMotionKeyframe",
    );
    expect(source).toContain(
      'if (!initialGenerationChromeLimited) return;\n    setActiveLeftPanel("agent");\n  }, [initialGenerationChromeLimited]);',
    );
    expect(source).toContain(
      "if (panel === null && initialGenerationChromeLimited) return;",
    );
  });
});
