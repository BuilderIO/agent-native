// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultDesignSystemComponents } from "../design-system/default-adapter.js";
import { DESIGN_SYSTEM_CONTRACT_VERSION } from "../design-system/types.js";
import { cssInJsFixtureAdapter } from "./__fixtures__/css-in-js-adapter.js";
import {
  assertDesignSystemConformance,
  DESIGN_SYSTEM_CONFORMANCE_CHECKS,
  runDesignSystemConformance,
} from "./runner.js";
import {
  assertDesignSystemContractVersion,
  DESIGN_SYSTEM_CONTRACT_EVOLUTION_POLICY,
} from "./version.js";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("design-system conformance kit", () => {
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

  it("publishes named coverage for all seventeen components and overlay concerns", () => {
    const covered = new Set(
      DESIGN_SYSTEM_CONFORMANCE_CHECKS.flatMap((check) => check.components),
    );
    expect(covered.size).toBe(17);
    expect(DESIGN_SYSTEM_CONFORMANCE_CHECKS.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "overlay.portal-and-z-index-stacking",
        "overlay.focus-interoperability",
      ]),
    );
  });

  it("enforces the published contract evolution policy", () => {
    expect(DESIGN_SYSTEM_CONTRACT_EVOLUTION_POLICY.minor).toContain(
      "optional props",
    );
    expect(DESIGN_SYSTEM_CONTRACT_EVOLUTION_POLICY.major).toContain(
      "behavioral",
    );
    expect(() =>
      assertDesignSystemContractVersion(DESIGN_SYSTEM_CONTRACT_VERSION),
    ).not.toThrow();
    expect(() => assertDesignSystemContractVersion(2)).toThrow(/incompatible/);
  });

  it("passes the styling-independent CSS-in-JS fixture", async () => {
    const report = await assertDesignSystemConformance({
      adapterName: "CSS-in-JS fixture",
      components: cssInJsFixtureAdapter,
      contractVersion: DESIGN_SYSTEM_CONTRACT_VERSION,
    });
    expect(report.passed).toBe(true);
  });

  it("passes the default shadcn and Radix adapter", async () => {
    const report = await runDesignSystemConformance({
      adapterName: "Toolkit default",
      components: defaultDesignSystemComponents,
      contractVersion: DESIGN_SYSTEM_CONTRACT_VERSION,
    });
    expect(report.results.filter((result) => !result.passed)).toEqual([]);
  });
});
