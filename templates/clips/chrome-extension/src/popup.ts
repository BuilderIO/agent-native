type CaptureSurface = "browser" | "window" | "monitor" | "camera";

type ExtensionSettings = {
  clipsBaseUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeDeveloperLogs: boolean;
};

type PopupStartResponse = {
  ok?: boolean;
  error?: string;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: "https://clips.agent-native.com",
  captureSurface: "browser",
  includeCamera: true,
  includeDeveloperLogs: true,
};

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

function hostnameLabel(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  const status = byId<HTMLSpanElement>("status");
  status.textContent = message;
  status.dataset.kind = kind;
}

function renderSurface(settings: ExtensionSettings): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".surface-option",
  )) {
    const selected = button.dataset.surface === settings.captureSurface;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  }
  const camera = byId<HTMLInputElement>("include-camera");
  camera.disabled = settings.captureSurface === "camera";
  camera.closest(".toggle-row")?.classList.toggle("disabled", camera.disabled);
}

async function init(): Promise<void> {
  const settings = await readSettings();
  const targetTitle = byId<HTMLDivElement>("target-title");
  const targetUrl = byId<HTMLDivElement>("target-url");
  const includeCamera = byId<HTMLInputElement>("include-camera");
  const includeDeveloperLogs = byId<HTMLInputElement>("include-developer-logs");
  const start = byId<HTMLButtonElement>("start");
  const openOptions = byId<HTMLButtonElement>("open-options");

  const tab = await queryActiveTab();
  targetTitle.textContent = tab?.title || "Current tab";
  targetUrl.textContent = hostnameLabel(tab?.url);

  includeCamera.checked = settings.includeCamera;
  includeDeveloperLogs.checked = settings.includeDeveloperLogs;
  renderSurface(settings);

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".surface-option",
  )) {
    button.addEventListener("click", () => {
      settings.captureSurface = normalizeSurface(button.dataset.surface);
      renderSurface(settings);
      void saveSettings(settings);
    });
  }

  includeCamera.addEventListener("change", () => {
    settings.includeCamera = includeCamera.checked;
    void saveSettings(settings);
  });

  includeDeveloperLogs.addEventListener("change", () => {
    settings.includeDeveloperLogs = includeDeveloperLogs.checked;
    void saveSettings(settings);
  });

  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  start.addEventListener("click", async () => {
    start.disabled = true;
    setStatus("Opening Clips...");
    settings.includeCamera = includeCamera.checked;
    settings.includeDeveloperLogs = includeDeveloperLogs.checked;
    await saveSettings(settings);
    const response = await sendStartMessage(settings);
    if (response.ok) {
      window.close();
      return;
    }
    start.disabled = false;
    setStatus(response.error || "Could not open Clips.", "error");
  });
}

void init().catch((err) => {
  setStatus(
    err instanceof Error ? err.message : "Could not load popup.",
    "error",
  );
});
