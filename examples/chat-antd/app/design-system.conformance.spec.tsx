import { assertDesignSystemConformance } from "@agent-native/toolkit/conformance";
import { DESIGN_SYSTEM_CONTRACT_VERSION } from "@agent-native/toolkit/design-system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { designSystem } from "./design-system";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Ant Design adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // This single assertion mounts and exercises the complete adapter surface.
  // During workspace prep its React transforms share CPU with every package
  // suite, so use a bounded integration-test budget instead of Vitest's generic
  // unit-test default.
  it(
    "passes the complete toolkit conformance suite",
    { timeout: 15_000 },
    async () => {
      const report = await assertDesignSystemConformance({
        adapterName: "Ant Design example",
        components: designSystem.components!,
        contractVersion: DESIGN_SYSTEM_CONTRACT_VERSION,
      });
      expect(report.passed).toBe(true);
    },
  );
});
