export interface TemplateMeta {
  name: string;
  label: string;
  hint: string;
  description?: string;
  icon: string;
  color: string;
  colorRgb: string;
  devPort: number;
  prodUrl?: string;
  prodPath?: string;
  defaultMode?: "dev" | "prod";
  hidden?: boolean;
  defaultAgent?: boolean;
  alwaysAvailable?: boolean;
  requiredPackages?: string[];
  core?: boolean;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    name: "calendar",
    label: "Calendar",
    hint: "Agent-Native Google Calendar — manage events, sync, and public booking",
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
    requiredPackages: ["creative-context"],
    core: true,
  },
  {
    name: "plan",
    label: "Plan",
    hint: "Structured visual plans and PR recaps with diagrams, wireframes, prototypes, annotations, and sharing",
    icon: "FileText",
    color: "#2F6FED",
    colorRgb: "47 111 237",
    devPort: 8105,
    prodUrl: "https://plan.agent-native.com",
    defaultMode: "prod",
    core: true,
  },
  {
    name: "slides",
    label: "Slides",
    hint: "Agent-Native Google Slides — generate and edit React presentations",
    icon: "GalleryHorizontal",
    color: "#EC4899",
    colorRgb: "236 72 153",
    devPort: 8086,
    prodUrl: "https://slides.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["creative-context"],
    core: true,
  },
  {
    name: "analytics",
    label: "Analytics",
    hint: "Agent-Native provider analytics - connect data sources, prompt for charts and deep dives",
    icon: "BarChart2",
    color: "#F59E0B",
    colorRgb: "245 158 11",
    devPort: 8088,
    prodUrl: "https://analytics.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["creative-context"],
    core: true,
  },
  {
    name: "mail",
    label: "Mail",
    hint: "Agent-Native Superhuman — email client with keyboard shortcuts and AI triage",
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
    hint: "Agent-Native form builder — create, edit, and manage forms",
    icon: "ClipboardList",
    color: "#06B6D4",
    colorRgb: "6 182 212",
    devPort: 8084,
    prodUrl: "https://forms.agent-native.com",
    defaultMode: "prod",
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
    name: "design",
    label: "Design",
    hint: "Agent-Native design tool — create and edit visual designs with agent assistance",
    icon: "Brush",
    color: "#F472B6",
    colorRgb: "244 114 182",
    devPort: 8099,
    prodUrl: "https://design.agent-native.com",
    defaultMode: "prod",
    requiredPackages: ["embedding", "creative-context"],
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
    requiredPackages: ["embedding", "creative-context"],
    core: true,
  },
  {
    name: "tasks",
    label: "Tasks",
    hint: "Task-list-first workspace — inbox capture, custom fields, and drag-and-drop ordering",
    icon: "ListCheck",
    color: "#6366F1",
    colorRgb: "99 102 241",
    devPort: 8091,
    prodUrl: "https://tasks.agent-native.com",
    defaultMode: "prod",
    hidden: true,
    core: false,
  },
  {
    name: "crm",
    label: "CRM",
    hint: "Agent-Native CRM over native SQL, HubSpot, or Salesforce — typed attributes, lists, pipelines, and evidence-grounded signals",
    icon: "Users",
    color: "#2563EB",
    colorRgb: "37 99 235",
    devPort: 8107,
    prodUrl: "https://crm.agent-native.com",
    hidden: true,
    defaultMode: "dev",
    core: false,
  },
  {
    name: "factory",
    label: "Factory",
    hint: "Build agent factories with gates you control",
    icon: "Users",
    color: "#7C3AED",
    colorRgb: "124 58 237",
    devPort: 8108,
    prodUrl: "https://factory.agent-native.com",
    hidden: true,
    defaultMode: "dev",
    core: false,
  },
];

export function visibleTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => !t.hidden);
}

export function coreTemplates(): TemplateMeta[] {
  return TEMPLATES.filter((t) => t.core);
}

export function getTemplate(name: string): TemplateMeta | undefined {
  if (name === "starter") name = "chat";
  if (name === "image" || name === "images" || name === "asset") {
    name = "assets";
  }
  if (name === "contracts" || name === "visual-plans") name = "plan";
  return TEMPLATES.find((t) => t.name === name);
}

export function allTemplateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}
