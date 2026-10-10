import {
  callAction,
  getBrowserTabId,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import {
  nativeDraftForegroundKey,
  nativeDraftForegroundStateSchema,
  type NativeDraftForegroundState,
  type NativeDraftTerminal,
} from "@shared/native-shader-draft-foreground";
import { useEffect, useRef } from "react";

import {
  clearCanceledNativeShaderDraft,
  previewNativeShaderDraftInEditor,
} from "./native-shader-draft-foreground-client";

export type NativeDraftForegroundInvoke = (
  input: Record<string, unknown>,
) => Promise<unknown>;

export async function runNativeShaderDraftForeground(args: {
  state: NativeDraftForegroundState;
  designId: string;
  tabId: string;
  signal: AbortSignal;
  invoke: NativeDraftForegroundInvoke;
  readState: () => Promise<unknown>;
}): Promise<void> {
  const { state, designId, tabId, signal, invoke, readState } = args;
  if (
    state.designId !== designId ||
    state.tabId !== tabId ||
    state.status !== "pending"
  )
    throw new Error("native-draft-request-mismatch");
  const claimed = nativeDraftForegroundStateSchema.parse(
    await invoke({ kind: "claim", designId, requestId: state.requestId }),
  );
  if (claimed.status !== "running" || claimed.requestId !== state.requestId)
    throw new Error("native-draft-claim-conflict");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  let watcherBusy = false;
  const watcher = window.setInterval(() => {
    if (watcherBusy || controller.signal.aborted) return;
    watcherBusy = true;
    void readState()
      .then((raw) => {
        const latest = nativeDraftForegroundStateSchema.parse(raw);
        if (
          latest.requestId !== claimed.requestId ||
          latest.status !== "running"
        )
          controller.abort();
      })
      .catch(() => controller.abort())
      .finally(() => {
        watcherBusy = false;
      });
  }, 500);
  const lease = window.setTimeout(
    () => controller.abort(),
    Math.max(0, claimed.expiresAt - Date.now()),
  );
  let terminal: NativeDraftTerminal | null = null;
  let previewError: unknown;
  try {
    if (controller.signal.aborted || Date.now() >= claimed.expiresAt)
      throw new Error("native-draft-lease-expired");
    const opened = await invoke({
      kind: "open",
      designId,
      requestId: claimed.requestId,
    });
    if (
      !opened ||
      typeof opened !== "object" ||
      !("state" in opened) ||
      !("payload" in opened)
    )
      throw new Error("native-draft-open-unreadable");
    const openState = nativeDraftForegroundStateSchema.parse(opened.state);
    if (
      openState.requestId !== claimed.requestId ||
      openState.status !== "running"
    )
      throw new Error("native-draft-open-conflict");
    terminal = await previewNativeShaderDraftInEditor({
      state: claimed,
      payload: opened.payload,
      signal: controller.signal,
    });
    if (controller.signal.aborted || Date.now() >= claimed.expiresAt)
      throw new Error("native-draft-lease-expired");
  } catch (error) {
    previewError = error;
    if (!controller.signal.aborted) {
      const code =
        error instanceof Error
          ? error.name.slice(0, 80)
          : "native-draft-preview-failed";
      terminal = {
        status: "error",
        displayed: "none",
        diagnostics: [
          { code, message: "native-draft-preview-failed", severity: "error" },
        ],
      };
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    window.clearInterval(watcher);
    window.clearTimeout(lease);
  }
  if (controller.signal.aborted) {
    await invoke({ kind: "cancel", designId, requestId: claimed.requestId });
    await clearCanceledNativeShaderDraft(claimed);
    await invoke({
      kind: "cancel-complete",
      designId,
      requestId: claimed.requestId,
    });
    if (previewError) throw previewError;
    return;
  }
  if (!terminal) throw new Error("native-draft-terminal-missing");
  await invoke({
    kind: "finish",
    designId,
    requestId: claimed.requestId,
    result: terminal,
  });
  if (previewError) throw previewError;
}

export function useNativeShaderDraftForeground(args: {
  designId: string | undefined;
  enabled: boolean;
  onError: (error: unknown) => void;
}): void {
  const onError = useRef(args.onError);
  onError.current = args.onError;
  useEffect(() => {
    const designId = args.designId;
    if (!args.enabled || !designId) return;
    const tabId = getBrowserTabId();
    const controller = new AbortController();
    let busy = false;
    let seen: string | null = null;
    const poll = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const raw = await readClientAppState(
          nativeDraftForegroundKey(designId, tabId),
        );
        if (raw === null) return;
        const state = nativeDraftForegroundStateSchema.parse(raw);
        if (state.status !== "pending" || state.requestId === seen) return;
        seen = state.requestId;
        await runNativeShaderDraftForeground({
          state,
          designId,
          tabId,
          signal: controller.signal,
          invoke: (input) =>
            callAction("native-shader-draft-foreground", input as never),
          readState: () =>
            readClientAppState(nativeDraftForegroundKey(designId, tabId)),
        });
      } catch (error) {
        if (!controller.signal.aborted) onError.current(error);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [args.designId, args.enabled]);
}
