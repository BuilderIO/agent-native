import { describe, expect, it } from "vitest";

import { NativeUniformTimingError } from "../../../../shared/native-uniform-timing";
import { nativeRuntimeDiagnosticKey } from "./native-runtime-diagnostic";

describe("native runtime diagnostic labels", () => {
  it("maps stable status codes to localized details", () => {
    expect(nativeRuntimeDiagnosticKey("render-pending")).toBe(
      "editPanel.shaders.nativeRenderPendingDetail",
    );
    expect(nativeRuntimeDiagnosticKey("fill-group-incomplete")).toBe(
      "editPanel.shaders.nativeFillGroupIncompleteDetail",
    );
    expect(nativeRuntimeDiagnosticKey("scene-scroll-unsupported")).toBe(
      "editPanel.shaders.nativeSceneUnsupportedDetail",
    );
    expect(nativeRuntimeDiagnosticKey("scene-frame-incomplete")).toBe(
      "editPanel.shaders.nativeSceneChangedDetail",
    );
    expect(nativeRuntimeDiagnosticKey("scene-source-unavailable")).toBe(
      "editPanel.shaders.nativeSceneUnavailableDetail",
    );
    expect(nativeRuntimeDiagnosticKey("export-initial-density-invalid")).toBe(
      "editPanel.shaders.nativeSceneUnavailableDetail",
    );
    for (const code of [
      "source-svg-pattern-work-limit",
      "source-svg-pattern-unsupported",
      "source-svg-reference-kind-unsupported",
      "source-svg-reference-cycle",
    ])
      expect(nativeRuntimeDiagnosticKey(code)).toBe(
        "editPanel.shaders.nativeSceneUnsupportedDetail",
      );
    expect(
      nativeRuntimeDiagnosticKey("source-group-local-effect-unsupported"),
    ).toBe("editPanel.shaders.nativeSceneUnsupportedDetail");
    expect(nativeRuntimeDiagnosticKey("source-epoch-stale")).toBe(
      "editPanel.shaders.nativeSceneChangedDetail",
    );
    expect(nativeRuntimeDiagnosticKey("source-capture-geometry-stale")).toBe(
      "editPanel.shaders.nativeSceneChangedDetail",
    );
    expect(nativeRuntimeDiagnosticKey("gpu-validation")).toBeNull();
    for (const code of [
      "source-unsupported-clip-margin",
      "source-svg-unsupported-clip-margin",
      "source-capture-backdrop-unsupported",
      "source-capture-text-unsupported",
      "source-capture-too-large",
    ])
      expect(nativeRuntimeDiagnosticKey(code)).toBe(
        "editPanel.shaders.nativeSceneUnsupportedDetail",
      );
    for (const code of [
      "source-overflow-unreadable",
      "source-svg-overflow-unreadable",
      "source-clip-margin-unreadable",
      "source-clip-margin-unavailable",
      "source-svg-clip-margin-unreadable",
      "source-svg-clip-margin-unavailable",
      "source-capture-geometry-missing",
      "source-capture-geometry-invalid",
    ])
      expect(nativeRuntimeDiagnosticKey(code)).toBe(
        "editPanel.shaders.nativeSceneUnavailableDetail",
      );
  });
});

describe("native image sampling diagnostics", () => {
  it.each(["value", "geometry", "pixelated-scale", "downsample"])(
    "localizes %s without exposing raw English runtime copy",
    (reason) => {
      expect(
        nativeRuntimeDiagnosticKey(`source-image-rendering-${reason}`),
      ).toBe("editPanel.shaders.nativeImageSamplingUnsupportedDetail");
    },
  );
});

describe("native timing diagnostics", () => {
  it.each([
    "time",
    "initial-time",
    "step-time",
    "delta-time",
    "speed",
  ] as const)(
    "localizes a typed %s failure through the inspector diagnostic category",
    (field) => {
      const diagnostic = new NativeUniformTimingError(field);
      expect(nativeRuntimeDiagnosticKey(diagnostic.code)).toBe(
        "editPanel.shaders.nativeSceneUnavailableDetail",
      );
      expect(diagnostic.field).toBe(field);
      expect(diagnostic.message).toBe(`native-uniform-timing-invalid:${field}`);
      expect(nativeRuntimeDiagnosticKey("invented-timing-failure")).toBeNull();
    },
  );
});

describe("native composition accounting diagnostics", () => {
  it("localizes unavailable bytes without using the code as user-facing copy", () => {
    expect(
      nativeRuntimeDiagnosticKey("source-composition-bytes-unavailable"),
    ).toBe("editPanel.shaders.nativeSceneUnavailableDetail");
  });
});

describe("native composition plane diagnostics", () => {
  it("uses the existing localized unavailable category for an invalid plane lease", () => {
    expect(
      nativeRuntimeDiagnosticKey("source-composition-plane-unavailable"),
    ).toBe("editPanel.shaders.nativeSceneUnavailableDetail");
  });
});

describe("stateless compute diagnostics", () => {
  it.each([
    "stateless-compute-definition-invalid",
    "stateless-compute-source-invalid",
    "stateless-compute-parameters-invalid",
    "stateless-compute-limits-unavailable",
    "stateless-compute-device-limit",
    "stateless-compute-bytes-unavailable",
    "stateless-compute-budget-exceeded",
    "stateless-compute-frame-invalid",
    "stateless-compute-shader-invalid",
  ])("maps %s to the existing localized unavailable diagnostic", (code) => {
    expect(nativeRuntimeDiagnosticKey(code)).toBe(
      "editPanel.shaders.nativeSceneUnavailableDetail",
    );
  });
});
