import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { MotionDock } from "./MotionDock";

describe("MotionDock layout", () => {
  it("frees canvas layout space immediately while the closed panel slides away", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 1000,
          open: false,
        }),
      ),
    );

    expect(markup).toContain('style="height:0"');
    expect(markup).toContain("absolute inset-x-0 bottom-0 z-40");
    expect(markup).toContain("translate-y-full");
    expect(markup).not.toContain("absolute inset-x-0 top-0 z-40");
  });

  it("reserves dock layout space only while open", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 1000,
          open: true,
        }),
      ),
    );

    expect(markup).toContain('style="height:280px"');
    expect(markup).toContain("translate-y-0");
    expect(markup).not.toContain("translate-y-full");
  });
});
