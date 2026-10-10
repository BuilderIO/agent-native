import { findNativeDraftFrame } from "./native-shader-draft-client";

export type NativePreviewStatus = {
  requestedQuality: "auto" | "performance" | "quality";
  frameRateTarget: 60 | 120;
  devicePixelRatio: number;
  effectivePixelRatio: number;
  targetFrameIntervalMs: number;
  renderWallMs?: number;
  rafIntervalMs?: number;
};

export class NativePreviewPolicyError extends Error {
  constructor(readonly code: "frame-unavailable" | "status-unreadable") {
    super(code);
    this.name = "NativePreviewPolicyError";
  }
}

function finiteRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 16
  );
}
function finiteInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 120_000
  );
}

export function readNativePreviewStatus(value: unknown): NativePreviewStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativePreviewPolicyError("status-unreadable");
  const data = value as Record<string, unknown>;
  if (
    !["auto", "performance", "quality"].includes(
      String(data.requestedQuality),
    ) ||
    (data.frameRateTarget !== 60 && data.frameRateTarget !== 120) ||
    !finiteRatio(data.devicePixelRatio) ||
    !finiteRatio(data.effectivePixelRatio) ||
    !finiteInterval(data.targetFrameIntervalMs) ||
    data.targetFrameIntervalMs === 0 ||
    (data.renderWallMs !== undefined && !finiteInterval(data.renderWallMs)) ||
    (data.rafIntervalMs !== undefined && !finiteInterval(data.rafIntervalMs))
  )
    throw new NativePreviewPolicyError("status-unreadable");
  return data as NativePreviewStatus;
}

export function readSelectedNativePreviewStatus(
  fileId: string,
): NativePreviewStatus {
  let frame: HTMLIFrameElement;
  try {
    frame = findNativeDraftFrame(fileId);
  } catch {
    frame = findNativeDraftFrame(fileId, true);
  }
  try {
    const runtime = (
      frame.contentWindow as
        | (Window & { __anNativeShaders?: { previewStatus?: () => unknown } })
        | null
    )?.__anNativeShaders;
    if (!runtime?.previewStatus)
      throw new NativePreviewPolicyError("status-unreadable");
    return readNativePreviewStatus(runtime.previewStatus());
  } catch (error) {
    if (error instanceof NativePreviewPolicyError) throw error;
    throw new NativePreviewPolicyError("frame-unavailable");
  }
}
