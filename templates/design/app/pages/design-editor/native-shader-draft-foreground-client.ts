import type { NativeDraftPreviewResult } from "@shared/native-draft-preview-contract";
import type { EffectDefinition } from "@shared/native-effects";
import {
  nativeDraftForegroundStateSchema,
  type NativeDraftForegroundState,
  type NativeDraftTerminal,
} from "@shared/native-shader-draft-foreground";

import { readNativeShaderRuntimeStatus } from "@/components/design/design-canvas/native-status-bridge";
import {
  findNativeDraftFrame,
  sendNativeDraftMessage,
} from "@/components/design/inspector/native-shader-draft-client";

export class NativeDraftForegroundClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "runtime-unavailable"
      | "request-aborted"
      | "payload-unreadable"
      | "request-stale",
  ) {
    super(code);
    this.name = "NativeDraftForegroundClientError";
  }
}

export type NativeDraftOpenResult = {
  state: NativeDraftForegroundState;
  payload: {
    definition: EffectDefinition;
    params: Record<string, unknown>;
    seed: number;
    time: number;
  } | null;
};

function frameFor(fileId: string): HTMLIFrameElement {
  try {
    return findNativeDraftFrame(fileId);
  } catch {
    return findNativeDraftFrame(fileId, true);
  }
}

function readPayload(value: unknown): {
  definition: EffectDefinition;
  params: Record<string, unknown>;
  seed: number;
  time: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeDraftForegroundClientError("payload-unreadable");
  const data = value as Record<string, unknown>;
  if (
    !data.definition ||
    typeof data.definition !== "object" ||
    !data.params ||
    typeof data.params !== "object" ||
    Array.isArray(data.params) ||
    !Number.isInteger(data.seed) ||
    typeof data.time !== "number" ||
    !Number.isFinite(data.time)
  )
    throw new NativeDraftForegroundClientError("payload-unreadable");
  return data as ReturnType<typeof readPayload>;
}

async function runtimeEpoch(
  frame: HTMLIFrameElement,
  state: NativeDraftForegroundState,
  signal: AbortSignal,
): Promise<string> {
  const target = frame.contentWindow;
  if (!target) throw new NativeDraftForegroundClientError("frame-unavailable");
  const requestId = `draft_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      window.clearTimeout(timer);
    };
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onAbort = () =>
      finish(new NativeDraftForegroundClientError("request-aborted"));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== window.location.origin)
        return;
      const status = readNativeShaderRuntimeStatus(event.data);
      if (
        status?.requestId !== requestId ||
        status.instanceId !== state.instanceId ||
        status.nodeId !== state.nodeId
      )
        return;
      if (status.backend !== "webgpu")
        finish(new NativeDraftForegroundClientError("runtime-unavailable"));
      else finish(status.runtimeEpoch);
    };
    const timer = window.setTimeout(
      () => finish(new NativeDraftForegroundClientError("runtime-unavailable")),
      3000,
    );
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    target.postMessage(
      {
        type: "native-shader-status-request",
        requestId,
        instanceId: state.instanceId,
        nodeId: state.nodeId,
      },
      window.location.origin,
    );
  });
}

function terminal(result: NativeDraftPreviewResult): NativeDraftTerminal {
  if (result.status === "pending")
    throw new NativeDraftForegroundClientError("payload-unreadable");
  return {
    status: result.status,
    displayed: result.displayed,
    executionHash: result.executionHash,
    diagnostics: result.diagnostics,
    compileWallMs: result.timings?.compileWallMs,
    renderWallMs: result.timings?.renderWallMs,
  };
}

export async function previewNativeShaderDraftInEditor(args: {
  state: NativeDraftForegroundState;
  payload: unknown;
  signal: AbortSignal;
}): Promise<NativeDraftTerminal> {
  const { state, signal } = args;
  if (signal.aborted || Date.now() >= state.expiresAt)
    throw new NativeDraftForegroundClientError("request-aborted");
  const frame = frameFor(state.fileId);
  const target = frame.contentWindow;
  if (!target) throw new NativeDraftForegroundClientError("frame-unavailable");
  const epoch = await runtimeEpoch(frame, state, signal);
  const requestId = `draft_${state.requestId.replace(/-/g, "")}`;
  const payload =
    state.command === "preview" ? readPayload(args.payload) : null;
  const message =
    state.command === "clear"
      ? {
          type: "native-shader-draft-control" as const,
          schemaVersion: 1 as const,
          requestId,
          runtimeEpoch: epoch,
          instanceId: state.instanceId,
          baseExecutionHash: state.baseExecutionHash,
          command: "clear" as const,
        }
      : {
          type: "native-shader-draft-preview" as const,
          schemaVersion: 1 as const,
          requestId,
          runtimeEpoch: epoch,
          instanceId: state.instanceId,
          nodeId: state.nodeId,
          baseExecutionHash: state.baseExecutionHash,
          expectedExecutionHash: state.draftExecutionHash!,
          draftDefinition: payload!.definition,
          params: payload!.params,
          seed: payload!.seed,
          time: payload!.time,
        };
  const result = await sendNativeDraftMessage({
    targetWindow: target,
    message,
    signal,
    timeoutMs: Math.min(30000, Math.max(1, state.expiresAt - Date.now())),
  });
  if (
    result.status === "ready" &&
    state.command === "preview" &&
    result.executionHash !== state.draftExecutionHash
  )
    throw new NativeDraftForegroundClientError("request-stale");
  return terminal(result);
}

export async function clearCanceledNativeShaderDraft(
  state: NativeDraftForegroundState,
): Promise<void> {
  const frame = frameFor(state.fileId);
  const target = frame.contentWindow;
  if (!target) throw new NativeDraftForegroundClientError("frame-unavailable");
  const epoch = await runtimeEpoch(frame, state, new AbortController().signal);
  const result = await sendNativeDraftMessage({
    targetWindow: target,
    timeoutMs: 3_000,
    message: {
      type: "native-shader-draft-control",
      schemaVersion: 1,
      requestId: `clear_${crypto.randomUUID().replace(/-/g, "")}`,
      runtimeEpoch: epoch,
      instanceId: state.instanceId,
      baseExecutionHash: state.baseExecutionHash,
      command: "clear",
    },
  });
  if (result.status !== "ready" || result.displayed !== "published")
    throw new NativeDraftForegroundClientError("runtime-unavailable");
}

export function readNativeDraftForegroundState(
  value: unknown,
): NativeDraftForegroundState {
  return nativeDraftForegroundStateSchema.parse(value);
}
