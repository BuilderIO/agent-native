import { TEMPLATES, visibleTemplates } from "./templates";
export {
  TEMPLATES,
  visibleTemplates,
  getTemplate,
  allTemplateNames,
} from "./templates";
export type { TemplateMeta } from "./templates";

export interface AppDefinition {
  id: string;
  name: string;
  /** Lucide icon component name */
  icon: string;
  description: string;
  /** Dev server port (used in development mode) */
  devPort: number;
  /** Accent color for the sidebar indicator */
  color: string;
  /** CSS-safe RGB triplet for color-mix usage, e.g. "124 106 247" */
  colorRgb: string;
  /** Whether this app is a placeholder (no real server yet) */
  placeholder?: boolean;
}

/** User-configured app entry (persisted on-device) */
export interface AppConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** The production URL this app is deployed at */
  url: string;
  /** Dev server port (for local development) */
  devPort: number;
  /** Optional dev server URL override */
  devUrl?: string;
  /** Optional shell command to start the dev server */
  devCommand?: string;
  /** Accent color */
  color: string;
  colorRgb: string;
  /** Whether this is a built-in default app */
  isBuiltIn: boolean;
  /** Whether the app is enabled/visible */
  enabled: boolean;
  /** Whether to load the dev or production URL. Default: "prod" */
  mode?: "dev" | "prod";
}

/** Frame UI port */
export const FRAME_PORT = 3334;

/** Settings for the local dev frame (persisted by the desktop app) */
export interface FrameSettings {
  /** Whether the frame is enabled */
  enabled: boolean;
  /** Load frame from localhost (dev) or production URL (prod) */
  mode: "dev" | "prod";
  /** Production URL for the frame (if deployed) */
  prodUrl?: string;
}

/**
 * Default apps derived from the template registry. One entry per visible
 * template — hidden templates (like `macros`) are excluded.
 */
export const DEFAULT_APPS: AppConfig[] = visibleTemplates().map((t) => ({
  id: t.name,
  name: t.label,
  icon: t.icon,
  description: t.description ?? t.hint,
  url: t.prodUrl ?? "",
  devPort: t.devPort,
  devUrl: `http://localhost:${t.devPort}`,
  color: t.color,
  colorRgb: t.colorRgb,
  isBuiltIn: true,
  enabled: true,
  mode: t.defaultMode ?? "prod",
}));

/**
 * Convert an AppConfig to AppDefinition (for backward compatibility
 * with desktop app code that expects the old shape).
 */
export function toAppDefinition(config: AppConfig): AppDefinition {
  return {
    id: config.id,
    name: config.name,
    icon: config.icon,
    description: config.description,
    devPort: config.devPort,
    color: config.color,
    colorRgb: config.colorRgb,
  };
}

/** Generate a unique ID for user-added apps */
export function generateAppId(): string {
  return `custom-${Date.now().toString(36)}`;
}

/** Returns the frame URL for the given app (terminal + iframe) */
export function getAppUrl(app: AppDefinition | AppConfig): string {
  return `http://localhost:${FRAME_PORT}?app=${app.id}`;
}

export function getAppById(
  id: string,
  apps: (AppDefinition | AppConfig)[] = DEFAULT_APPS,
): AppDefinition | AppConfig | undefined {
  return apps.find((a) => a.id === id);
}

/**
 * The original APP_REGISTRY for backward compatibility.
 * Desktop app code that imports APP_REGISTRY will still work.
 */
export const APP_REGISTRY: AppDefinition[] = DEFAULT_APPS.map(toAppDefinition);
