import {
  callAction,
  getBrowserTabId,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import {
  nativeLocalExportStateKey,
  nativeLocalExportStateSchema,
  type NativeLocalExportState,
} from "@shared/native-local-export";
import { useEffect, useRef } from "react";

type LocalExportFailureCode = NonNullable<
  NativeLocalExportState["failure"]
>["code"];

export type NativeLocalExportHandler = (
  request: NativeLocalExportState,
  signal: AbortSignal,
) => Promise<void>;

const documentIdKey = Symbol.for(
  "agent-native.design.local-export.document-id",
);

export function nativeLocalExportDocumentId(doc: Document): string {
  const existing = Reflect.get(doc, documentIdKey);
  if (existing !== undefined) {
    if (typeof existing !== "string" || !/^[0-9a-f-]{36}$/i.test(existing))
      throw new NativeLocalExportClientError(
        "client-unavailable",
        "The editor document identity is unreadable.",
      );
    return existing;
  }
  const id = crypto.randomUUID();
  Object.defineProperty(doc, documentIdKey, { value: id });
  return id;
}

export class NativeLocalExportClientError extends Error {
  constructor(
    readonly code: LocalExportFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "NativeLocalExportClientError";
  }
}

export async function executeNativeLocalExportRequest(args: {
  request: NativeLocalExportState;
  designId: string;
  tabId: string;
  documentId: string;
  signal: AbortSignal;
  onExport: NativeLocalExportHandler;
  invoke: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  observeCancellation: (
    claimed: NativeLocalExportState,
    onCancel: () => void,
    onFailure: (error: unknown) => void,
  ) => () => void;
}): Promise<void> {
  const {
    request,
    designId,
    tabId,
    documentId,
    signal,
    onExport,
    invoke,
    observeCancellation,
  } = args;
  if (
    request.designId !== designId ||
    request.tabId !== tabId ||
    request.status !== "pending"
  )
    throw new NativeLocalExportClientError(
      "client-unavailable",
      "The local export request does not match this editor tab.",
    );
  if (signal.aborted)
    throw new NativeLocalExportClientError("canceled", "Export was canceled.");
  const claimed = nativeLocalExportStateSchema.parse(
    await invoke("claim-native-local-export", {
      designId,
      requestId: request.requestId,
      documentId,
    }),
  );
  if (
    claimed.status !== "running" ||
    claimed.designId !== designId ||
    claimed.tabId !== tabId ||
    claimed.ownerDocumentId !== documentId ||
    claimed.requestId !== request.requestId
  )
    throw new NativeLocalExportClientError(
      "client-unavailable",
      "The local export claim did not match this editor tab.",
    );
  const controller = new AbortController();
  let monitorFailed = false;
  let monitorFailure: unknown;
  const stopObserving = observeCancellation(
    claimed,
    () => controller.abort(),
    (error) => {
      monitorFailed = true;
      monitorFailure = error;
      controller.abort();
    },
  );
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const remainingMs = Math.max(0, claimed.expiresAt - Date.now());
  let leaseExpired = remainingMs === 0;
  if (leaseExpired) controller.abort();
  const leaseTimer = setTimeout(() => {
    leaseExpired = true;
    controller.abort();
  }, remainingMs);
  try {
    if (signal.aborted || controller.signal.aborted)
      throw new NativeLocalExportClientError(
        "canceled",
        "Export was canceled.",
      );
    await onExport(claimed, controller.signal);
  } catch (error) {
    const failure = monitorFailed ? monitorFailure : error;
    const code =
      failure instanceof NativeLocalExportClientError
        ? failure.code
        : monitorFailed
          ? "client-unavailable"
          : leaseExpired
            ? "client-unavailable"
            : controller.signal.aborted
              ? "canceled"
              : "render-failed";
    const message =
      failure instanceof Error
        ? failure.message.slice(0, 300)
        : "Local export failed.";
    try {
      await invoke("finish-native-local-export", {
        designId,
        requestId: claimed.requestId,
        documentId,
        result: { status: "failed", code, message },
      });
    } catch (finishError) {
      throw new NativeLocalExportReportError(failure, finishError);
    }
    throw failure;
  } finally {
    clearTimeout(leaseTimer);
    signal.removeEventListener("abort", onAbort);
    stopObserving();
  }
  await invoke("finish-native-local-export", {
    designId,
    requestId: claimed.requestId,
    documentId,
    result: { status: "download-initiated" },
  });
}

export function observeNativeLocalExportCancellation(args: {
  request: NativeLocalExportState;
  readState: () => Promise<unknown>;
  onCancel: () => void;
  onFailure: (error: unknown) => void;
  intervalMs?: number;
}): () => void {
  let stopped = false;
  let reading = false;
  const check = async () => {
    if (stopped || reading) return;
    reading = true;
    try {
      const raw = await args.readState();
      if (stopped) return;
      if (raw === null)
        throw new NativeLocalExportClientError(
          "client-unavailable",
          "The local export request disappeared during capture.",
        );
      const current = nativeLocalExportStateSchema.parse(raw);
      if (current.requestId !== args.request.requestId)
        throw new NativeLocalExportClientError(
          "client-unavailable",
          "The local export request changed during capture.",
        );
      if (
        current.status === "cancel-requested" ||
        current.status === "canceled"
      ) {
        stopped = true;
        clearInterval(timer);
        args.onCancel();
      } else if (current.status === "expired") {
        throw new NativeLocalExportClientError(
          current.failure?.code === "editor-left"
            ? "editor-left"
            : "client-unavailable",
          current.failure?.message ?? "The local export lease expired.",
        );
      }
    } catch (error) {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        args.onFailure(error);
      }
    } finally {
      reading = false;
    }
  };
  const timer = setInterval(() => void check(), args.intervalMs ?? 500);
  void check();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export class NativeLocalExportReportError extends Error {
  constructor(
    readonly exportError: unknown,
    readonly reportError: unknown,
  ) {
    super("Local export failed, and its failure could not be reported.");
    this.name = "NativeLocalExportReportError";
  }
}

export function useNativeLocalExportRequests(args: {
  designId: string | undefined;
  enabled: boolean;
  onExport: NativeLocalExportHandler;
  onError: (error: unknown) => void;
}): void {
  const handlers = useRef({ onExport: args.onExport, onError: args.onError });
  handlers.current = { onExport: args.onExport, onError: args.onError };
  useEffect(() => {
    const designId = args.designId;
    if (!args.enabled || !designId) return;
    const tabId = getBrowserTabId();
    const documentId = nativeLocalExportDocumentId(document);
    const controller = new AbortController();
    let busy = false;
    let seenRequestId: string | null = null;
    let registering = false;
    let registrationFailures = 0;
    const register = async () => {
      if (registering || controller.signal.aborted) return;
      registering = true;
      try {
        await callAction("register-native-render-context", {
          designId,
          documentId,
        });
        registrationFailures = 0;
      } catch (error) {
        registrationFailures += 1;
        if (registrationFailures === 2 && !controller.signal.aborted)
          handlers.current.onError(error);
      } finally {
        registering = false;
      }
    };
    const poll = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const raw = await readClientAppState(
          nativeLocalExportStateKey(designId, tabId),
        );
        if (raw === null) return;
        const request = nativeLocalExportStateSchema.parse(raw);
        if (request.status !== "pending" || request.requestId === seenRequestId)
          return;
        seenRequestId = request.requestId;
        await executeNativeLocalExportRequest({
          request,
          designId,
          tabId,
          documentId,
          signal: controller.signal,
          onExport: (value, signal) => handlers.current.onExport(value, signal),
          invoke: (name, input) => callAction(name, input),
          observeCancellation: (claimed, onCancel, onFailure) =>
            observeNativeLocalExportCancellation({
              request: claimed,
              readState: () =>
                readClientAppState(nativeLocalExportStateKey(designId, tabId)),
              onCancel,
              onFailure,
            }),
        });
      } catch (error) {
        handlers.current.onError(error);
      } finally {
        busy = false;
      }
    };
    void poll();
    void register();
    const timer = window.setInterval(() => void poll(), 2000);
    const registrationTimer = window.setInterval(() => void register(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(registrationTimer);
    };
  }, [args.designId, args.enabled]);
}
