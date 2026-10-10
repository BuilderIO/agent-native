export function nativeRuntimeDiagnosticKey(code: string | undefined) {
  switch (code) {
    case "render-pending":
      return "editPanel.shaders.nativeRenderPendingDetail" as const;
    case "fill-group-incomplete":
      return "editPanel.shaders.nativeFillGroupIncompleteDetail" as const;
    case "backdrop-replacement-isolation-unsupported":
    case "backdrop-target-opacity-unsupported":
    case "backdrop-text-replacement-unsupported":
    case "scene-background-unsupported":
    case "scene-direct-element-unsupported":
    case "scene-direct-text-unsupported":
    case "scene-presentation-limit":
    case "scene-presentation-transform-unsupported":
    case "source-svg-pattern-work-limit":
    case "source-svg-pattern-unsupported":
    case "source-svg-reference-kind-unsupported":
    case "source-svg-reference-cycle":
    case "source-unsupported-clip-margin":
    case "source-svg-unsupported-clip-margin":
    case "source-capture-backdrop-unsupported":
    case "source-capture-text-unsupported":
    case "source-capture-too-large":
    case "source-svg-capture-too-large":
    case "scene-scroll-unsupported":
    case "source-group-local-chain-unsupported":
    case "source-group-local-effect-unsupported":
    case "source-group-local-geometry-unsupported":
    case "effect-dependency-cycle":
      return "editPanel.shaders.nativeSceneUnsupportedDetail" as const;
    case "scene-generation-changed":
    case "scene-viewport-changed":
    case "scene-frame-incomplete":
    case "source-epoch-stale":
    case "source-capture-geometry-stale":
      return "editPanel.shaders.nativeSceneChangedDetail" as const;
    case "backdrop-replacement-unavailable":
    case "scene-opacity-unreadable":
    case "scene-presentation-unavailable":
    case "scene-source-unavailable":
    case "source-overflow-unreadable":
    case "source-svg-overflow-unreadable":
    case "source-clip-margin-unreadable":
    case "source-clip-margin-unavailable":
    case "source-svg-clip-margin-unreadable":
    case "source-svg-clip-margin-unavailable":
    case "source-capture-geometry-missing":
    case "source-capture-geometry-invalid":
    case "source-svg-capture-geometry-invalid":
    case "source-invalid-geometry":
    case "native-dependency-missing":
    case "stateless-compute-definition-invalid":
    case "stateless-compute-source-invalid":
    case "stateless-compute-parameters-invalid":
    case "stateless-compute-limits-unavailable":
    case "stateless-compute-device-limit":
    case "stateless-compute-bytes-unavailable":
    case "stateless-compute-budget-exceeded":
    case "stateless-compute-frame-invalid":
    case "stateless-compute-shader-invalid":
    case "native-uniform-timing-invalid":
    case "export-initial-density-invalid":
    case "source-composition-bytes-unavailable":
    case "source-composition-plane-unavailable":
      return "editPanel.shaders.nativeSceneUnavailableDetail" as const;
    case "source-image-rendering-value":
    case "source-image-rendering-geometry":
    case "source-image-rendering-pixelated-scale":
    case "source-image-rendering-downsample":
      return "editPanel.shaders.nativeImageSamplingUnsupportedDetail" as const;
    default:
      return null;
  }
}
