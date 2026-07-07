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
  /**
   * Internal icon-alias key (NOT a raw @tabler/icons-react export name).
   * Resolved to a Tabler icon by the ICON_MAP in
   * packages/desktop-app/src/renderer/components/Sidebar.tsx (and the parallel
   * maps in packages/core/src/client/org/OrgSwitcher.tsx and the mobile
   * AppCard). Unmapped keys fall back to a generic icon (IconStack2), so when
   * adding a template you must add a mapping in those ICON_MAP(s) too.
   */
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
  /** Include as a built-in connected A2A agent even when hidden from pickers */
  defaultAgent?: boolean;
  /** Always scaffold without prompting (e.g. chat as fallback) */
  alwaysAvailable?: boolean;
  /** Internal workspace packages this template depends on (e.g. "scheduling") */
  requiredPackages?: string[];
  /** Core app — included in eager repo dev, desktop, and mobile by default */
  core?: boolean;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    name: "calendar",
    label: "Calendar",
    hint: "Agent-native Google Calendar — manage events, sync, and public booking",
    icon: "CalendarDays",
    color: "#00B5FF",
    colorRgb: "0 181 255",
    devPort: 8082,
    prodUrl: "https://calendar.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["scheduling"],
    core: true,
  },
  {
    name: "content",
    label: "Content",
    hint: "Open-source Obsidian for MDX — edit local docs with agent assistance",
    icon: "FileText",
    color: "#10B981",
    colorRgb: "16 185 129",
    devPort: 8083,
    prodUrl: "https://content.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "plan",
    label: "Plan",
    hint: "Structured visual plans and PR recaps with diagrams, wireframes, prototypes, annotations, and sharing",
    icon: "LayoutBoard",
    color: "#52525B",
    colorRgb: "82 82 91",
    devPort: 8105,
    prodUrl: "https://plan.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "slides",
    label: "Slides",
    hint: "Agent-native Google Slides — generate and edit React presentations",
    icon: "GalleryHorizontal",
    color: "#EC4899",
    colorRgb: "236 72 153",
    devPort: 8086,
    prodUrl: "https://slides.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["pinpoint"],
    core: true,
  },
  {
    name: "clips",
    label: "Clips",
    hint: "Screen recording, meeting notes, and voice dictation — all with AI",
    icon: "ScreenShare",
    color: "#0EA5E9",
    colorRgb: "14 165 233",
    devPort: 8094,
    prodUrl: "https://clips.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "brain",
    label: "Brain",
    hint: "Cited company knowledge from Slack, meetings, transcripts, and decisions",
    icon: "Brain",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    devPort: 8102,
    prodUrl: "https://brain.agent-native.com",
    defaultMode: "prod",
    defaultAgent: true,
    core: true,
  },
  {
    name: "analytics",
    label: "Analytics",
    hint: "Agent-native Amplitude/Mixpanel — connect data sources, prompt for charts",
    icon: "BarChart2",
    color: "#F59E0B",
    colorRgb: "245 158 11",
    devPort: 8088,
    prodUrl: "https://analytics.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "mail",
    label: "Mail",
    hint: "Agent-native Superhuman — email client with keyboard shortcuts and AI triage",
    icon: "Mail",
    color: "#3B82F6",
    colorRgb: "59 130 246",
    devPort: 8085,
    prodUrl: "https://mail.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "dispatch",
    label: "Dispatch",
    hint: "Central Slack/Telegram router with jobs, memory, approvals, and A2A delegation",
    icon: "Route",
    color: "#14B8A6",
    colorRgb: "20 184 166",
    devPort: 8092,
    prodUrl: "https://dispatch.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "forms",
    label: "Forms",
    hint: "Agent-native form builder — create, edit, and manage forms",
    icon: "ClipboardList",
    color: "#06B6D4",
    colorRgb: "6 182 212",
    devPort: 8084,
    prodUrl: "https://forms.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "design",
    label: "Design",
    hint: "Agent-native design tool — create and edit visual designs with agent assistance",
    icon: "Brush",
    color: "#F472B6",
    colorRgb: "244 114 182",
    devPort: 8099,
    prodUrl: "https://design.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["pinpoint", "embedding"],
    core: true,
  },
  {
    name: "assets",
    label: "Assets",
    hint: "Digital asset manager — upload, organize, search, and generate on-brand images and videos",
    icon: "Photo",
    color: "#0F766E",
    colorRgb: "15 118 110",
    devPort: 8100,
    prodUrl: "https://assets.agent-native.com",
    defaultMode: "prod",
    defaultAgent: true,
    requiredPackages: ["embedding"],
    core: true,
  },
  {
    name: "chat",
    label: "Chat",
    hint: "Minimal chat-first app with durable threads, actions, and the app-agent loop",
    icon: "MessageCircle",
    color: "#18181B",
    colorRgb: "24 24 27",
    devPort: 8089,
    prodUrl: "https://chat.agent-native.com",
    defaultMode: "prod",
    alwaysAvailable: true,
    core: true,
  },
  {
    name: "macros",
    label: "Macros",
    hint: "Internal template — not shown in pickers",
    icon: "Code",
    color: "#71717A",
    colorRgb: "113 113 122",
    devPort: 8093,
    prodUrl: "https://macros.agent-native.com",
    hidden: true,
    defaultMode: "dev",
  },
];

/** Return templates visible in user-facing pickers (excludes hidden). */
export function visibleTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => !t.hidden);
}

/** Return core templates — the default set for eager repo dev, desktop, and mobile. */
export function coreTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => t.core);
}

/** Lookup by name. Returns undefined for unknown names. */
export function getTemplate(name: string): TemplateMeta | undefined {
  // Tolerate legacy / renamed aliases.
  if (name === "starter") name = "chat";
  if (name === "image" || name === "images" || name === "asset") {
    name = "assets";
  }
  if (name === "contracts" || name === "visual-plans") name = "plan";
  return TEMPLATES.find((t) => t.name === name);
}

/** Names of all templates (including hidden) for validation. */
export function allTemplateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}
