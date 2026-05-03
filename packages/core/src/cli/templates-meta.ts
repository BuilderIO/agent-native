/**
 * First-party template metadata used by the `agent-native` CLI.
 *
 * This file is intentionally inlined here (rather than imported from a
 * separate workspace package) so that the published `@agent-native/core`
 * has no `workspace:*` runtime dependencies. Without this inlining, `npx
 * @agent-native/core create ...` fails on a fresh machine with:
 *
 *   npm error code EUNSUPPORTEDPROTOCOL
 *   npm error Unsupported URL Type "workspace:": workspace:*
 *
 * Keep this list in sync with `packages/shared-app-config/templates.ts`,
 * which serves the same metadata to the desktop / mobile / frame packages
 * that always run inside the workspace. Duplication is intentional: the
 * CLI must remain installable outside the monorepo.
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
  /** Internal workspace packages this template depends on (e.g. "scheduling") */
  requiredPackages?: string[];
  /** Core app — featured in the CLI picker, homepage, and docs gallery */
  core?: boolean;
}

export const TEMPLATES: TemplateMeta[] = [
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
    name: "calendar",
    label: "Calendar",
    hint: "Agent-native Google Calendar — manage events, sync, and public booking",
    icon: "CalendarDays",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    devPort: 8082,
    prodUrl: "https://calendar.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["scheduling"],
    core: true,
  },
  {
    name: "content",
    label: "Content",
    hint: "Agent-native Notion/Google Docs — write and organize with agent assistance",
    icon: "FileText",
    color: "#10B981",
    colorRgb: "16 185 129",
    devPort: 8083,
    prodUrl: "https://content.agent-native.com",
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
    core: true,
  },
  {
    name: "videos",
    label: "Video",
    hint: "Agent-native video editing with Remotion",
    icon: "Video",
    color: "#EF4444",
    colorRgb: "239 68 68",
    devPort: 8087,
    prodUrl: "https://videos.agent-native.com",
    defaultMode: "prod",
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
    name: "dispatch",
    label: "Dispatch",
    hint: "Central Slack/Telegram router with jobs, memory, approvals, and A2A delegation",
    icon: "MessageCircle",
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
    name: "issues",
    label: "Issues",
    hint: "Agent-native Jira — project management and issue tracking",
    icon: "BrandJira",
    color: "#6366F1",
    colorRgb: "99 102 241",
    devPort: 8091,
    prodUrl: "https://issues.agent-native.com",
    defaultMode: "dev",
    hidden: true,
  },
  {
    name: "recruiting",
    label: "Recruiting",
    hint: "Agent-native Greenhouse — manage candidates and recruiting pipelines",
    icon: "Users",
    color: "#16A34A",
    colorRgb: "22 163 74",
    devPort: 8090,
    prodUrl: "https://recruiting.agent-native.com",
    defaultMode: "dev",
    hidden: true,
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
    core: true,
    hidden: true,
  },
  {
    name: "clips",
    label: "Clips",
    hint: "Async screen recording — record, transcribe, share",
    icon: "ScreenShare",
    color: "#625DF5",
    colorRgb: "98 93 245",
    devPort: 8094,
    prodUrl: "https://clips.agent-native.com",
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
    core: true,
  },
  {
    name: "calls",
    label: "Calls",
    hint: "Agent-native Gong — record, transcribe, and analyze sales calls",
    icon: "Phone",
    color: "#111111",
    colorRgb: "17 17 17",
    devPort: 8095,
    prodUrl: "https://calls.agent-native.com",
    defaultMode: "prod",
    hidden: true,
  },
  {
    name: "meeting-notes",
    label: "Meeting Notes",
    hint: "AI meeting notes — transcribe, enhance, and share meeting notes",
    icon: "Note",
    color: "#16A34A",
    colorRgb: "22 163 74",
    devPort: 8096,
    prodUrl: "https://meeting-notes.agent-native.com",
    defaultMode: "prod",
    hidden: true,
  },
  {
    name: "scheduling",
    label: "Scheduling",
    hint: "Full scheduling app — event types, team round-robin, routing forms, workflows",
    icon: "CalendarTime",
    color: "#7C3AED",
    colorRgb: "124 58 237",
    devPort: 8098,
    prodUrl: "https://scheduling.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["scheduling"],
    hidden: true,
  },
  {
    name: "voice",
    label: "Voice",
    hint: "Voice dictation — speak to type anywhere with context-aware formatting",
    icon: "Microphone",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    devPort: 8097,
    prodUrl: "https://voice.agent-native.com",
    defaultMode: "prod",
    hidden: true,
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

/** Return core templates — the featured set shown in CLI pickers by default. */
export function coreTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => t.core);
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
