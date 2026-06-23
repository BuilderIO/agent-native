type CaptureSurface = "browser" | "window" | "monitor" | "camera";

type ExtensionSettings = {
  clipsBaseUrl: string;
  captureSurface: CaptureSurface;
  includeCamera: boolean;
  includeMicrophone: boolean;
  includeDeveloperLogs: boolean;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: "https://clips.agent-native.com",
  captureSurface: "browser",
  includeCamera: true,
  includeMicrophone: true,
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
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError)
        reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function render(settings: ExtensionSettings): void {
  byId<HTMLInputElement>("clips-base-url").value = settings.clipsBaseUrl;
  byId<HTMLSelectElement>("capture-surface").value = settings.captureSurface;
  byId<HTMLInputElement>("include-camera").checked = settings.includeCamera;
  byId<HTMLInputElement>("include-microphone").checked =
    settings.includeMicrophone;
  byId<HTMLInputElement>("include-developer-logs").checked =
    settings.includeDeveloperLogs;
}

function readForm(): ExtensionSettings {
  const rawBaseUrl = byId<HTMLInputElement>("clips-base-url").value.trim();
  const clipsBaseUrl = rawBaseUrl || DEFAULT_SETTINGS.clipsBaseUrl;
  const parsed = new URL(clipsBaseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Use an http or https Clips URL.");
  }
  parsed.search = "";
  parsed.hash = "";
  return {
    clipsBaseUrl: parsed.toString().replace(/\/+$/, ""),
    captureSurface: normalizeSurface(
      byId<HTMLSelectElement>("capture-surface").value,
    ),
    includeCamera: byId<HTMLInputElement>("include-camera").checked,
    includeMicrophone: byId<HTMLInputElement>("include-microphone").checked,
    includeDeveloperLogs: byId<HTMLInputElement>("include-developer-logs")
      .checked,
  };
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  const status = byId<HTMLParagraphElement>("status");
  status.textContent = message;
  status.dataset.kind = kind;
}

async function init(): Promise<void> {
  render(await readSettings());

  byId<HTMLFormElement>("settings-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      try {
        const settings = readForm();
        await saveSettings(settings);
        setStatus("Settings saved.");
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : "Could not save settings.",
          "error",
        );
      }
    },
  );

  byId<HTMLButtonElement>("reset").addEventListener("click", async () => {
    render(DEFAULT_SETTINGS);
    await saveSettings(DEFAULT_SETTINGS);
    setStatus("Defaults restored.");
  });
}

void init().catch((err) => {
  setStatus(
    err instanceof Error ? err.message : "Could not load settings.",
    "error",
  );
});
