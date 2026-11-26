import { describe, expect, it } from "vitest";

import { getDesignCanvasIframeSandbox } from "./design-canvas/external-preview";

// oracle-change: removed canvas source greps; sandbox flags are asserted in DesignCanvas.embedded-frame.test.ts

describe("Design snapshot iframe sandbox", () => {
  it("uses only script permission for shared Visual Edit snapshots", () => {
    expect(
      getDesignCanvasIframeSandbox({
        externalPreview: false,
        readOnly: true,
        snapshotOnly: true,
      }),
    ).toBe("allow-scripts");
  });
});
