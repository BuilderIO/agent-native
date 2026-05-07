export type RecordingTitleSource =
  | "default"
  | "context"
  | "upload"
  | "ai"
  | "manual";

export interface CaptureTitleContext {
  appName?: string | null;
  windowTitle?: string | null;
  displaySurface?: "monitor" | "window" | "browser" | string | null;
  mode?: "screen" | "camera" | "screen+camera" | string | null;
  now?: Date;
}

export interface CaptureTitleResult {
  title: string;
  titleSource: RecordingTitleSource;
  sourceAppName: string | null;
  sourceWindowTitle: string | null;
}

const DEFAULT_TITLE = "Untitled recording";
const BROWSER_APPS = new Set([
  "arc",
  "brave browser",
  "brave",
  "chrome",
  "google chrome",
  "microsoft edge",
  "edge",
  "safari",
  "firefox",
]);

const GENERIC_CAPTURE_LABELS = [
  /^screen(:|\s|$)/i,
  /^window(:|\s|$)/i,
  /^display(:|\s|$)/i,
  /^monitor(:|\s|$)/i,
  /^entire screen$/i,
  /^browser tab$/i,
];

export function buildCaptureTitle({
  appName,
  windowTitle,
  displaySurface,
  mode,
  now = new Date(),
}: CaptureTitleContext): CaptureTitleResult {
  const cleanApp = cleanTitlePart(appName);
  const cleanWindow = cleanTitlePart(windowTitle);
  const appLower = cleanApp?.toLowerCase() ?? "";

  let subject: string | null = null;
  if (cleanWindow && BROWSER_APPS.has(appLower)) {
    subject = stripBrowserSuffix(cleanWindow);
  } else if (cleanApp && cleanWindow && !sameTitle(cleanApp, cleanWindow)) {
    subject = `${cleanApp} - ${cleanWindow}`;
  } else {
    subject = cleanWindow ?? cleanApp;
  }

  if (!subject) {
    subject = fallbackSubject(displaySurface, mode);
  }

  return {
    title: `${subject} - ${formatFriendlyDate(now)}`,
    titleSource: subject ? "context" : "default",
    sourceAppName: cleanApp,
    sourceWindowTitle: cleanWindow,
  };
}

export function inferWindowTitleFromDisplayStream(
  stream: MediaStream | null,
): string | null {
  const label = cleanTitlePart(stream?.getVideoTracks()[0]?.label);
  if (!label) return null;
  if (GENERIC_CAPTURE_LABELS.some((pattern) => pattern.test(label))) {
    return null;
  }
  return label;
}

function fallbackSubject(
  displaySurface: CaptureTitleContext["displaySurface"],
  mode: CaptureTitleContext["mode"],
): string {
  if (mode === "camera") return "Camera recording";
  if (displaySurface === "browser") return "Browser tab";
  if (displaySurface === "window") return "Window recording";
  return "Screen recording";
}

function formatFriendlyDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function cleanTitlePart(value: string | null | undefined): string | null {
  const cleaned = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 160);
}

function stripBrowserSuffix(value: string): string {
  return value
    .replace(
      /\s+-\s+(Google Chrome|Chrome|Brave Browser|Brave|Microsoft Edge|Edge|Safari|Firefox)$/i,
      "",
    )
    .trim();
}

function sameTitle(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

export function defaultRecordingTitle(): string {
  return DEFAULT_TITLE;
}
