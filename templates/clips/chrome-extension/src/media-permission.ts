// Camera/microphone grants for the chrome-extension:// origin, and the one
// failure they produce that does not mean "the user cancelled".
//
// Chrome only shows the permission prompt for a real extension page, so the
// headless offscreen recorder can never answer one: an ungranted getUserMedia()
// there rejects immediately with NotAllowedError "Permission dismissed". The
// cached grant below is what lets a recording get that far — it can outlive the
// real grant (Chrome revokes permissions for origins it considers unused, and
// clearing site data drops them), and nothing but reinstalling the extension
// used to clear it. So a dismissal from a headless context is a missing grant to
// recover from, never a cancellation to report back as-is.

const CACHE_KEY = "clipsMediaPermission";

export const MEDIA_PERMISSION_REQUIRED_CODE = "CLIPS_MEDIA_PERMISSION_REQUIRED";

export const MEDIA_PERMISSION_DEVICES = ["camera", "microphone"] as const;

export type MediaPermissionDevice = (typeof MEDIA_PERMISSION_DEVICES)[number];

export type MediaPermissionRequirements = Record<
  MediaPermissionDevice,
  boolean
>;

export type CachedMediaPermission = Partial<MediaPermissionRequirements>;

export type MediaPermissionSettings = {
  captureSurface: "browser" | "window" | "monitor" | "camera";
  includeCamera: boolean;
  includeMicrophone: boolean;
};

export function mediaPermissionRequirements(
  settings: MediaPermissionSettings,
): MediaPermissionRequirements {
  return {
    camera: settings.captureSurface === "camera" || settings.includeCamera,
    microphone: settings.includeMicrophone,
  };
}

export function mediaPermissionRequiredMessage(
  device: MediaPermissionDevice,
): string {
  return `Chrome has not granted Clips ${device} access. Allow it in the tab that just opened, then start the recording again.`;
}

export function toMediaPermissionDevice(
  value: unknown,
): MediaPermissionDevice | null {
  return value === "camera" || value === "microphone" ? value : null;
}

export class MediaPermissionRequiredError extends Error {
  readonly code = MEDIA_PERMISSION_REQUIRED_CODE;
  readonly device: MediaPermissionDevice;

  constructor(device: MediaPermissionDevice, options?: { cause?: unknown }) {
    super(mediaPermissionRequiredMessage(device));
    this.name = "MediaPermissionRequiredError";
    this.device = device;
    // `cause` is set here rather than through the Error options bag: the
    // extension's TS lib target predates it, and the original NotAllowedError
    // is what makes the Sentry report diagnosable.
    if (options && "cause" in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// True only for the "Chrome would have to ask, and nobody can answer" family. A
// system-level denial (macOS/Windows privacy settings) reads the same to the
// page but cannot be fixed from the permission page, so it stays a raw failure.
export function isMediaPermissionDeniedError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");
  if (/\bdenied by system\b/i.test(text)) return false;
  return (
    /\bNotAllowedError\b/.test(text) ||
    /\bPermission (?:denied|dismissed)\b/i.test(text)
  );
}

// Wraps a getUserMedia() call made where Chrome cannot prompt.
export async function requireMediaPermission<T>(
  device: MediaPermissionDevice,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!isMediaPermissionDeniedError(error)) throw error;
    throw new MediaPermissionRequiredError(device, { cause: error });
  }
}

// Rebuilds the typed error on the receiving side of a message reply, so a
// missing grant stays branchable instead of decaying into a message string.
export function mediaPermissionErrorFromResponse(response: {
  errorCode?: string;
  errorDevice?: string;
}): MediaPermissionRequiredError | null {
  const device = toMediaPermissionDevice(response.errorDevice);
  if (response.errorCode !== MEDIA_PERMISSION_REQUIRED_CODE || !device) {
    return null;
  }
  return new MediaPermissionRequiredError(device);
}

export function permissionPageUrl(
  requirements: MediaPermissionRequirements,
  options?: { startAfterGrant?: boolean },
): string {
  const url = new URL(chrome.runtime.getURL("src/permission.html"));
  if (options?.startAfterGrant) url.searchParams.set("startAfterGrant", "1");
  url.searchParams.set("needsCamera", String(requirements.camera));
  url.searchParams.set("needsMicrophone", String(requirements.microphone));
  return url.toString();
}

export function readCachedMediaPermission(): Promise<CachedMediaPermission> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_KEY, (value) => {
      const cached = value?.[CACHE_KEY];
      resolve(
        cached && typeof cached === "object"
          ? (cached as CachedMediaPermission)
          : {},
      );
    });
  });
}

export async function writeCachedMediaPermission(
  patch: CachedMediaPermission,
): Promise<void> {
  const current = await readCachedMediaPermission();
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: { ...current, ...patch } }, () =>
      resolve(),
    );
  });
}

// Device labels are exposed only while the origin holds a live grant, so this
// separates a cached grant Chrome still honors from one it revoked — without the
// prompt that neither the popup nor the offscreen document can show.
export async function hasGrantedDeviceLabels(
  device: MediaPermissionDevice,
): Promise<boolean> {
  const kind = device === "camera" ? "videoinput" : "audioinput";
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((entry) => entry.kind === kind && Boolean(entry.label));
  } catch {
    // Unreadable, not "revoked" — but the only caller uses this to decide
    // whether to route through the permission page, which recovers either way.
    return false;
  }
}
