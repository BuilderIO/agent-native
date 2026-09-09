export const DEFAULT_DISPATCH_BASE_URL =
  "https://dispatch.agent-native.com" as const;
export const DISPATCH_SETTINGS_KEY = "agentNativeBrowserSettings" as const;

export interface ExtensionSettings {
  dispatchBaseUrl: string;
}

export function normalizeDispatchBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function readSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(DISPATCH_SETTINGS_KEY);
  const candidate = stored[DISPATCH_SETTINGS_KEY] as
    | Partial<ExtensionSettings>
    | undefined;
  return {
    dispatchBaseUrl:
      normalizeDispatchBaseUrl(candidate?.dispatchBaseUrl) ??
      DEFAULT_DISPATCH_BASE_URL,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const dispatchBaseUrl = normalizeDispatchBaseUrl(settings.dispatchBaseUrl);
  if (!dispatchBaseUrl) throw new Error("Invalid Dispatch base URL.");
  await chrome.storage.local.set({
    [DISPATCH_SETTINGS_KEY]: { dispatchBaseUrl },
  });
}
