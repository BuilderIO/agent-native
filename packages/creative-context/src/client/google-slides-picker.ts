const GOOGLE_PICKER_SCRIPT = "https://apis.google.com/js/api.js";
const GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation";

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
    if (!externalId || seen.has(externalId)) return [];
    seen.add(externalId);
    const title =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : "Google Slides presentation";
    const canonicalUrl =
      typeof record.url === "string" && record.url.startsWith("https://")
        ? record.url
        : `https://docs.google.com/presentation/d/${encodeURIComponent(externalId)}/edit`;
    return [{ externalId, title, canonicalUrl }];
  });
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
    await window.__creativeContextGooglePickerScript;
  }
  await new Promise<void>((resolve, reject) => {
    window.gapi?.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Could not load Google Picker.")),
    });
  });
}

export async function chooseGoogleSlidesPresentations(input: {
  accessToken: string;
  apiKey: string;
  appId: string;
}): Promise<GoogleSlidesPickerSelection[]> {
  await loadGooglePicker();
  const google = window.google;
  if (!google?.picker) throw new Error("Google Picker is unavailable.");
  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.PRESENTATIONS)
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
          (data as { action?: unknown }).action === google.picker.Action.CANCEL
        ) {
          resolve([]);
          return;
        }
        if (
          !data ||
          typeof data !== "object" ||
          (data as { action?: unknown }).action !== google.picker.Action.PICKED
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
  });
}
