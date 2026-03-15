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

/**
 * Port assignments match dev-all.ts: alphabetical sort of templates
 * with package.json, starting at 8081.
 *
 *   analytics=8081 calendar=8082 content=8083 imagegen=8084
 *   mail=8085 slides=8086 videos=8087
 */
export const APP_REGISTRY: AppDefinition[] = [
  {
    id: "mail",
    name: "Mail",
    icon: "Mail",
    description: "Email client",
    devPort: 8085,
    color: "#3B82F6",
    colorRgb: "59 130 246",
  },
  {
    id: "calendar",
    name: "Calendar",
    icon: "CalendarDays",
    description: "Google Calendar integration",
    devPort: 8082,
    color: "#8B5CF6",
    colorRgb: "139 92 246",
  },
  {
    id: "content",
    name: "Content",
    icon: "FileText",
    description: "Notion-like content workspace",
    devPort: 8083,
    color: "#10B981",
    colorRgb: "16 185 129",
  },
  {
    id: "analytics",
    name: "Analytics",
    icon: "BarChart2",
    description: "Analytics dashboard",
    devPort: 8081,
    color: "#F59E0B",
    colorRgb: "245 158 11",
  },
  {
    id: "slides",
    name: "Slides",
    icon: "GalleryHorizontal",
    description: "AI slide deck creator",
    devPort: 8086,
    color: "#EC4899",
    colorRgb: "236 72 153",
  },
  {
    id: "videos",
    name: "Videos",
    icon: "Video",
    description: "AI video creator",
    devPort: 8087,
    color: "#EF4444",
    colorRgb: "239 68 68",
  },
  {
    id: "imagegen",
    name: "ImageGen",
    icon: "Image",
    description: "AI image generator",
    devPort: 8084,
    color: "#06B6D4",
    colorRgb: "6 182 212",
  },
];

/** Harness UI port — must match dev-all.ts UI_PORT */
export const HARNESS_PORT = 3334;

/** Returns the harness URL for the given app (terminal + iframe) */
export function getAppUrl(app: AppDefinition): string {
  return `http://localhost:${HARNESS_PORT}?app=${app.id}`;
}

export function getAppById(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find((a) => a.id === id);
}
