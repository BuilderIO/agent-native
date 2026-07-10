import { BrowserControlError, BrowserControlService } from "./browser-control";
import { parseNativeRequest, ProtocolValidationError } from "./policy";
import type { NativeHeartbeat, NativeResponse } from "./protocol";

const NATIVE_HOST = "com.agent_native.dispatch";
const RECONNECT_ALARM = "agent-native-browser-native-host-reconnect";
const HEARTBEAT_INTERVAL_MS = 20_000;

const control = new BrowserControlService();
let nativePort: chrome.runtime.Port | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let connecting = false;

function errorResponse(id: string, error: unknown): NativeResponse {
  if (
    error instanceof BrowserControlError ||
    error instanceof ProtocolValidationError
  ) {
    return {
      id,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  return {
    id,
    ok: false,
    error: {
      code: "BROWSER_CONTROL_FAILED",
      message:
        error instanceof Error ? error.message : "Browser control failed.",
    },
  };
}

function post(message: NativeResponse | NativeHeartbeat): void {
  try {
    nativePort?.postMessage(message);
  } catch {
    // onDisconnect performs the safety cleanup and schedules recovery.
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    post({
      type: "heartbeat",
      activeTasks: control.activeTaskCount,
      timestamp: new Date().toISOString(),
    });
  }, HEARTBEAT_INTERVAL_MS);
}

async function handleNativeMessage(message: unknown): Promise<void> {
  let id = "unknown";
  try {
    const request = parseNativeRequest(message);
    id = request.id;
    const result = await control.execute(request);
    post({ id, ok: true, result });
  } catch (error) {
    post(errorResponse(id, error));
  }
}

function scheduleReconnect(): void {
  void chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 1 });
}

function connectNativeHost(): void {
  if (nativePort || connecting) return;
  connecting = true;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener(
      (message: unknown) => void handleNativeMessage(message),
    );
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      nativePort = undefined;
      connecting = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      void control.emergencyStopAll().finally(scheduleReconnect);
    });
    startHeartbeat();
  } catch {
    nativePort = undefined;
    connecting = false;
    scheduleReconnect();
  } finally {
    if (nativePort) connecting = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectNativeHost();
});

chrome.runtime.onInstalled.addListener(connectNativeHost);
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onSuspend.addListener(() => {
  void control.emergencyStopAll();
});

chrome.debugger.onDetach.addListener((debuggee) => {
  if (debuggee.tabId !== undefined)
    void control.handleDebuggerDetach(debuggee.tabId);
});

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (debuggee.tabId === undefined || method !== "Page.frameNavigated") return;
  const frame = (
    params as { frame?: { parentId?: string; url?: string } } | undefined
  )?.frame;
  if (frame && !frame.parentId)
    void control.enforceTabOrigin(debuggee.tabId, frame.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void control.enforceTabOrigin(tabId, changeInfo.url);
});

void control.restore().finally(connectNativeHost);
