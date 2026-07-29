import {
  parseBrowserContextV1,
  type BrowserContextV1,
} from "@agent-native/core/browser-context";

import {
  BROWSER_CHAT_READY_MESSAGE_TYPE,
  BROWSER_CHAT_RESULT_MESSAGE_TYPE,
  createStageMessage,
  createSubmitMessage,
  isLinkedInProfileUrl,
  parseBrowserChatEvent,
  type BrowserChatBinding,
  type BrowserChatContextMessage,
} from "./browser-chat-protocol";
import { hasCaptureGrant } from "./capture-grants";
import {
  CAPTURE_RESULT_MESSAGE_TYPE,
  isCaptureResultMessage,
} from "./capture-messages";
import {
  BROWSER_CONTROL_STATUS_KEY,
  parseBrowserControlStatus,
} from "./control-status";
import {
  beginBrowserChatPairing,
  BROWSER_CHAT_SESSION_KEY,
  PENDING_PAIRING_KEY,
  readBrowserChatSession,
  type BrowserChatSession,
} from "./pairing";
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
const captureButton = requiredElement<HTMLButtonElement>("capture-button");
const captureStatus = requiredElement<HTMLElement>("capture-status");
const linkedinAction = requiredElement<HTMLElement>("linkedin-action");
const draftOutreachButton = requiredElement<HTMLButtonElement>(
  "draft-outreach-button",
);
const connectionForm = requiredElement<HTMLFormElement>("connection-form");
const dispatchUrlInput = requiredElement<HTMLInputElement>("dispatch-url");
const connectPanel = requiredElement<HTMLElement>("connect-panel");
const connectCopy = requiredElement<HTMLElement>("connect-copy");
const connectButton = requiredElement<HTMLButtonElement>("connect-button");
const dispatchFrame = requiredElement<HTMLIFrameElement>("dispatch-frame");
const controlState = requiredElement<HTMLElement>("control-state");

let settings: ExtensionSettings;
let activePage: ActivePage | null = null;
let capturedContext: BrowserContextV1 | null = null;
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
  const capturedPageUrl = capturedContext?.page.url;
  const sameCapturedPage = Boolean(
    capturedPageUrl &&
    activePage &&
    pageIdentity(capturedPageUrl) === pageIdentity(activePage.url),
  );
  linkedinAction.hidden = !(
    sameCapturedPage &&
    capturedPageUrl &&
    isLinkedInProfileUrl(capturedPageUrl)
  );
  draftOutreachButton.disabled = !dispatchReady;
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
    setStatus(message("captureGrantNeeded"), "error");
    return;
  }
  captureInFlight = true;
  captureButton.disabled = true;
  captureButton.textContent = message("capturingPage");
  setStatus("");

  try {
    const contextPromise = waitForCaptureResult(activePage.tabId);
    await chrome.scripting.executeScript({
      target: { tabId: activePage.tabId },
      files: ["assets/capture-page.js"],
    });
    const context = parseBrowserContextV1(await contextPromise);
    if (context.outcome.state === "failure") {
      throw new Error(context.outcome.failure.message);
    }
    capturedContext = context;
    pendingContextMessage = browserChatBinding
      ? createStageMessage(browserChatBinding.nonce, context)
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
    captureButton.textContent = message("capturePage");
    await refreshActivePage();
  }
}

function waitForCaptureResult(tabId: number): Promise<BrowserContextV1> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Page capture timed out."));
    }, 8_000);
    const listener = (value: unknown, sender: chrome.runtime.MessageSender) => {
      if (
        sender.id !== chrome.runtime.id ||
        sender.tab?.id !== tabId ||
        !isCaptureResultMessage(value)
      ) {
        return;
      }
      window.clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(value.context);
    };
    chrome.runtime.onMessage.addListener(listener);
  });
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

async function requestOutreachDraft(): Promise<void> {
  if (
    !capturedContext ||
    !browserChatBinding ||
    !dispatchReady ||
    !isLinkedInProfileUrl(capturedContext.page.url) ||
    !dispatchFrame.contentWindow
  ) {
    return;
  }
  const outbound = createSubmitMessage(
    browserChatBinding.nonce,
    message("draftOutreachPrompt"),
    capturedContext,
  );
  dispatchFrame.contentWindow.postMessage(
    outbound,
    browserChatBinding.dispatchOrigin,
  );
  setStatus(message("draftRequested"), "success");
}

async function connectDispatch(): Promise<void> {
  connectButton.disabled = true;
  try {
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
}

function handleBrowserChatEvent(event: MessageEvent): void {
  if (!browserChatBinding) return;
  const inbound = parseBrowserChatEvent(event, browserChatBinding);
  if (!inbound) return;
  if (inbound.type === BROWSER_CHAT_READY_MESSAGE_TYPE) {
    dispatchReady = true;
    connectPanel.hidden = true;
    dispatchFrame.hidden = false;
    draftOutreachButton.disabled = false;
    void chrome.storage.session.remove(BROWSER_CHAT_SESSION_KEY);
    setStatus(message("dispatchReady"), "success");
    if (capturedContext) {
      pendingContextMessage = createStageMessage(
        browserChatBinding.nonce,
        capturedContext,
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
  await chrome.storage.session.remove([
    BROWSER_CHAT_SESSION_KEY,
    PENDING_PAIRING_KEY,
  ]);
  dispatchReady = false;
  browserChatBinding = null;
  dispatchFrame.removeAttribute("src");
  dispatchFrame.hidden = true;
  connectPanel.hidden = false;
  connectCopy.textContent = message("connectionSaved");
  setStatus(message("connectionSaved"), "success");
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
      ? message(status.activeTasks > 0 ? "controlActive" : "controlAvailable")
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
  await refreshControlStatus();
  window.setInterval(() => void refreshControlStatus(), 10_000);

  captureButton.addEventListener("click", () => void captureCurrentPage());
  draftOutreachButton.addEventListener(
    "click",
    () => void requestOutreachDraft(),
  );
  connectButton.addEventListener("click", () => void connectDispatch());
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
  });
}

void initialize();
