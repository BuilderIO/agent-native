type CaptureSurface = "browser" | "window" | "monitor" | "camera";
type RecordingModeChoice = "screen-camera" | "screen" | "camera";

type ExtensionSettings = {
  clipsBaseUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  includeDeveloperLogs: boolean;
};

type PopupStartResponse = {
  ok?: boolean;
  error?: string;
  native?: boolean;
  recordingId?: string;
  sessionId?: string;
};

type NativeRecordingStatus =
  | "recording"
  | "stopping"
  | "uploading"
  | "complete"
  | "error";

type NativeRecording = {
  sessionId: string;
  recordingId: string;
  targetTitle: string | null;
  targetUrl: string | null;
  startedAt: string;
  startedAtMs: number;
  status: NativeRecordingStatus;
  recordingUrl: string;
  error: string | null;
};

type PopupStatusResponse = {
  ok?: boolean;
  activeRecording?: NativeRecording | null;
  error?: string;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: "https://clips.agent-native.com",
  captureSurface: "browser",
  includeCamera: true,
  includeMicrophone: true,
  includeDeveloperLogs: true,
};

const SOURCE_LABELS: Record<Exclude<CaptureSurface, "camera">, string> = {
  browser: "Browser tab",
  window: "Window",
  monitor: "Screen",
};

function screenSurface(
  value: CaptureSurface,
): Exclude<CaptureSurface, "camera"> {
  return value === "camera" ? "browser" : value;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function normalizeSurface(value: unknown): CaptureSurface {
  return value === "window" ||
    value === "monitor" ||
    value === "camera" ||
    value === "browser"
    ? value
    : DEFAULT_SETTINGS.captureSurface;
}

function recordingMode(settings: ExtensionSettings): RecordingModeChoice {
  if (settings.captureSurface === "camera") return "camera";
  return settings.includeCamera ? "screen-camera" : "screen";
}

function applyMode(
  settings: ExtensionSettings,
  mode: RecordingModeChoice,
): void {
  if (mode === "camera") {
    settings.captureSurface = "camera";
    settings.includeCamera = true;
    return;
  }
  if (settings.captureSurface === "camera") {
    settings.captureSurface = DEFAULT_SETTINGS.captureSurface;
  }
  settings.includeCamera = mode === "screen-camera";
}

function readSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (value) => {
      resolve({
        clipsBaseUrl:
          typeof value.clipsBaseUrl === "string" && value.clipsBaseUrl.trim()
            ? value.clipsBaseUrl.trim()
            : DEFAULT_SETTINGS.clipsBaseUrl,
        captureSurface: normalizeSurface(value.captureSurface),
        includeCamera:
          typeof value.includeCamera === "boolean"
            ? value.includeCamera
            : DEFAULT_SETTINGS.includeCamera,
        includeMicrophone:
          typeof value.includeMicrophone === "boolean"
            ? value.includeMicrophone
            : DEFAULT_SETTINGS.includeMicrophone,
        includeDeveloperLogs:
          typeof value.includeDeveloperLogs === "boolean"
            ? value.includeDeveloperLogs
            : DEFAULT_SETTINGS.includeDeveloperLogs,
      });
    });
  });
}

function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, () => resolve());
  });
}

function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

function sendStartMessage(
  settings: ExtensionSettings,
): Promise<PopupStartResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CLIPS_POPUP_START", settings },
      (response: PopupStartResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from Clips." });
      },
    );
  });
}

function sendRuntimeMessage<T>(
  message: Record<string, unknown>,
): Promise<T & { error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message } as T & {
          error?: string;
        });
        return;
      }
      resolve(response);
    });
  });
}

function sendSimpleMessage<T>(type: string): Promise<T & { error?: string }> {
  return sendRuntimeMessage<T>({ type });
}

function hostnameLabel(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function comparableLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.(com|net|org|io|dev|app)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function targetCopy(tab: chrome.tabs.Tab | null): {
  title: string;
  subtitle: string;
} {
  const title = tab?.title?.trim() || "Current tab";
  const host = hostnameLabel(tab?.url);
  if (!host) return { title, subtitle: "Ready to record" };
  const titleKey = comparableLabel(title);
  const hostKey = comparableLabel(host);
  return {
    title,
    subtitle:
      titleKey &&
      hostKey &&
      (titleKey === hostKey || hostKey.includes(titleKey))
        ? ""
        : host,
  };
}

function isSignInError(message: string | undefined): boolean {
  return Boolean(
    message && /sign in to clips|unauthorized|unauthenticated/i.test(message),
  );
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  const status = byId<HTMLSpanElement>("status");
  status.textContent = message;
  status.dataset.kind = kind;
}

function renderMode(settings: ExtensionSettings): void {
  const mode = recordingMode(settings);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".mode-option",
  )) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function renderSource(settings: ExtensionSettings): void {
  const sourceSection = byId<HTMLDivElement>("source-section");
  const sourceSummary = byId<HTMLDivElement>("source-summary");
  const cameraOnly = settings.captureSurface === "camera";
  const selectedSurface = screenSurface(settings.captureSurface);
  sourceSection.classList.toggle("disabled", cameraOnly);
  sourceSummary.textContent = cameraOnly
    ? "Screen capture off"
    : `${SOURCE_LABELS[selectedSurface]} selected`;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".source-option",
  )) {
    const surface = normalizeSurface(button.dataset.surface);
    const selected = !cameraOnly && surface === selectedSurface;
    button.disabled = cameraOnly;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function render(settings: ExtensionSettings): void {
  renderMode(settings);
  renderSource(settings);
}

function formatDuration(startedAtMs: number): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderActiveRecording(recording: NativeRecording | null): void {
  const idleContent = byId<HTMLDivElement>("idle-content");
  const activeContent = byId<HTMLDivElement>("active-content");
  const recordingTitle = byId<HTMLDivElement>("recording-title");
  const recordingUrl = byId<HTMLDivElement>("recording-url");
  const recordingStatus = byId<HTMLDivElement>("recording-status");
  const start = byId<HTMLButtonElement>("start");

  const active = Boolean(recording);
  idleContent.hidden = active;
  activeContent.hidden = !active;
  start.hidden = active;
  if (!recording) return;

  recordingTitle.textContent = recording.targetTitle || "Current recording";
  const host = hostnameLabel(recording.targetUrl);
  const titleKey = comparableLabel(recording.targetTitle ?? "");
  const hostKey = comparableLabel(host);
  const duplicate =
    titleKey && hostKey && (titleKey === hostKey || hostKey.includes(titleKey));
  recordingUrl.textContent = duplicate ? "" : host;
  recordingUrl.hidden = !host || Boolean(duplicate);
  recordingStatus.textContent =
    recording.status === "uploading"
      ? "Saving..."
      : recording.status === "stopping"
        ? "Stopping..."
        : recording.status === "error"
          ? recording.error || "Recording needs attention"
          : `Recording ${formatDuration(recording.startedAtMs)}`;
  recordingStatus.dataset.kind =
    recording.status === "error" ? "error" : "info";
}

async function init(): Promise<void> {
  const settings = await readSettings();
  const targetTitle = byId<HTMLDivElement>("target-title");
  const targetUrl = byId<HTMLDivElement>("target-url");
  const idleContent = byId<HTMLDivElement>("idle-content");
  const includeDeveloperLogs = byId<HTMLInputElement>("include-developer-logs");
  const includeMicrophone = byId<HTMLInputElement>("include-microphone");
  const start = byId<HTMLButtonElement>("start");
  const stop = byId<HTMLButtonElement>("stop");
  const discard = byId<HTMLButtonElement>("discard");
  const openRecording = byId<HTMLButtonElement>("open-recording");
  const openOptions = byId<HTMLButtonElement>("open-options");
  const signIn = byId<HTMLButtonElement>("sign-in");
  let activeRecording: NativeRecording | null = null;

  const tab = await queryActiveTab();
  const copy = targetCopy(tab);
  targetTitle.textContent = copy.title;
  targetUrl.textContent = copy.subtitle;
  targetUrl.hidden = !copy.subtitle;

  includeDeveloperLogs.checked = settings.includeDeveloperLogs;
  includeMicrophone.checked = settings.includeMicrophone;
  render(settings);
  const status =
    await sendSimpleMessage<PopupStatusResponse>("CLIPS_POPUP_STATUS");
  activeRecording = status.activeRecording ?? null;
  renderActiveRecording(activeRecording);
  if (activeRecording) {
    window.setInterval(() => renderActiveRecording(activeRecording), 1000);
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".mode-option",
  )) {
    button.addEventListener("click", () => {
      applyMode(settings, button.dataset.mode as RecordingModeChoice);
      render(settings);
      void saveSettings(settings);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".source-option",
  )) {
    button.addEventListener("click", () => {
      settings.captureSurface = normalizeSurface(button.dataset.surface);
      render(settings);
      void saveSettings(settings);
    });
  }

  includeDeveloperLogs.addEventListener("change", () => {
    settings.includeDeveloperLogs = includeDeveloperLogs.checked;
    void saveSettings(settings);
  });

  includeMicrophone.addEventListener("change", () => {
    settings.includeMicrophone = includeMicrophone.checked;
    void saveSettings(settings);
  });

  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  start.addEventListener("click", async () => {
    start.disabled = true;
    signIn.hidden = true;
    setStatus("Starting recording...");
    settings.includeDeveloperLogs = includeDeveloperLogs.checked;
    settings.includeMicrophone = includeMicrophone.checked;
    await saveSettings(settings);
    const response = await sendStartMessage(settings);
    if (response.ok) {
      window.close();
      return;
    }
    start.disabled = false;
    const message = response.error || "Could not start Clips.";
    if (isSignInError(message)) {
      signIn.hidden = false;
      setStatus("Sign in to Clips first, then start recording.", "error");
      return;
    }
    setStatus(message, "error");
  });

  signIn.addEventListener("click", async () => {
    signIn.disabled = true;
    const response = await sendRuntimeMessage<PopupStartResponse>({
      type: "CLIPS_POPUP_SIGN_IN",
      settings,
    });
    if (response.ok) {
      window.close();
      return;
    }
    signIn.disabled = false;
    setStatus(response.error || "Could not open Clips sign in.", "error");
  });

  stop.addEventListener("click", async () => {
    stop.disabled = true;
    discard.disabled = true;
    setStatus("Saving recording...");
    const response =
      await sendSimpleMessage<PopupStartResponse>("CLIPS_POPUP_STOP");
    if (response.ok) {
      window.close();
      return;
    }
    stop.disabled = false;
    discard.disabled = false;
    setStatus(response.error || "Could not stop recording.", "error");
  });

  discard.addEventListener("click", async () => {
    stop.disabled = true;
    discard.disabled = true;
    setStatus("Discarding recording...");
    const response =
      await sendSimpleMessage<PopupStartResponse>("CLIPS_POPUP_CANCEL");
    if (response.ok) {
      activeRecording = null;
      idleContent.hidden = false;
      renderActiveRecording(null);
      setStatus("");
      stop.disabled = false;
      discard.disabled = false;
      return;
    }
    stop.disabled = false;
    discard.disabled = false;
    setStatus(response.error || "Could not discard recording.", "error");
  });

  openRecording.addEventListener("click", async () => {
    const response =
      await sendSimpleMessage<PopupStartResponse>("CLIPS_POPUP_OPEN");
    if (response.ok) {
      window.close();
      return;
    }
    setStatus(response.error || "Could not open recording.", "error");
  });
}

void init().catch((err) => {
  setStatus(
    err instanceof Error ? err.message : "Could not load popup.",
    "error",
  );
});
