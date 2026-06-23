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

type AuthStatus = "checking" | "signed-in" | "signed-out";

type StoredAuth = {
  token: string;
  email?: string;
  clipsBaseUrl: string;
  savedAt?: string;
};

type ParsedFeedbackTarget = {
  endpoint: string;
  slug: string;
};

type FeedbackFormSchema = {
  formId: string;
  fieldId: string;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  clipsBaseUrl: "https://clips.agent-native.com",
  captureSurface: "browser",
  includeCamera: true,
  includeMicrophone: true,
  includeDeveloperLogs: true,
};

const SOURCE_LABELS: Record<Exclude<CaptureSurface, "camera">, string> = {
  browser: "Current tab",
  window: "Window",
  monitor: "Full screen",
};

const FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";
const FEEDBACK_PLACEHOLDER = "Tell us what's on your mind...";
const FEEDBACK_SUBMIT_TEXT = "Send feedback";
const FEEDBACK_SUCCESS_MESSAGE = "Thanks for the feedback!";
const feedbackTarget = parseFeedbackTarget(FEEDBACK_URL);
const feedbackSchemaCache = new Map<string, Promise<FeedbackFormSchema>>();

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

function parseFeedbackTarget(url: string): ParsedFeedbackTarget | null {
  try {
    const parsed = new URL(url);
    const index = parsed.pathname.indexOf("/f/");
    if (index === -1) return null;
    const slug = parsed.pathname.slice(index + 3).replace(/\/$/, "");
    if (!slug) return null;
    return { endpoint: parsed.origin, slug };
  } catch {
    return null;
  }
}

async function loadFeedbackSchema(
  target: ParsedFeedbackTarget,
): Promise<FeedbackFormSchema> {
  const key = `${target.endpoint}|${target.slug}`;
  const cached = feedbackSchemaCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(
      `${target.endpoint}/api/forms/public/${encodeURIComponent(target.slug)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`form fetch ${response.status}`);
    const body = (await response.json()) as {
      id: string;
      fields: Array<{ id: string; type: string }>;
    };
    const field =
      body.fields.find((entry) => entry.type === "textarea") ??
      body.fields.find((entry) => entry.type === "text") ??
      body.fields[0];
    if (!field) throw new Error("form has no fields");
    return { formId: body.id, fieldId: field.id };
  })();

  pending.catch(() => feedbackSchemaCache.delete(key));
  feedbackSchemaCache.set(key, pending);
  return pending;
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

function readStoredAuth(
  settings: ExtensionSettings,
): Promise<StoredAuth | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get("clipsAuth", (value) => {
      const auth = value.clipsAuth as Partial<StoredAuth> | undefined;
      if (
        auth &&
        typeof auth.token === "string" &&
        auth.token.trim() &&
        typeof auth.clipsBaseUrl === "string" &&
        auth.clipsBaseUrl.replace(/\/+$/, "") ===
          settings.clipsBaseUrl.replace(/\/+$/, "")
      ) {
        resolve({
          token: auth.token,
          email: typeof auth.email === "string" ? auth.email : undefined,
          clipsBaseUrl: auth.clipsBaseUrl.replace(/\/+$/, ""),
          savedAt: typeof auth.savedAt === "string" ? auth.savedAt : undefined,
        });
        return;
      }
      resolve(null);
    });
  });
}

function clearStoredAuth(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.remove("clipsAuth", () => resolve());
  });
}

async function authHeaders(
  settings: ExtensionSettings,
): Promise<Record<string, string>> {
  const auth = await readStoredAuth(settings);
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
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

function createTab(url: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.create({ url }, () => resolve());
  });
}

async function readAuthStatus(
  settings: ExtensionSettings,
): Promise<AuthStatus> {
  const headers = await authHeaders(settings);
  try {
    const response = await fetch(
      `${settings.clipsBaseUrl}/_agent-native/auth/session`,
      {
        method: "GET",
        headers,
        credentials: "include",
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => null)) as {
      email?: string;
      error?: string;
    } | null;
    if (response.ok && body?.email) return "signed-in";
    if (headers.Authorization) await clearStoredAuth();
    return "signed-out";
  } catch {
    return "signed-out";
  }
}

async function readVideoStorageConfigured(
  settings: ExtensionSettings,
): Promise<boolean> {
  const base = settings.clipsBaseUrl.replace(/\/+$/, "");
  const headers = await authHeaders(settings);

  try {
    const response = await fetch(`${base}/_agent-native/file-upload/status`, {
      method: "GET",
      headers,
      credentials: "include",
      cache: "no-store",
    });
    const body = response.ok
      ? ((await response.json().catch(() => null)) as {
          configured?: boolean;
        } | null)
      : null;
    if (body?.configured) return true;
  } catch {
    // Fall through to the Builder status check.
  }

  try {
    const response = await fetch(`${base}/_agent-native/builder/status`, {
      method: "GET",
      headers,
      credentials: "include",
      cache: "no-store",
    });
    const body = response.ok
      ? ((await response.json().catch(() => null)) as {
          configured?: boolean;
        } | null)
      : null;
    return !!body?.configured;
  } catch {
    return false;
  }
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
  const sourceRow = byId<HTMLDivElement>("source-row");
  const sourceLabel = byId<HTMLSpanElement>("source-label");
  const cameraOnly = settings.captureSurface === "camera";
  const selectedSurface = screenSurface(settings.captureSurface);
  sourceRow.hidden = cameraOnly;
  sourceLabel.textContent = SOURCE_LABELS[selectedSurface];

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".row-menu-item[data-surface]",
  )) {
    const surface = normalizeSurface(button.dataset.surface);
    const selected = !cameraOnly && surface === selectedSurface;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
    const check = button.querySelector<HTMLSpanElement>(".row-menu-check");
    if (check) check.textContent = selected ? "✓" : "";
  }
}

function render(settings: ExtensionSettings): void {
  renderMode(settings);
  renderSource(settings);
  const includeCamera = byId<HTMLButtonElement>("include-camera");
  const includeMicrophone = byId<HTMLButtonElement>("include-microphone");
  const cameraRow = byId<HTMLDivElement>("camera-row");
  const showCameraRow =
    settings.captureSurface === "camera" || settings.includeCamera;
  cameraRow.hidden = !showCameraRow;
  includeCamera.classList.toggle("toggle-on", settings.includeCamera);
  includeCamera.classList.toggle("toggle-off", !settings.includeCamera);
  includeCamera.textContent = settings.includeCamera ? "On" : "Off";
  includeCamera.setAttribute(
    "aria-checked",
    settings.includeCamera ? "true" : "false",
  );
  includeCamera.hidden = !showCameraRow;
  includeMicrophone.classList.toggle("toggle-on", settings.includeMicrophone);
  includeMicrophone.classList.toggle("toggle-off", !settings.includeMicrophone);
  includeMicrophone.textContent = settings.includeMicrophone ? "On" : "Off";
  includeMicrophone.setAttribute(
    "aria-checked",
    settings.includeMicrophone ? "true" : "false",
  );
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
  const signIn = byId<HTMLButtonElement>("sign-in");
  const recordingActions =
    document.querySelector<HTMLDivElement>(".recording-actions");

  const active = Boolean(recording);
  idleContent.hidden = active;
  activeContent.hidden = !active;
  start.hidden = active;
  signIn.hidden = true;
  if (recordingActions) recordingActions.hidden = !active;
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
  const sourceButton = byId<HTMLButtonElement>("source-button");
  const sourceMenu = byId<HTMLDivElement>("source-menu");
  const includeCamera = byId<HTMLButtonElement>("include-camera");
  const includeMicrophone = byId<HTMLButtonElement>("include-microphone");
  const start = byId<HTMLButtonElement>("start");
  const stop = byId<HTMLButtonElement>("stop");
  const discard = byId<HTMLButtonElement>("discard");
  const openRecording = byId<HTMLButtonElement>("open-recording");
  const close = byId<HTMLButtonElement>("close");
  const feedback = byId<HTMLButtonElement>("feedback");
  const feedbackPopover = byId<HTMLDivElement>("feedback-popover");
  const feedbackForm = byId<HTMLFormElement>("feedback-form");
  const feedbackTextarea = byId<HTMLTextAreaElement>("feedback-textarea");
  const feedbackHoneypot = byId<HTMLInputElement>("feedback-honeypot");
  const feedbackHint = byId<HTMLDivElement>("feedback-hint");
  const feedbackSubmit = byId<HTMLButtonElement>("feedback-submit");
  const feedbackSuccess = byId<HTMLDivElement>("feedback-success");
  const openLibrary = byId<HTMLButtonElement>("open-library");
  const openSettings = byId<HTMLButtonElement>("open-settings");
  const openRecent = byId<HTMLButtonElement>("open-recent");
  const signIn = byId<HTMLButtonElement>("sign-in");
  let activeRecording: NativeRecording | null = null;
  let authStatus: AuthStatus = "checking";
  let feedbackOpenedAt = 0;
  let feedbackSchema: FeedbackFormSchema | null = null;
  let feedbackCloseTimer: number | null = null;

  const feedbackShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "Cmd"
    : "Ctrl";

  const setFeedbackOpen = (open: boolean): void => {
    feedbackPopover.hidden = !open;
    feedback.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && feedbackCloseTimer !== null) {
      window.clearTimeout(feedbackCloseTimer);
      feedbackCloseTimer = null;
    }
  };

  const resetFeedbackForm = (): void => {
    feedbackOpenedAt = Date.now();
    feedbackSchema = null;
    feedbackTextarea.value = "";
    feedbackTextarea.placeholder = FEEDBACK_PLACEHOLDER;
    feedbackHoneypot.value = "";
    feedbackHint.textContent = `${feedbackShortcut}+Enter to send`;
    feedbackHint.classList.remove("is-error");
    feedbackSubmit.textContent = FEEDBACK_SUBMIT_TEXT;
    feedbackSubmit.disabled = true;
    feedbackForm.hidden = false;
    feedbackSuccess.hidden = true;
    feedbackSuccess.querySelector(".feedback-success-title")!.textContent =
      FEEDBACK_SUCCESS_MESSAGE;
  };

  const openFeedback = (): void => {
    resetFeedbackForm();
    setFeedbackOpen(true);
    if (feedbackTarget) {
      void loadFeedbackSchema(feedbackTarget)
        .then((schema) => {
          feedbackSchema = schema;
        })
        .catch((err) => {
          feedbackHint.textContent =
            err instanceof Error ? err.message : "Couldn't load feedback form";
          feedbackHint.classList.add("is-error");
        });
    } else {
      feedbackHint.textContent = "Invalid feedback URL";
      feedbackHint.classList.add("is-error");
    }
    window.setTimeout(() => feedbackTextarea.focus(), 30);
  };

  await queryActiveTab();
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

  sourceButton.addEventListener("click", () => {
    sourceMenu.hidden = !sourceMenu.hidden;
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".row-menu-item[data-surface]",
  )) {
    button.addEventListener("click", () => {
      settings.captureSurface = normalizeSurface(button.dataset.surface);
      sourceMenu.hidden = true;
      render(settings);
      void saveSettings(settings);
    });
  }

  includeCamera.addEventListener("click", () => {
    settings.includeCamera = !settings.includeCamera;
    if (settings.includeCamera && settings.captureSurface === "monitor") {
      settings.captureSurface = "browser";
    }
    if (!settings.includeCamera && settings.captureSurface === "camera") {
      settings.captureSurface = "browser";
    }
    render(settings);
    void saveSettings(settings);
  });

  includeMicrophone.addEventListener("click", () => {
    settings.includeMicrophone = !settings.includeMicrophone;
    render(settings);
    void saveSettings(settings);
  });

  close.addEventListener("click", () => window.close());

  feedback.addEventListener("click", (event) => {
    event.stopPropagation();
    if (feedbackPopover.hidden) {
      openFeedback();
      return;
    }
    setFeedbackOpen(false);
  });

  feedbackPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    if (feedbackPopover.hidden) return;
    if (
      event.target instanceof Node &&
      !feedbackPopover.contains(event.target) &&
      !feedback.contains(event.target)
    ) {
      setFeedbackOpen(false);
    }
  });

  feedbackTextarea.addEventListener("input", () => {
    feedbackSubmit.disabled = !feedbackTextarea.value.trim();
  });

  feedbackTextarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      feedbackForm.requestSubmit();
    }
  });

  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!feedbackTarget) {
      feedbackHint.textContent = "Invalid feedback URL";
      feedbackHint.classList.add("is-error");
      return;
    }
    const value = feedbackTextarea.value.trim();
    if (!value) {
      feedbackHint.textContent = "Please write something first";
      feedbackHint.classList.add("is-error");
      return;
    }
    feedbackSubmit.disabled = true;
    feedbackSubmit.textContent = "Sending...";
    feedbackHint.textContent = "";
    feedbackHint.classList.remove("is-error");
    try {
      const schema =
        feedbackSchema ?? (await loadFeedbackSchema(feedbackTarget));
      feedbackSchema = schema;
      const response = await fetch(
        `${feedbackTarget.endpoint}/api/submit/${encodeURIComponent(schema.formId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: { [schema.fieldId]: value },
            _t: feedbackOpenedAt,
            _hp: feedbackHoneypot.value,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `submit failed (${response.status})`);
      }
      feedbackForm.hidden = true;
      feedbackSuccess.hidden = false;
      feedbackCloseTimer = window.setTimeout(
        () => setFeedbackOpen(false),
        1400,
      );
    } catch (err) {
      feedbackSubmit.disabled = !feedbackTextarea.value.trim();
      feedbackSubmit.textContent = FEEDBACK_SUBMIT_TEXT;
      feedbackHint.textContent =
        err instanceof Error ? err.message : "Couldn't send feedback";
      feedbackHint.classList.add("is-error");
    }
  });

  openLibrary.addEventListener("click", async () => {
    await createTab(settings.clipsBaseUrl);
    window.close();
  });

  openSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  openRecent.addEventListener("click", async () => {
    await createTab(settings.clipsBaseUrl);
    window.close();
  });

  authStatus = await readAuthStatus(settings);
  if (!activeRecording && authStatus === "signed-out") {
    start.hidden = true;
    signIn.hidden = false;
    setStatus("");
  }

  start.addEventListener("click", async () => {
    start.disabled = true;
    signIn.hidden = true;
    setStatus("Checking sign in...");
    authStatus = await readAuthStatus(settings);
    if (authStatus === "signed-out") {
      start.disabled = false;
      start.hidden = true;
      signIn.hidden = false;
      setStatus("");
      return;
    }
    setStatus("Checking video storage...");
    const storageConfigured = await readVideoStorageConfigured(settings);
    if (!storageConfigured) {
      start.disabled = false;
      setStatus(
        "Connect Builder.io or S3 storage in Clips, then start recording.",
        "error",
      );
      await createTab(`${settings.clipsBaseUrl.replace(/\/+$/, "")}/record`);
      window.close();
      return;
    }
    setStatus("Starting recording...");
    await saveSettings(settings);
    const response = await sendStartMessage(settings);
    if (response.ok) {
      window.close();
      return;
    }
    start.disabled = false;
    const message = response.error || "Could not start Clips.";
    if (isSignInError(message)) {
      start.hidden = true;
      signIn.hidden = false;
      setStatus("");
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
      renderActiveRecording(null);
      if (authStatus === "signed-in") start.hidden = false;
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
