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

export const APP_REGISTRY: AppDefinition[] = [
  {
    id: "mail",
    name: "Mail",
    icon: "Mail",
    description: "Gmail client",
    devPort: 8081,
    color: "#3B82F6",
    colorRgb: "59 130 246",
    placeholder: true,
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
    devPort: 8084,
    color: "#F59E0B",
    colorRgb: "245 158 11",
  },
  {
    id: "slides",
    name: "Slides",
    icon: "GalleryHorizontal",
    description: "AI slide deck creator",
    devPort: 8085,
    color: "#EC4899",
    colorRgb: "236 72 153",
  },
];

export function getAppUrl(app: AppDefinition): string {
  return `http://localhost:${app.devPort}`;
}

export function getAppById(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find((a) => a.id === id);
}
