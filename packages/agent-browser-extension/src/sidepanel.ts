import type { BrowserContextV1 } from "@agent-native/core/browser-context";

import {
  BROWSER_CHAT_READY_MESSAGE_TYPE,
  BROWSER_CHAT_RESULT_MESSAGE_TYPE,
  createStageMessage,
  parseBrowserChatEvent,
  type BrowserChatBinding,
  type BrowserChatContextMessage,
} from "./browser-chat-protocol";
import {
  hasCaptureGrant,
  requestPersistentCaptureAccess,
} from "./capture-grants";
import { captureTabContext } from "./capture-tab";
import {
  BROWSER_CONTROL_STATUS_KEY,
  parseBrowserControlStatus,
} from "./control-status";
import { createPageSession, type BrowserPageSessionV1 } from "./page-session";
import {
  beginBrowserChatPairing,
  BROWSER_CHAT_SESSION_KEY,
  PENDING_PAIRING_KEY,
  readBrowserChatSession,
  type BrowserChatSession,
} from "./pairing";
import {
  hasRemoteHostAccess,
  readRemoteDeviceConfig,
  REMOTE_DEVICE_CONFIG_KEY,
  requestRemoteHostAccess,
} from "./remote-device";
import {
  normalizeDispatchBaseUrl,
  readSettings,
  saveSettings,
  type ExtensionSettings,
} from "./settings";

interface ActivePage {
  tabId: number;
  url: string;
  title: string;
  origin: string;
  capturable: boolean;
}

const pageTitle = requiredElement<HTMLElement>("page-title");
const pageOrigin = requiredElement<HTMLElement>("page-origin");
const pageAccessState = requiredElement<HTMLElement>("page-access-state");
const captureButton = requiredElement<HTMLButtonElement>("capture-button");
const captureStatus = requiredElement<HTMLElement>("capture-status");
const connectionForm = requiredElement<HTMLFormElement>("connection-form");
const dispatchUrlInput = requiredElement<HTMLInputElement>("dispatch-url");
const connectPanel = requiredElement<HTMLElement>("connect-panel");
const connectCopy = requiredElement<HTMLElement>("connect-copy");
const connectButton = requiredElement<HTMLButtonElement>("connect-button");
const dispatchFrame = requiredElement<HTMLIFrameElement>("dispatch-frame");
const controlState = requiredElement<HTMLElement>("control-state");
const relayAccessButton = requiredElement<HTMLButtonElement>(
  "relay-access-button",
);

let settings: ExtensionSettings;
let activePage: ActivePage | null = null;
let capturedContext: BrowserContextV1 | null = null;
let capturedSession: BrowserPageSessionV1 | null = null;
let browserChatBinding: BrowserChatBinding | null = null;
let dispatchReady = false;
let pendingContextMessage: BrowserChatContextMessage | null = null;
let captureInFlight = false;

function message(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

function localizeDocument(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = message(key);
  });
}

async function queryActivePage(): Promise<ActivePage | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (typeof tab?.id !== "number") return null;
  const url = tab.url ?? "";
  try {
    const parsed = new URL(url);
    const capturable =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    return {
      tabId: tab.id,
      url,
      title: tab.title?.trim() || parsed.hostname || message("currentPage"),
      origin: capturable ? parsed.origin : parsed.protocol,
      capturable,
    };
  } catch {
    return {
      tabId: tab.id,
      url,
      title: tab.title?.trim() || message("noPage"),
      origin: "",
      capturable: false,
    };
  }
}

async function refreshActivePage(): Promise<void> {
  const previous = activePage;
  activePage = await queryActivePage();
  pageTitle.textContent = activePage?.title ?? message("noPage");
  pageOrigin.textContent = activePage?.origin ?? "";
  captureButton.disabled = !activePage?.capturable || captureInFlight;
  const hasAccess = activePage?.capturable
    ? await hasCaptureGrant(activePage.tabId, activePage.url)
    : false;
  const sameCapturedPage = Boolean(
    capturedContext &&
    activePage &&
    pageIdentity(capturedContext.page.url) === pageIdentity(activePage.url),
  );
  pageAccessState.textContent = !activePage?.capturable
    ? message("pageRestricted")
    : sameCapturedPage
      ? message("pageShared")
      : hasAccess
        ? message("pageAccessReady")
        : message("pageAccessNeeded");
  if (
    capturedContext &&
    previous &&
    activePage &&
    previous.url !== activePage.url &&
    !sameCapturedPage &&
    !captureInFlight
  ) {
    setStatus(message("pageChanged"));
  }
}

async function captureCurrentPage(): Promise<void> {
  if (!activePage?.capturable || captureInFlight) return;
  if (!(await hasCaptureGrant(activePage.tabId, activePage.url))) {
    const granted = await requestPersistentCaptureAccess(activePage.url);
    if (!granted) {
      setStatus(message("captureGrantNeeded"), "error");
      await refreshActivePage();
      return;
    }
  }
  captureInFlight = true;
  captureButton.disabled = true;
  captureButton.textContent = message("capturingPage");
  setStatus("");

  try {
    const context = await captureTabContext(activePage.tabId);
    if (context.outcome.state === "failure") {
      throw new Error(context.outcome.failure.message);
    }
    const pageSession = await createPageSession(
      activePage.tabId,
      activePage.url,
      activePage.title,
    );
    capturedContext = context;
    capturedSession = pageSession;
    pendingContextMessage = browserChatBinding
      ? createStageMessage(browserChatBinding.nonce, context, pageSession)
      : null;
    postPendingContext();
    const truncated = context.outcome.state === "truncated";
    setStatus(
      message(truncated ? "captureTruncated" : "captureReady"),
      "success",
    );
  } catch {
    setStatus(message("captureFailed"), "error");
  } finally {
    captureInFlight = false;
    captureButton.textContent = message("sharePage");
    await refreshActivePage();
  }
}

function postPendingContext(): void {
  if (
    !dispatchReady ||
    !pendingContextMessage ||
    !browserChatBinding ||
    !dispatchFrame.contentWindow
  ) {
    if (pendingContextMessage && !dispatchReady) {
      setStatus(message("dispatchWaiting"));
    }
    return;
  }
  dispatchFrame.contentWindow.postMessage(
    pendingContextMessage,
    browserChatBinding.dispatchOrigin,
  );
  pendingContextMessage = null;
}

async function connectDispatch(): Promise<void> {
  connectButton.disabled = true;
  try {
    await requestRemoteHostAccess(settings.dispatchBaseUrl).catch(() => false);
    const pairing = await beginBrowserChatPairing(settings.dispatchBaseUrl);
    await chrome.tabs.create({ url: pairing.connectUrl });
    connectCopy.textContent = message("pairingOpened");
  } catch {
    connectCopy.textContent = message("pairingFailed");
  } finally {
    connectButton.disabled = false;
  }
}

async function loadBrowserChatSession(
  session: BrowserChatSession,
): Promise<void> {
  dispatchReady = false;
  browserChatBinding = null;
  dispatchFrame.hidden = true;
  connectPanel.hidden = false;
  connectCopy.textContent = message("dispatchLoading");
  dispatchFrame.src = session.startUrl;
  const frameWindow = dispatchFrame.contentWindow;
  if (!frameWindow) {
    connectCopy.textContent = message("pairingFailed");
    return;
  }
  browserChatBinding = {
    nonce: session.nonce,
    dispatchOrigin: session.dispatchOrigin,
    frameWindow,
  };
  await refreshRelayAccess();
}

function handleBrowserChatEvent(event: MessageEvent): void {
  if (!browserChatBinding) return;
  const inbound = parseBrowserChatEvent(event, browserChatBinding);
  if (!inbound) return;
  if (inbound.type === BROWSER_CHAT_READY_MESSAGE_TYPE) {
    dispatchReady = true;
    connectPanel.hidden = true;
    dispatchFrame.hidden = false;
    void chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);
    setStatus(message("dispatchReady"), "success");
    if (capturedContext && capturedSession) {
      pendingContextMessage = createStageMessage(
        browserChatBinding.nonce,
        capturedContext,
        capturedSession,
      );
    }
    postPendingContext();
    return;
  }
  if (inbound.type === BROWSER_CHAT_RESULT_MESSAGE_TYPE && !inbound.ok) {
    setStatus(message("captureFailed"), "error");
  }
}

async function handleConnectionSave(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const dispatchBaseUrl = normalizeDispatchBaseUrl(dispatchUrlInput.value);
  if (!dispatchBaseUrl) {
    setStatus(message("invalidDispatchUrl"), "error");
    return;
  }
  settings = { dispatchBaseUrl };
  await saveSettings(settings);
  await Promise.all([
    chrome.storage.session.remove([
      BROWSER_CHAT_SESSION_KEY,
      PENDING_PAIRING_KEY,
    ]),
    chrome.storage.local.remove(REMOTE_DEVICE_CONFIG_KEY),
  ]);
  dispatchReady = false;
  browserChatBinding = null;
  dispatchFrame.removeAttribute("src");
  dispatchFrame.hidden = true;
  connectPanel.hidden = false;
  connectCopy.textContent = message("connectionSaved");
  setStatus(message("connectionSaved"), "success");
  await refreshRelayAccess();
}

async function grantRelayAccess(): Promise<void> {
  const config = await readRemoteDeviceConfig();
  if (!config) return;
  const granted = await requestRemoteHostAccess(config.relayBaseUrl);
  setStatus(
    message(granted ? "relayAccessReady" : "relayAccessNeeded"),
    granted ? "success" : "error",
  );
  await refreshRelayAccess();
}

async function refreshRelayAccess(): Promise<void> {
  const config = await readRemoteDeviceConfig();
  relayAccessButton.hidden =
    !config || (await hasRemoteHostAccess(config.relayBaseUrl));
}

function setStatus(
  value: string,
  tone: "success" | "error" | undefined = undefined,
): void {
  captureStatus.textContent = value;
  if (tone) captureStatus.dataset.tone = tone;
  else delete captureStatus.dataset.tone;
}

function renderControlStatus(value: unknown): void {
  const status = parseBrowserControlStatus(value);
  controlState.textContent =
    status?.state === "available"
      ? message(
          status.activeTasks > 0
            ? "controlActive"
            : status.controlTransport === "relay"
              ? "controlAvailableRelay"
              : "controlAvailable",
        )
      : message("controlUnavailable");
}

async function refreshControlStatus(): Promise<void> {
  const stored = await chrome.storage.session.get(BROWSER_CONTROL_STATUS_KEY);
  renderControlStatus(stored[BROWSER_CONTROL_STATUS_KEY]);
}

function pageIdentity(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

async function initialize(): Promise<void> {
  localizeDocument();
  settings = await readSettings();
  dispatchUrlInput.value = settings.dispatchBaseUrl;
  await refreshActivePage();
  const session = await readBrowserChatSession();
  if (session) {
    await loadBrowserChatSession(session);
  } else {
    connectCopy.textContent = message("dispatchLoading");
  }
  await Promise.all([refreshControlStatus(), refreshRelayAccess()]);
  window.setInterval(() => void refreshControlStatus(), 10_000);

  captureButton.addEventListener("click", () => void captureCurrentPage());
  connectButton.addEventListener("click", () => void connectDispatch());
  relayAccessButton.addEventListener("click", () => void grantRelayAccess());
  connectionForm.addEventListener(
    "submit",
    (event) => void handleConnectionSave(event),
  );
  window.addEventListener("message", handleBrowserChatEvent);
  chrome.tabs.onActivated.addListener(() => void refreshActivePage());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (
      tabId === activePage?.tabId &&
      (changeInfo.url || changeInfo.status === "complete")
    ) {
      void refreshActivePage();
    }
  });
  chrome.windows.onFocusChanged.addListener(() => void refreshActivePage());
  chrome.permissions.onAdded.addListener(() => {
    void refreshActivePage();
    void refreshRelayAccess();
  });
  chrome.permissions.onRemoved.addListener(() => {
    void refreshActivePage();
    void refreshRelayAccess();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && changes[BROWSER_CHAT_SESSION_KEY]?.newValue) {
      void readBrowserChatSession().then((nextSession) => {
        if (nextSession) void loadBrowserChatSession(nextSession);
      });
    }
    if (
      areaName === "session" &&
      changes[BROWSER_CONTROL_STATUS_KEY]?.newValue
    ) {
      renderControlStatus(changes[BROWSER_CONTROL_STATUS_KEY].newValue);
    }
    if (
      areaName === "local" &&
      Object.prototype.hasOwnProperty.call(changes, REMOTE_DEVICE_CONFIG_KEY)
    ) {
      void refreshRelayAccess();
    }
  });
}

void initialize();
