export interface CodeWorkbenchTheme {
  colorScheme: "light" | "dark";
  values: Record<string, string>;
}

const WORKBENCH_THEME_VARS: Record<string, string[]> = {
  "--workbench-bg": ["--design-editor-panel-bg", "--background"],
  "--workbench-sidebar-bg": ["--design-editor-panel-bg", "--card"],
  "--workbench-editor-bg": ["--design-editor-panel-bg", "--background"],
  "--workbench-surface-bg": ["--design-editor-control-bg", "--muted"],
  "--workbench-border": ["--design-editor-control-border", "--border"],
  "--workbench-fg": ["--foreground"],
  "--workbench-muted-fg": ["--muted-foreground"],
  "--workbench-hover-bg": ["--design-editor-layer-hover-color", "--accent"],
  "--workbench-active-bg": ["--design-editor-selection-color", "--accent"],
  "--workbench-active-fg": [
    "--design-editor-accent-color",
    "--accent-foreground",
  ],
  "--workbench-accent": ["--design-editor-accent-color", "--primary"],
  "--workbench-button-bg": ["--design-editor-control-bg", "--background"],
  "--workbench-button-fg": ["--foreground"],
  "--workbench-selection-bg": ["--design-editor-selection-color", "--accent"],
  "--workbench-dirty": ["--warning", "--destructive"],

  // Activity bar (40px icon rail).
  "--workbench-activitybar-bg": [
    "--design-editor-control-bg",
    "--design-editor-panel-bg",
  ],
  "--workbench-activitybar-fg": ["--muted-foreground"],

  // Tab strip.
  "--workbench-tabbar-bg": ["--design-editor-control-bg", "--muted"],
  "--workbench-tab-active-bg": ["--design-editor-panel-bg", "--background"],
  "--workbench-tab-active-fg": ["--foreground"],
  "--workbench-tab-inactive-bg": ["--design-editor-control-bg", "--muted"],
  "--workbench-tab-inactive-fg": ["--muted-foreground"],
  "--workbench-tab-border": ["--design-editor-control-border", "--border"],

  // Breadcrumbs.
  "--workbench-breadcrumb-fg": ["--muted-foreground"],

  // Status bar.
  "--workbench-statusbar-bg": ["--design-editor-control-bg", "--muted"],
  "--workbench-statusbar-fg": ["--muted-foreground"],

  // List rows (explorer tree, search results, suggest widget).
  "--workbench-list-hover-bg": [
    "--design-editor-layer-hover-color",
    "--accent",
  ],
  "--workbench-list-active-bg": [
    "--design-editor-active-row-color",
    "--accent",
  ],
  "--workbench-list-selection-bg": [
    "--design-editor-selection-color",
    "--accent",
  ],

  // Inputs (search box, quick input, rename inline input).
  "--workbench-input-bg": ["--design-editor-control-bg", "--background"],
  "--workbench-input-border": ["--design-editor-control-border", "--border"],
  "--workbench-input-fg": ["--foreground"],

  // Quick input overlay + badges.
  "--workbench-quickinput-bg": ["--design-editor-panel-bg", "--popover"],
  "--workbench-badge-bg": ["--design-editor-accent-color", "--primary"],
  "--workbench-badge-fg": ["--primary-foreground"],

  // Search match highlight.
  "--workbench-search-match-bg": [
    "--design-editor-selection-color",
    "--accent",
  ],
};

/**
 * Error/warning colors are color-scheme aware literals (not sourced from an
 * app design token) since the app doesn't define semantic red/amber tokens.
 * Kept modest saturation to match the "clean Figma" palette.
 */
const WORKBENCH_STATUS_COLORS: Record<
  "light" | "dark",
  { error: string; warning: string }
> = {
  light: { error: "hsl(0 72% 51%)", warning: "hsl(38 92% 42%)" },
  dark: { error: "hsl(0 72% 62%)", warning: "hsl(38 92% 58%)" },
};

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizeHexColor(value: string): string {
  const hex = value.toLowerCase();
  if (hex.length !== 4 && hex.length !== 5) return hex;
  const [, r, g, b, a] = hex;
  return `#${r}${r}${g}${g}${b}${b}${a ? `${a}${a}` : ""}`;
}

function parseRgbChannel(value: string): number | undefined {
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%")
    ? (Number.parseFloat(trimmed.slice(0, -1)) * 255) / 100
    : Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(255, Math.max(0, Math.round(parsed)));
}

function parseRgbAlpha(value: string | undefined): number {
  if (!value) return 255;
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%")
    ? Number.parseFloat(trimmed.slice(0, -1)) / 100
    : Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return 255;
  return Math.min(255, Math.max(0, Math.round(parsed * 255)));
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function parseRgbColor(value: string): string | undefined {
  const match = /^rgba?\((.*)\)$/i.exec(value.trim());
  if (!match) return undefined;
  const body = match[1]?.trim();
  if (!body) return undefined;
  const parts = body.includes(",")
    ? body.split(",").map((part) => part.trim())
    : body.replace(/\//g, " / ").split(/\s+/).filter(Boolean);
  const slashIndex = parts.indexOf("/");
  const colorParts = slashIndex === -1 ? parts : parts.slice(0, slashIndex);
  const alphaPart =
    slashIndex === -1 ? colorParts[3] : parts.slice(slashIndex + 1).join(" ");
  if (colorParts.length < 3) return undefined;
  const red = parseRgbChannel(colorParts[0] ?? "");
  const green = parseRgbChannel(colorParts[1] ?? "");
  const blue = parseRgbChannel(colorParts[2] ?? "");
  if (red === undefined || green === undefined || blue === undefined) {
    return undefined;
  }
  const alpha = parseRgbAlpha(alphaPart);
  const hex = `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
  return alpha < 255 ? `${hex}${toHexByte(alpha)}` : hex;
}

export function normalizeThemeColorValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?%/.test(trimmed)) {
    return `hsl(${trimmed})`;
  }
  return trimmed;
}

export function normalizeMonacoThemeColor(
  value: string | undefined,
): string | undefined {
  const normalized = normalizeThemeColorValue(value ?? "");
  if (!normalized) return undefined;
  if (HEX_COLOR_RE.test(normalized)) return normalizeHexColor(normalized);
  return parseRgbColor(normalized);
}

export function resolveCssColorValue(value: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return value;
  }
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.position = "fixed";
  probe.style.pointerEvents = "none";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}

function readThemeVar(
  elementStyles: CSSStyleDeclaration,
  rootStyles: CSSStyleDeclaration,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value =
      elementStyles.getPropertyValue(name) || rootStyles.getPropertyValue(name);
    const normalized = normalizeThemeColorValue(value);
    if (normalized) return resolveCssColorValue(normalized);
  }
  return undefined;
}

export function readCodeWorkbenchTheme(
  element: HTMLElement | null,
): CodeWorkbenchTheme {
  if (typeof window === "undefined" || !element) {
    return { colorScheme: "light", values: {} };
  }
  const elementStyles = window.getComputedStyle(element);
  const rootStyles = window.getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};
  for (const [targetVar, sourceVars] of Object.entries(WORKBENCH_THEME_VARS)) {
    const value = readThemeVar(elementStyles, rootStyles, sourceVars);
    if (value) values[targetVar] = value;
  }
  const colorScheme =
    document.documentElement.classList.contains("dark") ||
    elementStyles.colorScheme.includes("dark") ||
    rootStyles.colorScheme.includes("dark")
      ? "dark"
      : "light";
  const statusColors = WORKBENCH_STATUS_COLORS[colorScheme];
  values["--workbench-error"] = resolveCssColorValue(statusColors.error);
  values["--workbench-warning"] = resolveCssColorValue(statusColors.warning);
  return { colorScheme, values };
}
