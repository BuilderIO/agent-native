export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

interface AgentEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  devUrl?: string;
  devPort: number;
  color: string;
  enabled: boolean;
  placeholder?: boolean;
  mode?: "dev" | "prod";
}

/**
 * Built-in agent registry. Mirrors DEFAULT_APPS from @agent-native/shared-app-config
 * but inlined here to avoid a cross-package dependency that breaks tsc.
 */
const AGENTS: AgentEntry[] = [
  {
    id: "mail",
    name: "Mail",
    description: "Email client",
    url: "https://mail.agent-native.com",
    devUrl: "http://localhost:8085",
    devPort: 8085,
    color: "#3B82F6",
    enabled: true,
    mode: "prod",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Google Calendar integration",
    url: "https://calendar.agent-native.com",
    devUrl: "http://localhost:8082",
    devPort: 8082,
    color: "#8B5CF6",
    enabled: true,
    mode: "prod",
  },
  {
    id: "content",
    name: "Content",
    description: "Notion-like content workspace",
    url: "https://content.agent-native.com",
    devUrl: "http://localhost:8083",
    devPort: 8083,
    color: "#10B981",
    enabled: true,
    mode: "prod",
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Analytics dashboard",
    url: "https://analytics.agent-native.com",
    devUrl: "http://localhost:8088",
    devPort: 8088,
    color: "#F59E0B",
    enabled: true,
    mode: "prod",
  },
  {
    id: "slides",
    name: "Slides",
    description: "AI slide deck creator",
    url: "https://slides.agent-native.com",
    devUrl: "http://localhost:8086",
    devPort: 8086,
    color: "#EC4899",
    enabled: true,
    mode: "prod",
  },
  {
    id: "videos",
    name: "Videos",
    description: "AI video creator",
    url: "https://videos.agent-native.com",
    devUrl: "http://localhost:8087",
    devPort: 8087,
    color: "#EF4444",
    enabled: true,
    mode: "prod",
  },
  {
    id: "issues",
    name: "Issues",
    description: "Jira project tracker",
    url: "https://issues.agent-native.com",
    devUrl: "http://localhost:8091",
    devPort: 8091,
    color: "#6366F1",
    enabled: true,
    mode: "dev",
  },
  {
    id: "forms",
    name: "Forms",
    description: "Form builder",
    url: "https://forms.agent-native.com",
    devUrl: "http://localhost:8084",
    devPort: 8084,
    color: "#06B6D4",
    enabled: true,
    mode: "prod",
  },
  {
    id: "recruiting",
    name: "Recruiting",
    description: "AI-powered recruiting",
    url: "https://recruiting.agent-native.com",
    devUrl: "http://localhost:8090",
    devPort: 8090,
    color: "#16A34A",
    enabled: true,
    mode: "dev",
  },
];

/**
 * Discover peer agents. Returns a static list — no network calls.
 */
export function discoverAgents(selfAppId?: string): DiscoveredAgent[] {
  return AGENTS.filter(
    (app) => app.id !== selfAppId && app.enabled && !app.placeholder && app.url,
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: resolveAgentUrl(app),
    color: app.color,
  }));
}

/**
 * Look up a single agent by ID or name (case-insensitive).
 */
export function findAgent(
  idOrName: string,
  selfAppId?: string,
): DiscoveredAgent | undefined {
  const lower = idOrName.toLowerCase();
  return discoverAgents(selfAppId).find(
    (a) => a.id === lower || a.name.toLowerCase() === lower,
  );
}

function isDevEnvironment(): boolean {
  return (
    typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
  );
}

function resolveAgentUrl(app: AgentEntry): string {
  // In dev environment, always use local URLs regardless of per-app mode.
  // If one app is running locally, they all are.
  if (isDevEnvironment()) {
    return app.devUrl || `http://localhost:${app.devPort}`;
  }
  return app.url;
}
