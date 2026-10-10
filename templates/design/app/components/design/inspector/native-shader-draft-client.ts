import type {
  NativeDraftPreviewMessage,
  NativeDraftPreviewResult,
} from "@shared/native-draft-preview-contract";

export class NativeDraftClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "reply-unreadable"
      | "request-timeout"
      | "request-aborted",
  ) {
    super(code);
    this.name = "NativeDraftClientError";
  }
}

const TOKEN = /^[a-zA-Z0-9_-]{1,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 120_000
  );
}

export function readNativeDraftPreviewResult(
  value: unknown,
): NativeDraftPreviewResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "native-shader-draft-result" ||
    data.schemaVersion !== 1 ||
    !boundedText(data.requestId, 80) ||
    !TOKEN.test(data.requestId) ||
    !boundedText(data.runtimeEpoch, 80) ||
    !TOKEN.test(data.runtimeEpoch) ||
    !boundedText(data.instanceId, 128) ||
    !["pending", "ready", "last-good", "error"].includes(String(data.status)) ||
    !["none", "published", "draft-current", "draft-last-good"].includes(
      String(data.displayed),
    ) ||
    (data.status === "ready" &&
      data.displayed !== "published" &&
      data.displayed !== "draft-current") ||
    (data.status === "last-good" && data.displayed !== "draft-last-good") ||
    (data.status === "error" && data.displayed === "draft-current") ||
    (data.executionHash !== undefined &&
      (typeof data.executionHash !== "string" ||
        !SHA256.test(data.executionHash))) ||
    !Array.isArray(data.diagnostics) ||
    data.diagnostics.length > 16
  )
    return null;
  const diagnostics: NativeDraftPreviewResult["diagnostics"] = [];
  for (const item of data.diagnostics) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const diagnostic = item as Record<string, unknown>;
    if (
      !boundedText(diagnostic.code, 80) ||
      !boundedText(diagnostic.message, 500) ||
      !["error", "warning", "info"].includes(String(diagnostic.severity)) ||
      (diagnostic.passId !== undefined &&
        !boundedText(diagnostic.passId, 128)) ||
      (diagnostic.line !== undefined &&
        (!Number.isInteger(diagnostic.line) ||
          (diagnostic.line as number) < 1 ||
          (diagnostic.line as number) > 100_000)) ||
      (diagnostic.column !== undefined &&
        (!Number.isInteger(diagnostic.column) ||
          (diagnostic.column as number) < 1 ||
          (diagnostic.column as number) > 100_000))
    )
      return null;
    diagnostics.push(
      diagnostic as NativeDraftPreviewResult["diagnostics"][number],
    );
  }
  if (
    data.timings !== undefined &&
    (!data.timings ||
      typeof data.timings !== "object" ||
      Array.isArray(data.timings) ||
      ("compileWallMs" in data.timings &&
        !boundedTime(data.timings.compileWallMs)) ||
      ("renderWallMs" in data.timings &&
        !boundedTime(data.timings.renderWallMs)))
  )
    return null;
  return data as NativeDraftPreviewResult;
}

export function findNativeDraftFrame(
  fileId: string,
  boardFile = false,
): HTMLIFrameElement {
  const matches = boardFile
    ? Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "[data-board-surface-layer] iframe[data-design-preview-iframe]",
        ),
      )
    : Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe][data-screen-iframe-id]",
        ),
      ).filter((frame) => frame.dataset.screenIframeId === fileId);
  if (matches.length !== 1 || !matches[0].contentWindow)
    throw new NativeDraftClientError("frame-unavailable");
  return matches[0];
}

export function sendNativeDraftMessage(args: {
  targetWindow: Window;
  message: NativeDraftPreviewMessage;
  signal?: AbortSignal;
  timeoutMs?: number;
  onPending?: (result: NativeDraftPreviewResult) => void;
}): Promise<NativeDraftPreviewResult> {
  const { targetWindow, message, signal, onPending } = args;
  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 15_000, 1), 30_000);
  if (signal?.aborted)
    return Promise.reject(new NativeDraftClientError("request-aborted"));
  const origin = window.location.origin;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(timer);
    };
    const finish = (
      result: NativeDraftPreviewResult | NativeDraftClientError,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof NativeDraftClientError) reject(result);
      else resolve(result);
    };
    const onAbort = () => finish(new NativeDraftClientError("request-aborted"));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== targetWindow || event.origin !== origin) return;
      const raw = event.data;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const envelope = raw as Record<string, unknown>;
      if (
        envelope.type !== "native-shader-draft-result" ||
        envelope.requestId !== message.requestId
      )
        return;
      const result = readNativeDraftPreviewResult(raw);
      if (
        !result ||
        result.runtimeEpoch !== message.runtimeEpoch ||
        result.instanceId !== message.instanceId
      ) {
        finish(new NativeDraftClientError("reply-unreadable"));
        return;
      }
      if (result.status === "pending") onPending?.(result);
      else finish(result);
    };
    const timer = window.setTimeout(
      () => finish(new NativeDraftClientError("request-timeout")),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      targetWindow.postMessage(message, origin);
    } catch {
      finish(new NativeDraftClientError("frame-unavailable"));
    }
  });
}
