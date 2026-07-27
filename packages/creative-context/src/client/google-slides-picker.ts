const GOOGLE_PICKER_SCRIPT = "https://apis.google.com/js/api.js";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";
const GOOGLE_PICKER_LOAD_TIMEOUT_MS = 15_000;
const GOOGLE_PICKER_SELECTION_TIMEOUT_MS = 5 * 60_000;
const GOOGLE_DRIVE_FILE_ID = /^[A-Za-z0-9_-]{8,256}$/;

declare global {
  interface Window {
    gapi?: any;
    google?: any;
    __creativeContextGooglePickerScript?: Promise<void>;
  }
}

export interface GoogleSlidesPickerSelection {
  externalId: string;
  title: string;
  canonicalUrl?: string;
}

export function googleSlidesPickerSelections(
  value: unknown,
): GoogleSlidesPickerSelection[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const docs = (value as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) return [];
  const seen = new Set<string>();
  return docs.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const externalId = typeof record.id === "string" ? record.id.trim() : "";
    if (!GOOGLE_DRIVE_FILE_ID.test(externalId) || seen.has(externalId)) {
      return [];
    }
    seen.add(externalId);
    const title =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim().slice(0, 300)
        : "Google Slides presentation";
    const canonicalUrl = `https://docs.google.com/presentation/d/${encodeURIComponent(externalId)}/edit`;
    return [{ externalId, title, canonicalUrl }];
  });
}

async function withGooglePickerTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = GOOGLE_PICKER_LOAD_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadGooglePicker(): Promise<void> {
  if (!window.gapi) {
    window.__creativeContextGooglePickerScript ??= new Promise(
      (resolve, reject) => {
        const script = document.createElement("script");
        script.src = GOOGLE_PICKER_SCRIPT;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not load Google Picker."));
        document.head.appendChild(script);
      },
    );
    await withGooglePickerTimeout(
      window.__creativeContextGooglePickerScript,
      "Google Picker script timed out.",
    );
  }
  if (!window.gapi?.load) throw new Error("Google Picker did not initialize.");
  await withGooglePickerTimeout(
    new Promise<void>((resolve, reject) => {
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Could not load Google Picker.")),
      });
    }),
    "Google Picker initialization timed out.",
  );
}

export async function chooseGoogleSlidesPresentations(input: {
  accessToken: string;
  apiKey: string;
  appId: string;
}): Promise<GoogleSlidesPickerSelection[]> {
  await loadGooglePicker();
  const google = window.google;
  if (!google?.picker) throw new Error("Google Picker is unavailable.");
  return withGooglePickerTimeout(
    new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(
        google.picker.ViewId.PRESENTATIONS,
      )
        .setMimeTypes(GOOGLE_SLIDES_MIME_TYPE)
        .setSelectFolderEnabled(false);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(input.accessToken)
        .setDeveloperKey(input.apiKey)
        .setAppId(input.appId)
        .setTitle("Choose Google Slides presentations")
        .setCallback((data: unknown) => {
          if (
            data &&
            typeof data === "object" &&
            (data as { action?: unknown }).action ===
              google.picker.Action.CANCEL
          ) {
            resolve([]);
            return;
          }
          if (
            !data ||
            typeof data !== "object" ||
            (data as { action?: unknown }).action !==
              google.picker.Action.PICKED
          ) {
            return;
          }
          const selections = googleSlidesPickerSelections(data);
          if (!selections.length) {
            reject(new Error("Google Picker returned no presentations."));
            return;
          }
          resolve(selections);
        })
        .build();
      picker.setVisible(true);
    }),
    "Google Picker selection timed out.",
    GOOGLE_PICKER_SELECTION_TIMEOUT_MS,
  );
}
