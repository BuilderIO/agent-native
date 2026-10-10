import {
  findNativeDraftFrame,
  NativeDraftClientError,
} from "./native-shader-draft-client";

export type NativeLabGpuProfile =
  | {
      kind: "ready";
      frameIndex: number;
      passCount: number;
      gpuPassSumMs: number;
    }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "error" };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNativeLabGpuProfile(
  value: unknown,
  instanceId?: string,
): NativeLabGpuProfile {
  if (
    instanceId !== undefined &&
    (!record(value) ||
      value.gpuTargetInstanceId !== instanceId ||
      value.gpuScope !== "target-mount-command-encoder-not-full-scene")
  )
    return { kind: "error" };
  if (!record(value) || !record(value.gpu)) return { kind: "error" };
  const gpu = value.gpu;
  if (gpu.kind === "pending")
    return Number.isSafeInteger(gpu.estimatedResourceBytes) &&
      (gpu.estimatedResourceBytes as number) >= 0
      ? { kind: "pending" }
      : { kind: "error" };
  if (gpu.kind === "unavailable")
    return [
      "timestamp-query-unavailable",
      "device-lost",
      "disposed",
      "target-unavailable",
    ].includes(String(gpu.code))
      ? { kind: "unavailable" }
      : { kind: "error" };
  if (gpu.kind === "error") return { kind: "error" };
  if (
    gpu.kind !== "ready" ||
    !Number.isSafeInteger(gpu.frameIndex) ||
    (gpu.frameIndex as number) < 0 ||
    !Number.isSafeInteger(gpu.passCount) ||
    (gpu.passCount as number) < 1 ||
    (gpu.passCount as number) > 32 ||
    typeof gpu.gpuPassSumMs !== "number" ||
    !Number.isFinite(gpu.gpuPassSumMs) ||
    gpu.gpuPassSumMs < 0 ||
    gpu.gpuPassSumMs > 60_000 ||
    !Array.isArray(gpu.passes) ||
    gpu.passes.length !== gpu.passCount
  )
    return { kind: "error" };
  for (const pass of gpu.passes)
    if (
      !record(pass) ||
      typeof pass.label !== "string" ||
      pass.label.length < 1 ||
      pass.label.length > 140 ||
      (instanceId !== undefined && !pass.label.startsWith(`${instanceId}:`)) ||
      typeof pass.gpuMs !== "number" ||
      !Number.isFinite(pass.gpuMs) ||
      pass.gpuMs < 0 ||
      pass.gpuMs > 60_000
    )
      return { kind: "error" };
  return {
    kind: "ready",
    frameIndex: gpu.frameIndex as number,
    passCount: gpu.passCount as number,
    gpuPassSumMs: gpu.gpuPassSumMs,
  };
}

export function readNativeLabGpuProfileFromFrame(
  fileId: string,
  boardFile: boolean,
  instanceId: string,
): NativeLabGpuProfile {
  try {
    const runtime = findNativeDraftFrame(fileId, boardFile).contentWindow as
      | (Window & {
          __anNativeShaders?: {
            profile?: (options: { instanceId: string }) => unknown;
          };
        })
      | null;
    if (!runtime?.__anNativeShaders?.profile) return { kind: "unavailable" };
    return readNativeLabGpuProfile(
      runtime.__anNativeShaders.profile({ instanceId }),
      instanceId,
    );
  } catch (error) {
    if (
      error instanceof NativeDraftClientError &&
      error.code === "frame-unavailable"
    )
      return { kind: "unavailable" };
    return { kind: "error" };
  }
}
