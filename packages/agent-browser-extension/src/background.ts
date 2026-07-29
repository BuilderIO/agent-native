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
  invalidatePageSessionsForTab,
  PAGE_SESSIONS_KEY,
  readCurrentPageSession,
} from "./page-session";
import {
  acceptBrowserChatSession,
  BROWSER_CHAT_SESSION_KEY,
  PENDING_PAIRING_KEY,
  type PendingBrowserChatPairing,
} from "./pairing";
import {
  hasRemoteHostAccess,
  mergeRemoteDeviceConfig,
  readRemoteDeviceConfig,
  REMOTE_DEVICE_CONFIG_KEY,
  saveRemoteDeviceConfig,
  type RemoteDeviceConfig,
} from "./remote-device";
import {
  readRelayPollCommand,
  relayCapabilities,
  relayErrorResult,
  RemoteRelayExecutor,
} from "./remote-relay";

const NATIVE_HOST = "com.agent_native.dispatch";
const NATIVE_RECONNECT_ALARM = "agent-native-browser-native-host-reconnect";
const RELAY_WAKE_ALARM = "agent-native-browser-relay-wake";
const HEARTBEAT_INTERVAL_MS = 20_000;
const RELAY_WAIT_MS = 20_000;
const RELAY_STATUS_MAX_AGE_MS = 90_000;
const control = new BrowserControlService();
const relayExecutor = new RemoteRelayExecutor(control);
let nativePort: chrome.runtime.Port | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let nativeHostConnecting = false;
let nativeDisconnectingForRelay = false;
let relayLastSeenAt = 0;
let relayHasAccess = false;
let relayOwnsControl = false;
let relayGeneration = 0;
let relayAbort: AbortController | undefined;
let relayQueue: Promise<void> = Promise.resolve();

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

function writeControlStatus(): void {
  const nativeHostConnected = Boolean(nativePort) && !relayOwnsControl;
  const relayConnected =
    relayHasAccess && Date.now() - relayLastSeenAt <= RELAY_STATUS_MAX_AGE_MS;
  const nativeAvailable = nativeHostConnected;
  const relayAvailable = relayConnected && relayOwnsControl;
  void chrome.storage.session.set({
    [BROWSER_CONTROL_STATUS_KEY]:
      nativeAvailable || relayAvailable
        ? {
            state: "available",
            nativeHostConnected,
            relayConnected,
            controlTransport: relayAvailable ? "relay" : "native",
            activeTasks: control.activeTaskCount,
            updatedAt: new Date().toISOString(),
          }
        : {
            state: "unavailable",
            nativeHostConnected: false,
            relayConnected: false,
            controlTransport: null,
            activeTasks: 0,
            reason: relayHasAccess
              ? "relay-not-connected"
              : "connection-not-configured",
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
    writeControlStatus();
  }, HEARTBEAT_INTERVAL_MS);
}

async function handleNativeMessage(message: unknown): Promise<void> {
  let id = "unknown";
  try {
    const request = parseNativeRequest(message);
    id = request.id;
    if (relayOwnsControl) {
      throw new BrowserControlError(
        "UPSTREAM_NOT_ACTIVE",
        "The paired browser relay owns browser control.",
      );
    }
    const result = await control.execute(request);
    postNative({ id, ok: true, result });
  } catch (error) {
    postNative(errorResponse(id, error));
  } finally {
    writeControlStatus();
    if (!relayOwnsControl && relayHasAccess && control.activeTaskCount === 0) {
      restartRelayPoller();
    }
  }
}

function scheduleNativeReconnect(): void {
  void chrome.alarms.create(NATIVE_RECONNECT_ALARM, { delayInMinutes: 1 });
}

function connectNativeHost(): void {
  if (relayOwnsControl || nativePort || nativeHostConnecting) return;
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
      writeControlStatus();
      if (nativeDisconnectingForRelay) {
        nativeDisconnectingForRelay = false;
        return;
      }
      void control.emergencyStopAll().finally(scheduleNativeReconnect);
    });
    startHeartbeat();
    writeControlStatus();
  } catch {
    nativePort = undefined;
    nativeHostConnecting = false;
    writeControlStatus();
    scheduleNativeReconnect();
  } finally {
    if (nativePort) nativeHostConnecting = false;
  }
}

async function selectRelayControl(): Promise<boolean> {
  if (relayOwnsControl) return true;
  if (nativePort && control.activeTaskCount > 0) return false;
  relayOwnsControl = true;
  if (nativePort) {
    nativeDisconnectingForRelay = true;
    nativePort.disconnect();
  }
  writeControlStatus();
  return true;
}

async function selectNativeFallback(): Promise<void> {
  const wasRelayOwner = relayOwnsControl;
  relayOwnsControl = false;
  relayLastSeenAt = 0;
  if (wasRelayOwner && control.activeTaskCount > 0) {
    await control.emergencyStopAll();
  }
  writeControlStatus();
  connectNativeHost();
}

function restartRelayPoller(): void {
  const generation = ++relayGeneration;
  relayAbort?.abort();
  relayQueue = relayQueue.finally(() => runRelayLoop(generation));
}

async function runRelayLoop(generation: number): Promise<void> {
  const config = await readRemoteDeviceConfig();
  if (!config || generation !== relayGeneration) {
    relayHasAccess = false;
    await selectNativeFallback();
    return;
  }
  relayHasAccess = await hasRemoteHostAccess(config.relayBaseUrl);
  if (!relayHasAccess || generation !== relayGeneration) {
    await selectNativeFallback();
    return;
  }
  await selectRelayControl();
  writeControlStatus();

  const controller = new AbortController();
  relayAbort = controller;
  let backoffMs = 1_000;
  while (generation === relayGeneration && !controller.signal.aborted) {
    try {
      const browserSession = await readCurrentPageSession();
      const response = await postRelayJson(
        config,
        "/_agent-native/integrations/remote/poll",
        {
          deviceId: config.deviceId,
          waitMs: RELAY_WAIT_MS,
          computerCapabilities: relayCapabilities(relayOwnsControl),
          browserSession,
        },
        controller.signal,
      );
      relayLastSeenAt = Date.now();
      writeControlStatus();
      backoffMs = 1_000;
      const command = readRelayPollCommand(response);
      if (command) await handleRelayCommand(config, command, controller.signal);
    } catch {
      if (controller.signal.aborted) break;
      relayLastSeenAt = 0;
      writeControlStatus();
      await abortableDelay(backoffMs, controller.signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  }
  if (relayAbort === controller) relayAbort = undefined;
}

async function handleRelayCommand(
  config: RemoteDeviceConfig,
  command: unknown,
  signal: AbortSignal,
): Promise<void> {
  const commandId =
    isRecord(command) && typeof command.id === "string" ? command.id : null;
  if (!commandId) return;
  try {
    const executed = await relayExecutor.execute(command, relayOwnsControl);
    await postRelayJson(
      config,
      "/_agent-native/integrations/remote/result",
      {
        deviceId: config.deviceId,
        commandId: executed.commandId,
        kind: "computer-operation",
        status: "completed",
        result: executed.result,
      },
      signal,
    );
  } catch (error) {
    const result = relayErrorResult(error);
    await postRelayJson(
      config,
      "/_agent-native/integrations/remote/result",
      {
        deviceId: config.deviceId,
        commandId,
        kind: "computer-operation",
        status: "failed",
        result,
        errorMessage: result.error,
      },
      signal,
    );
  }
}

async function postRelayJson(
  config: RemoteDeviceConfig,
  pathname: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${config.relayBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}.`);
  }
  const text = await response.text();
  if (text.length > 512_000) {
    throw new Error("Remote relay response exceeded the safety limit.");
  }
  return text ? (JSON.parse(text) as unknown) : null;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void enableSidePanel();
  void chrome.alarms.create(RELAY_WAKE_ALARM, { periodInMinutes: 1 });
  restartRelayPoller();
});
chrome.runtime.onStartup.addListener(() => {
  void enableSidePanel();
  restartRelayPoller();
});
chrome.runtime.onSuspend.addListener(() => {
  relayAbort?.abort();
  writeControlStatus();
  void control.emergencyStopAll();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NATIVE_RECONNECT_ALARM) connectNativeHost();
  if (alarm.name === RELAY_WAKE_ALARM) restartRelayPoller();
});
chrome.permissions.onAdded.addListener(() => restartRelayPoller());
chrome.permissions.onRemoved.addListener(() => restartRelayPoller());
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
    void invalidatePageSessionsForTab(tabId, changeInfo.url).then(
      restartRelayPoller,
    );
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
  void invalidatePageSessionsForTab(tabId).then(restartRelayPoller);
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "session" &&
    Object.prototype.hasOwnProperty.call(changes, PAGE_SESSIONS_KEY)
  ) {
    restartRelayPoller();
  }
  if (
    areaName === "local" &&
    Object.prototype.hasOwnProperty.call(changes, REMOTE_DEVICE_CONFIG_KEY)
  ) {
    restartRelayPoller();
  }
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    void (async () => {
      const stored = await chrome.storage.session.get(PENDING_PAIRING_KEY);
      const pending =
        (stored[PENDING_PAIRING_KEY] as
          | PendingBrowserChatPairing
          | undefined) ?? null;
      const accepted = acceptBrowserChatSession(message, sender, pending);
      if (!accepted) {
        sendResponse({ ok: false, error: "Pairing message rejected." });
        return;
      }
      const previous = await readRemoteDeviceConfig();
      const remoteConfig = mergeRemoteDeviceConfig(
        accepted.remote,
        accepted.session.dispatchOrigin,
        previous,
      );
      await chrome.storage.session.set({
        [BROWSER_CHAT_SESSION_KEY]: accepted.session,
      });
      if (remoteConfig) await saveRemoteDeviceConfig(remoteConfig);
      await chrome.storage.session.remove(PENDING_PAIRING_KEY);
      sendResponse({ ok: true, relayConfigured: Boolean(remoteConfig) });
    })().catch(() => {
      sendResponse({ ok: false, error: "Pairing failed." });
    });
    return true;
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

void enableSidePanel();
writeControlStatus();
void chrome.alarms.create(RELAY_WAKE_ALARM, { periodInMinutes: 1 });
void control.restore().finally(() => {
  restartRelayPoller();
});
