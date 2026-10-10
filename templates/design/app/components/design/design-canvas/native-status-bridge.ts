export type NativeFeedbackPlaybackStatus = {
  mode: "interactive";
  disposition: "exact" | "clamped";
  requestedLocalSeconds: number;
  simulationLocalSeconds: number;
  droppedLocalSeconds: number;
};

export type NativeShaderRuntimeStatus = {
  type: "native-shader-status";
  schemaVersion: 1;
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  status: "ready" | "last-good" | "error" | "unavailable";
  backend: "webgpu" | "unavailable";
  code?: string;
  message?: string;
  requestId?: string;
  frames: number;
  sourceCaptures: number;
  estimatedResourceBytes: number;
  renderWallMs?: number;
  playback?: NativeFeedbackPlaybackStatus;
};

function boundedCount(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
  );
}

function readFeedbackPlayback(
  value: unknown,
): NativeFeedbackPlaybackStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      [
        "mode",
        "disposition",
        "requestedLocalSeconds",
        "simulationLocalSeconds",
        "droppedLocalSeconds",
      ].includes(key),
    ) ||
    data.mode !== "interactive" ||
    (data.disposition !== "exact" && data.disposition !== "clamped") ||
    !boundedCount(data.requestedLocalSeconds, 1_000_000_000) ||
    !boundedCount(data.simulationLocalSeconds, 1_000_000_000) ||
    !boundedCount(data.droppedLocalSeconds, 1_000_000_000)
  )
    return null;
  const requested = data.requestedLocalSeconds as number;
  const simulated = data.simulationLocalSeconds as number;
  const dropped = data.droppedLocalSeconds as number;
  if (
    simulated > requested + 1e-6 ||
    Math.abs(requested - simulated - dropped) > 1e-6 ||
    (data.disposition === "exact" && dropped > 1e-9) ||
    (data.disposition === "clamped" && dropped <= 1e-9)
  )
    return null;
  return {
    mode: "interactive",
    disposition:
      data.disposition as NativeFeedbackPlaybackStatus["disposition"],
    requestedLocalSeconds: requested,
    simulationLocalSeconds: simulated,
    droppedLocalSeconds: dropped,
  };
}

export function readNativeShaderRuntimeStatus(
  value: unknown,
): NativeShaderRuntimeStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.type !== "native-shader-status" || data.schemaVersion !== 1)
    return null;
  const playback =
    data.playback === undefined ? null : readFeedbackPlayback(data.playback);
  if (
    (data.playback !== undefined && !playback) ||
    (playback && (data.status !== "ready" || data.backend !== "webgpu"))
  )
    return null;
  if (
    typeof data.instanceId !== "string" ||
    data.instanceId.length < 1 ||
    data.instanceId.length > 128 ||
    typeof data.nodeId !== "string" ||
    data.nodeId.length < 1 ||
    data.nodeId.length > 128 ||
    typeof data.runtimeEpoch !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(data.runtimeEpoch) ||
    typeof data.status !== "string" ||
    !["ready", "last-good", "error", "unavailable"].includes(data.status) ||
    typeof data.backend !== "string" ||
    !["webgpu", "unavailable"].includes(data.backend) ||
    ((data.status === "ready" || data.status === "last-good") &&
      data.backend !== "webgpu") ||
    (data.code !== undefined &&
      (typeof data.code !== "string" || data.code.length > 80)) ||
    (data.message !== undefined &&
      (typeof data.message !== "string" || data.message.length > 300)) ||
    (data.requestId !== undefined &&
      (typeof data.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(data.requestId))) ||
    !boundedCount(data.frames, 1_000_000_000) ||
    !Number.isInteger(data.frames) ||
    !boundedCount(data.sourceCaptures, 1_000_000_000) ||
    !Number.isInteger(data.sourceCaptures) ||
    !boundedCount(data.estimatedResourceBytes, 1_000_000_000_000) ||
    (data.renderWallMs !== undefined &&
      !boundedCount(data.renderWallMs, 1_000_000))
  )
    return null;
  return {
    type: "native-shader-status",
    schemaVersion: 1,
    runtimeEpoch: data.runtimeEpoch as string,
    instanceId: data.instanceId as string,
    nodeId: data.nodeId as string,
    status: data.status as NativeShaderRuntimeStatus["status"],
    backend: data.backend as NativeShaderRuntimeStatus["backend"],
    ...(data.code !== undefined ? { code: data.code as string } : {}),
    ...(data.message !== undefined ? { message: data.message as string } : {}),
    ...(data.requestId !== undefined
      ? { requestId: data.requestId as string }
      : {}),
    frames: data.frames as number,
    sourceCaptures: data.sourceCaptures as number,
    estimatedResourceBytes: data.estimatedResourceBytes as number,
    ...(data.renderWallMs !== undefined
      ? { renderWallMs: data.renderWallMs as number }
      : {}),
    ...(playback ? { playback } : {}),
  };
}
