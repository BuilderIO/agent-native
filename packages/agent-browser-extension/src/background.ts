import {
  BrowserControlError,
  BrowserControlService,
  parseNativeRequest,
  ProtocolValidationError,
  type NativeHeartbeat,
  type NativeResponse,
} from "@agent-native/browser-control-extension-core";

import {
  captureGrantKey,
  captureOrigin,
  isCaptureGrantValid,
} from "./capture-grants";
import { BROWSER_CONTROL_STATUS_KEY } from "./control-status";
import {
  acceptBrowserChatSession,
  BROWSER_CHAT_SESSION_KEY,
  PENDING_PAIRING_KEY,
  type PendingBrowserChatPairing,
} from "./pairing";

const NATIVE_HOST = "com.agent_native.dispatch";
const RECONNECT_ALARM = "agent-native-browser-native-host-reconnect";
const HEARTBEAT_INTERVAL_MS = 20_000;
const control = new BrowserControlService();
let nativePort: chrome.runtime.Port | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let nativeHostConnecting = false;

async function enableSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

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

function postNative(message: NativeResponse | NativeHeartbeat): void {
  try {
    nativePort?.postMessage(message);
  } catch {
    // onDisconnect owns cleanup and reconnect.
  }
}

function writeControlStatus(connected: boolean): void {
  void chrome.storage.session.set({
    [BROWSER_CONTROL_STATUS_KEY]: connected
      ? {
          state: "available",
          nativeHostConnected: true,
          activeTasks: control.activeTaskCount,
          updatedAt: new Date().toISOString(),
        }
      : {
          state: "unavailable",
          nativeHostConnected: false,
          activeTasks: 0,
          reason: "native-host-not-connected",
          updatedAt: new Date().toISOString(),
        },
  });
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    postNative({
      type: "heartbeat",
      activeTasks: control.activeTaskCount,
      timestamp: new Date().toISOString(),
    });
    writeControlStatus(true);
  }, HEARTBEAT_INTERVAL_MS);
}

async function handleNativeMessage(message: unknown): Promise<void> {
  let id = "unknown";
  try {
    const request = parseNativeRequest(message);
    id = request.id;
    const result = await control.execute(request);
    postNative({ id, ok: true, result });
  } catch (error) {
    postNative(errorResponse(id, error));
  } finally {
    writeControlStatus(Boolean(nativePort));
  }
}

function scheduleNativeReconnect(): void {
  void chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 1 });
}

function connectNativeHost(): void {
  if (nativePort || nativeHostConnecting) return;
  nativeHostConnecting = true;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener(
      (message: unknown) => void handleNativeMessage(message),
    );
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      void chrome.runtime.lastError;
      nativePort = undefined;
      nativeHostConnecting = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      writeControlStatus(false);
      void control.emergencyStopAll().finally(scheduleNativeReconnect);
    });
    startHeartbeat();
    writeControlStatus(true);
  } catch {
    nativePort = undefined;
    nativeHostConnecting = false;
    writeControlStatus(false);
    scheduleNativeReconnect();
  } finally {
    if (nativePort) nativeHostConnecting = false;
  }
}

chrome.runtime.onInstalled.addListener(() => void enableSidePanel());
chrome.runtime.onStartup.addListener(() => void enableSidePanel());
chrome.runtime.onInstalled.addListener(connectNativeHost);
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onSuspend.addListener(() => {
  writeControlStatus(false);
  void control.emergencyStopAll();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectNativeHost();
});
chrome.debugger.onDetach.addListener((debuggee) => {
  if (debuggee.tabId !== undefined) {
    void control.handleDebuggerDetach(debuggee.tabId);
  }
});
chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (debuggee.tabId === undefined || method !== "Page.frameNavigated") return;
  const frame = (
    params as { frame?: { parentId?: string; url?: string } } | undefined
  )?.frame;
  if (frame && !frame.parentId) {
    void control.enforceTabOrigin(debuggee.tabId, frame.url);
  }
});
chrome.action.onClicked.addListener((tab) => {
  const origin = captureOrigin(tab.url);
  if (typeof tab.id !== "number" || !origin) return;
  void chrome.storage.session.set({
    [captureGrantKey(tab.id)]: {
      tabId: tab.id,
      origin,
      grantedAt: Date.now(),
    },
  });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    void control.enforceTabOrigin(tabId, changeInfo.url);
  }
  if (!changeInfo.url) return;
  const key = captureGrantKey(tabId);
  void chrome.storage.session.get(key).then((stored) => {
    if (!isCaptureGrantValid(stored[key], tabId, changeInfo.url!)) {
      void chrome.storage.session.remove(key);
    }
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(captureGrantKey(tabId));
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    void (async () => {
      const stored = await chrome.storage.session.get(PENDING_PAIRING_KEY);
      const pending =
        (stored[PENDING_PAIRING_KEY] as
          | PendingBrowserChatPairing
          | undefined) ?? null;
      const session = acceptBrowserChatSession(message, sender, pending);
      if (!session) {
        sendResponse({ ok: false, error: "Pairing message rejected." });
        return;
      }
      await chrome.storage.session.set({ [BROWSER_CHAT_SESSION_KEY]: session });
      await chrome.storage.session.remove(PENDING_PAIRING_KEY);
      sendResponse({ ok: true });
    })().catch(() => {
      sendResponse({ ok: false, error: "Pairing failed." });
    });
    return true;
  },
);

void enableSidePanel();
writeControlStatus(false);
void control.restore().finally(connectNativeHost);
