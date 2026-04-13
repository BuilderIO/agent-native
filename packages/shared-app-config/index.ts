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

export const DEFAULT_APPS: AppConfig[] = [
  {
    id: "mail",
    name: "Mail",
    icon: "Mail",
    description: "Email client",
    url: "https://mail.agent-native.com",
    devPort: 8085,
    devUrl: "http://localhost:8085",
    color: "#3B82F6",
    colorRgb: "59 130 246",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "calendar",
    name: "Calendar",
    icon: "CalendarDays",
    description: "Google Calendar integration",
    url: "https://calendar.agent-native.com",
    devPort: 8082,
    devUrl: "http://localhost:8082",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "content",
    name: "Content",
    icon: "FileText",
    description: "Notion-like content workspace",
    url: "https://content.agent-native.com",
    devPort: 8083,
    devUrl: "http://localhost:8083",
    color: "#10B981",
    colorRgb: "16 185 129",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "analytics",
    name: "Analytics",
    icon: "BarChart2",
    description: "Analytics dashboard",
    url: "https://analytics.agent-native.com",
    devPort: 8088,
    devUrl: "http://localhost:8088",
    color: "#F59E0B",
    colorRgb: "245 158 11",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "slides",
    name: "Slides",
    icon: "GalleryHorizontal",
    description: "AI slide deck creator",
    url: "https://slides.agent-native.com",
    devPort: 8086,
    devUrl: "http://localhost:8086",
    color: "#EC4899",
    colorRgb: "236 72 153",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "videos",
    name: "Videos",
    icon: "Video",
    description: "AI video creator",
    url: "https://videos.agent-native.com",
    devPort: 8087,
    devUrl: "http://localhost:8087",
    color: "#EF4444",
    colorRgb: "239 68 68",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "issues",
    name: "Issues",
    icon: "BrandJira",
    description: "Jira project tracker",
    url: "https://issues.agent-native.com",
    devPort: 8091,
    devUrl: "http://localhost:8091",
    color: "#6366F1",
    colorRgb: "99 102 241",
    isBuiltIn: true,
    enabled: true,
    mode: "dev",
  },
  {
    id: "forms",
    name: "Forms",
    icon: "ClipboardList",
    description: "Form builder",
    url: "https://forms.agent-native.com",
    devPort: 8084,
    devUrl: "http://localhost:8084",
    color: "#06B6D4",
    colorRgb: "6 182 212",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "recruiting",
    name: "Recruiting",
    icon: "Users",
    description: "AI-powered Greenhouse recruiting",
    url: "https://recruiting.agent-native.com",
    devPort: 8090,
    devUrl: "http://localhost:8090",
    color: "#16A34A",
    colorRgb: "22 163 74",
    isBuiltIn: true,
    enabled: true,
    mode: "dev",
  },
  {
    id: "starter",
    name: "Starter",
    icon: "Code",
    description: "Blank starter template",
    url: "",
    devPort: 8089,
    devUrl: "http://localhost:8089",
    color: "#71717A",
    colorRgb: "113 113 122",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  },
  {
    id: "dispatcher",
    name: "Dispatcher",
    icon: "MessageCircle",
    description: "Central messaging router and agent dispatcher",
    url: "",
    devPort: 8092,
    devUrl: "http://localhost:8092",
    color: "#14B8A6",
    colorRgb: "20 184 166",
    isBuiltIn: true,
    enabled: true,
    mode: "dev",
  },
];

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
