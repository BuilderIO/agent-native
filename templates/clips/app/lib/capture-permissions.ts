export type CaptureHostApp = {
  /** The name macOS lists this app under in Privacy & Security. */
  name: string;
  kind: "desktop" | "browser";
};

export type CapturePermissionPane = "screen" | "camera" | "microphone";

export type CaptureHostEnv = {
  userAgent: string;
  isTauri: boolean;
  isBrave: boolean;
  isArc: boolean;
};

const UNKNOWN_BROWSER = "your browser";

// Arc does not identify itself in the user agent, but it injects its palette
// variables onto the document element, so a browser reporting plain Chrome
// while exposing --arc-palette-title is Arc.
function detectArc(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    return Boolean(
      window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--arc-palette-title")
        .trim(),
    );
  } catch {
    return false;
  }
}

export function readCaptureHostEnv(): CaptureHostEnv {
  const tauri =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as {
          __TAURI_INTERNALS__?: unknown;
          __TAURI__?: unknown;
        });
  return {
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    isTauri: Boolean(tauri?.__TAURI_INTERNALS__ || tauri?.__TAURI__),
    isBrave:
      typeof navigator !== "undefined" &&
      Boolean((navigator as { brave?: unknown }).brave),
    isArc: detectArc(),
  };
}

export function detectCaptureHostApp(env: CaptureHostEnv): CaptureHostApp {
  if (env.isTauri) return { name: "Clips", kind: "desktop" };
  if (/Electron/i.test(env.userAgent)) {
    return { name: "Agent Native", kind: "desktop" };
  }
  const ua = env.userAgent;
  const name = /Vivaldi/i.test(ua)
    ? "Vivaldi"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Edg\//i.test(ua)
        ? "Microsoft Edge"
        : env.isBrave
          ? "Brave Browser"
          : env.isArc
            ? "Arc"
            : /Firefox\//i.test(ua)
              ? "Firefox"
              : /Chrome\//i.test(ua)
                ? "Google Chrome"
                : /Safari\//i.test(ua)
                  ? "Safari"
                  : UNKNOWN_BROWSER;
  return { name, kind: "browser" };
}

/**
 * macOS grants screen, camera, and microphone access per application, so
 * permission guidance has to name the app hosting the recorder — Clips itself
 * never appears in System Settings when it runs in a browser tab.
 */
export function getCaptureHostApp(): CaptureHostApp {
  return detectCaptureHostApp(readCaptureHostEnv());
}

export function macSettingsPath(pane: CapturePermissionPane): string {
  const label =
    pane === "screen"
      ? "Screen & System Audio Recording"
      : pane === "camera"
        ? "Camera"
        : "Microphone";
  return `System Settings > Privacy & Security > ${label}`;
}

export function macPermissionGuidanceFor(
  pane: CapturePermissionPane,
  host: CaptureHostApp = getCaptureHostApp(),
): string {
  const where = macSettingsPath(pane);
  if (host.kind === "desktop") {
    return `macOS grants this per app. Turn on ${host.name} in ${where}, then quit and reopen ${host.name} and start the recording again.`;
  }
  const subject = host.name === UNKNOWN_BROWSER ? "it" : host.name;
  return `macOS grants this per app, not per site, so Clips is never listed by name — look for ${host.name} instead. Turn ${subject} on in ${where}, then quit and reopen it. If it is not listed yet, add it with the + button.`;
}
