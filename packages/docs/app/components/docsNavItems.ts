export type NavItem = { label: string; to: string };
export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Getting Started", to: "/docs" as const },
      {
        label: "What Is Agent-Native?",
        to: "/docs/what-is-agent-native" as const,
      },
      { label: "Key Concepts", to: "/docs/key-concepts" as const },
      { label: "Templates", to: "/docs/cloneable-saas" as const },
      { label: "FAQ", to: "/docs/faq" as const },
    ],
  },
  {
    title: "Using Your Agent",
    items: [
      { label: "Context Awareness", to: "/docs/context-awareness" as const },
      { label: "Agent Mentions", to: "/docs/agent-mentions" as const },
      { label: "Voice Input", to: "/docs/voice-input" as const },
      { label: "Drop-in Agent", to: "/docs/drop-in-agent" as const },
      { label: "Pure-Agent Apps", to: "/docs/pure-agent-apps" as const },
      {
        label: "Real-Time Collaboration",
        to: "/docs/real-time-collaboration" as const,
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Workspace Overview", to: "/docs/workspace" as const },
      { label: "Skills", to: "/docs/skills-guide" as const },
      { label: "Custom Agents & Teams", to: "/docs/agent-teams" as const },
      {
        label: "Workspace Governance",
        to: "/docs/workspace-management" as const,
      },
      { label: "Recurring Jobs", to: "/docs/recurring-jobs" as const },
      { label: "Automations", to: "/docs/automations" as const },
      { label: "Extensions", to: "/docs/extensions" as const },
      {
        label: "Multi-App Workspaces",
        to: "/docs/multi-app-workspace" as const,
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Messaging (Slack, Email…)", to: "/docs/messaging" as const },
      { label: "Dispatch", to: "/docs/dispatch" as const },
      { label: "A2A Protocol", to: "/docs/a2a-protocol" as const },
      { label: "MCP Clients", to: "/docs/mcp-clients" as const },
      { label: "MCP Protocol", to: "/docs/mcp-protocol" as const },
      { label: "External Agents", to: "/docs/external-agents" as const },
      { label: "Cross-App SSO", to: "/docs/cross-app-sso" as const },
      { label: "Notifications", to: "/docs/notifications" as const },
      {
        label: "Workspace Connections",
        to: "/docs/workspace-connections" as const,
      },
      { label: "Onboarding & API Keys", to: "/docs/onboarding" as const },
    ],
  },
  {
    title: "Templates",
    // ── DO NOT add new templates here directly. ──
    // The public-facing template list is the strict allow-list in
    // `packages/shared-app-config/templates.ts` (entries with `hidden: false`).
    // To surface a new template in the docs sidebar, first flip its `hidden`
    // flag in that file. The CI guard `scripts/guard-template-list.mjs`
    // enforces this — adding a slug here that isn't in the allow-list will
    // fail the build.
    //
    // Important: this is the docs sidebar, so these links must point to the
    // markdown docs under `/docs/template-<slug>`, never the marketing/demo
    // landing pages under `/templates/<slug>`. The tests and guard script
    // intentionally enforce this because this list has regressed before.
    items: [
      { label: "Calendar", to: "/docs/template-calendar" as const },
      { label: "Content", to: "/docs/template-content" as const },
      { label: "Slides", to: "/docs/template-slides" as const },
      { label: "Video", to: "/docs/template-videos" as const },
      { label: "Analytics", to: "/docs/template-analytics" as const },
      { label: "Mail", to: "/docs/template-mail" as const },
      { label: "Clips", to: "/docs/template-clips" as const },
      { label: "Brain", to: "/docs/template-brain" as const },
      { label: "Assets", to: "/docs/template-assets" as const },
      { label: "Design", to: "/docs/template-design" as const },
      { label: "Dispatch", to: "/docs/template-dispatch" as const },
      { label: "Forms", to: "/docs/template-forms" as const },
    ],
  },
  {
    title: "Architecture",
    items: [
      { label: "Server", to: "/docs/server" as const },
      { label: "Client", to: "/docs/client" as const },
      { label: "Actions", to: "/docs/actions" as const },
      { label: "Agent Web Surfaces", to: "/docs/agent-web-surfaces" as const },
      { label: "Authentication", to: "/docs/authentication" as const },
      { label: "Multi-Tenancy", to: "/docs/multi-tenancy" as const },
      { label: "Security & Data Scoping", to: "/docs/security" as const },
      { label: "Sharing & Privacy", to: "/docs/sharing" as const },
      { label: "Database", to: "/docs/database" as const },
      { label: "File Uploads", to: "/docs/file-uploads" as const },
      { label: "Tracking & Analytics", to: "/docs/tracking" as const },
      { label: "Observability", to: "/docs/observability" as const },
      { label: "Progress Tracking", to: "/docs/progress" as const },
      { label: "Deployment", to: "/docs/deployment" as const },
    ],
  },
  {
    title: "Build & Extend",
    items: [
      { label: "Creating Templates", to: "/docs/creating-templates" as const },
      { label: "Frames", to: "/docs/frames" as const },
      { label: "Embedding SDK", to: "/docs/embedding-sdk" as const },
      {
        label: "/migrate Goal",
        to: "/docs/migration-workbench" as const,
      },
      { label: "Agent-Native Code UI", to: "/docs/code-agents-ui" as const },
      { label: "CLI Adapters", to: "/docs/cli-adapters" as const },
    ],
  },
];

// Flat list for prev/next navigation and current-item lookups
export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
