import type {
  NativeInstancePreviewRequest,
  NativeInstancePreviewResult,
} from "@shared/native-instance-preview-contract";

export class NativeInstancePreviewClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "reply-unreadable"
      | "request-timeout"
      | "request-aborted",
  ) {
    super(code);
    this.name = "NativeInstancePreviewClientError";
  }
}

const TOKEN = /^[A-Za-z0-9_-]{1,80}$/;
const NODE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function readNativeInstancePreviewResult(
  value: unknown,
): NativeInstancePreviewResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "native-effect-instance-result" ||
    data.schemaVersion !== 1 ||
    typeof data.requestId !== "string" ||
    !TOKEN.test(data.requestId) ||
    !Number.isSafeInteger(data.sequence) ||
    (data.sequence as number) < 1 ||
    typeof data.runtimeEpoch !== "string" ||
    !TOKEN.test(data.runtimeEpoch) ||
    typeof data.instanceId !== "string" ||
    !NODE.test(data.instanceId) ||
    typeof data.nodeId !== "string" ||
    !NODE.test(data.nodeId) ||
    !["pending", "ready", "error"].includes(String(data.status)) ||
    !["preview", "published"].includes(String(data.displayed)) ||
    (data.code !== undefined &&
      (typeof data.code !== "string" || data.code.length > 80)) ||
    (data.message !== undefined &&
      (typeof data.message !== "string" || data.message.length > 500))
  )
    return null;
  return data as NativeInstancePreviewResult;
}

export function sendNativeInstancePreviewMessage(args: {
  targetWindow: Window;
  message: NativeInstancePreviewRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<NativeInstancePreviewResult> {
  const { targetWindow, message, signal } = args;
  if (signal?.aborted)
    return Promise.reject(
      new NativeInstancePreviewClientError("request-aborted"),
    );
  const origin = window.location.origin;
  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 5_000, 1), 10_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(timer);
    };
    const finish = (
      result: NativeInstancePreviewResult | NativeInstancePreviewClientError,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof NativeInstancePreviewClientError) reject(result);
      else resolve(result);
    };
    const onAbort = () =>
      finish(new NativeInstancePreviewClientError("request-aborted"));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== targetWindow || event.origin !== origin) return;
      const raw = event.data;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const envelope = raw as Record<string, unknown>;
      if (
        envelope.type !== "native-effect-instance-result" ||
        envelope.requestId !== message.requestId
      )
        return;
      const result = readNativeInstancePreviewResult(raw);
      if (
        !result ||
        result.sequence !== message.sequence ||
        result.runtimeEpoch !== message.runtimeEpoch ||
        result.instanceId !== message.instanceId ||
        result.nodeId !== message.nodeId
      ) {
        finish(new NativeInstancePreviewClientError("reply-unreadable"));
        return;
      }
      if (result.status !== "pending") finish(result);
    };
    const timer = window.setTimeout(
      () => finish(new NativeInstancePreviewClientError("request-timeout")),
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
      finish(new NativeInstancePreviewClientError("frame-unavailable"));
    }
  });
}
