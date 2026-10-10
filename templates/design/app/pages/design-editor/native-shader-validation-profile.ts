import {
  nativeShaderValidationSceneProfileSchema,
  type NativeShaderValidationSceneProfile,
} from "@shared/native-shader-validation";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function unavailableMountedSceneProfile(
  code: Extract<
    NativeShaderValidationSceneProfile,
    { state: "unavailable" }
  >["code"],
): NativeShaderValidationSceneProfile {
  return {
    state: "unavailable",
    scope: "mounted-scene",
    capturedAt: Date.now(),
    code,
  };
}

export function readMountedSceneProfile(
  runtime: unknown,
  target?: {
    instanceId: string;
    afterFrameIndex?: number;
    throughFrameIndex?: number;
  },
): NativeShaderValidationSceneProfile {
  if (
    !record(runtime) ||
    typeof runtime.profile !== "function" ||
    typeof runtime.previewStatus !== "function"
  )
    return unavailableMountedSceneProfile("profile-unavailable");
  let raw: unknown;
  let preview: unknown;
  try {
    raw = runtime.profile(
      target ? { instanceId: target.instanceId } : undefined,
    );
    preview = runtime.previewStatus();
  } catch {
    return unavailableMountedSceneProfile("profile-unreadable");
  }
  if (!record(raw) || !record(raw.textures) || !record(preview))
    return unavailableMountedSceneProfile("profile-unreadable");
  if (
    target &&
    (raw.gpuTargetInstanceId !== target.instanceId ||
      raw.gpuScope !== "target-mount-command-encoder-not-full-scene" ||
      (target.afterFrameIndex !== undefined &&
        (!Number.isSafeInteger(target.afterFrameIndex) ||
          target.afterFrameIndex < -1)) ||
      (target.throughFrameIndex !== undefined &&
        (target.afterFrameIndex === undefined ||
          !Number.isSafeInteger(target.throughFrameIndex) ||
          target.throughFrameIndex < target.afterFrameIndex)))
  )
    return unavailableMountedSceneProfile("profile-unreadable");
  const textures = raw.textures;
  const candidate = {
    state: "available",
    scope: "mounted-scene",
    sampleWindow: "rolling-120-render/raf",
    capturedAt: Date.now(),
    renderWallMs: raw.renderWallMs,
    rafIntervalMs: raw.rafIntervalMs,
    preview: {
      requestedQuality: preview.requestedQuality,
      frameRateTarget: preview.frameRateTarget,
      effectivePixelRatio: preview.effectivePixelRatio,
    },
    textures: {
      allocatedBytes: textures.allocatedBytes,
      mountedBytes: textures.mountedBytes,
      queuedRetirementBytes: textures.queuedRetirementBytes,
      inFlightRetirementBytes: textures.inFlightRetirementBytes,
      sharedBytes: textures.sharedBytes,
      unattributedBytes: textures.unattributedBytes,
      omittedMounts: textures.omittedMounts,
    },
    gpu: raw.gpu,
    ...(target
      ? { gpuTargetInstanceId: raw.gpuTargetInstanceId, gpuScope: raw.gpuScope }
      : {}),
  };
  const parsed = nativeShaderValidationSceneProfileSchema.safeParse(candidate);
  if (!parsed.success)
    return unavailableMountedSceneProfile("profile-unreadable");
  if (
    target?.afterFrameIndex !== undefined &&
    parsed.data.state === "available" &&
    parsed.data.gpu.kind === "ready" &&
    parsed.data.gpu.frameIndex <= target.afterFrameIndex
  )
    return {
      ...parsed.data,
      gpu: {
        kind: "error",
        code: "stale-sample",
        estimatedResourceBytes: parsed.data.gpu.estimatedResourceBytes,
      },
    };
  if (
    target?.throughFrameIndex !== undefined &&
    parsed.data.state === "available" &&
    parsed.data.gpu.kind === "ready" &&
    parsed.data.gpu.frameIndex > target.throughFrameIndex
  )
    return {
      ...parsed.data,
      gpu: {
        kind: "error",
        code: "outside-window",
        estimatedResourceBytes: parsed.data.gpu.estimatedResourceBytes,
      },
    };
  return parsed.data;
}
