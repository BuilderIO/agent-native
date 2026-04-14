/**
 * Single source of truth for first-party template metadata.
 *
 * Consumed by:
 *   - `agent-native create` CLI picker
 *   - `agent-native add-app` CLI picker
 *   - Desktop app "Add app" picker
 *   - Workspace scaffolding (for dev port assignment, default paths, etc.)
 *
 * Adding a new first-party template? Add its entry here and it will appear
 * in every picker automatically.
 */

export interface TemplateMeta {
  /** Directory name under templates/ and package name */
  name: string;
  /** Display name in pickers */
  label: string;
  /** One-line description shown in the picker */
  hint: string;
  /** Longer description (optional) */
  description?: string;
  /** Tabler icon name used in the desktop sidebar */
  icon: string;
  /** Hex accent color */
  color: string;
  /** CSS-safe RGB triplet (e.g. "59 130 246") */
  colorRgb: string;
  /** Dev server port for desktop `pnpm dev` */
  devPort: number;
  /** Production URL when running as a first-party app on agent-native.com */
  prodUrl?: string;
  /** Default URL path when deployed in a workspace (defaults to "/<name>") */
  prodPath?: string;
  /** Default mode when added to desktop app */
  defaultMode?: "dev" | "prod";
  /** Hide from pickers but still scaffoldable via explicit --template */
  hidden?: boolean;
  /** Always scaffold without prompting (e.g. starter as fallback) */
  alwaysAvailable?: boolean;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    name: "mail",
    label: "Mail",
    hint: "AI-native Superhuman — email client with keyboard shortcuts and AI triage",
    icon: "Mail",
    color: "#3B82F6",
    colorRgb: "59 130 246",
    devPort: 8085,
    prodUrl: "https://mail.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "calendar",
    label: "Calendar",
    hint: "AI-native Google Calendar — manage events, sync, and public booking",
    icon: "CalendarDays",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    devPort: 8082,
    prodUrl: "https://calendar.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "content",
    label: "Content",
    hint: "AI-native Notion/Google Docs — write and organize with agent assistance",
    icon: "FileText",
    color: "#10B981",
    colorRgb: "16 185 129",
    devPort: 8083,
    prodUrl: "https://content.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "slides",
    label: "Slides",
    hint: "AI-native Google Slides — generate and edit React presentations",
    icon: "GalleryHorizontal",
    color: "#EC4899",
    colorRgb: "236 72 153",
    devPort: 8086,
    prodUrl: "https://slides.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "videos",
    label: "Video",
    hint: "AI-native video editing with Remotion",
    icon: "Video",
    color: "#EF4444",
    colorRgb: "239 68 68",
    devPort: 8087,
    prodUrl: "https://videos.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "analytics",
    label: "Analytics",
    hint: "AI-native Amplitude/Mixpanel — connect data sources, prompt for charts",
    icon: "BarChart2",
    color: "#F59E0B",
    colorRgb: "245 158 11",
    devPort: 8088,
    prodUrl: "https://analytics.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "dispatch",
    label: "Dispatch",
    hint: "Central Slack/Telegram router with jobs, memory, approvals, and A2A delegation",
    icon: "MessageCircle",
    color: "#14B8A6",
    colorRgb: "20 184 166",
    devPort: 8092,
    defaultMode: "dev",
  },
  {
    name: "forms",
    label: "Forms",
    hint: "AI-native form builder — create, edit, and manage forms",
    icon: "ClipboardList",
    color: "#06B6D4",
    colorRgb: "6 182 212",
    devPort: 8084,
    prodUrl: "https://forms.agent-native.com",
    defaultMode: "prod",
  },
  {
    name: "issues",
    label: "Issues",
    hint: "AI-native Jira — project management and issue tracking",
    icon: "BrandJira",
    color: "#6366F1",
    colorRgb: "99 102 241",
    devPort: 8091,
    prodUrl: "https://issues.agent-native.com",
    defaultMode: "dev",
  },
  {
    name: "recruiting",
    label: "Recruiting",
    hint: "AI-native Greenhouse — manage candidates and recruiting pipelines",
    icon: "Users",
    color: "#16A34A",
    colorRgb: "22 163 74",
    devPort: 8090,
    prodUrl: "https://recruiting.agent-native.com",
    defaultMode: "dev",
  },
  {
    name: "starter",
    label: "Starter",
    hint: "Minimal scaffold with the agent chat and core architecture wired up",
    icon: "Code",
    color: "#71717A",
    colorRgb: "113 113 122",
    devPort: 8089,
    defaultMode: "prod",
    alwaysAvailable: true,
  },
  {
    name: "macros",
    label: "Macros",
    hint: "Internal template — not shown in pickers",
    icon: "Code",
    color: "#71717A",
    colorRgb: "113 113 122",
    devPort: 8093,
    hidden: true,
    defaultMode: "dev",
  },
];

/** Return templates visible in user-facing pickers (excludes hidden). */
export function visibleTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => !t.hidden);
}

/** Lookup by name. Returns undefined for unknown names. */
export function getTemplate(name: string): TemplateMeta | undefined {
  // Tolerate the legacy "video" alias.
  if (name === "video") name = "videos";
  return TEMPLATES.find((t) => t.name === name);
}

/** Names of all templates (including hidden) for validation. */
export function allTemplateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}
