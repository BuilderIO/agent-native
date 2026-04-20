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
      { label: "Cloneable SaaS", to: "/docs/cloneable-saas" as const },
      { label: "FAQ", to: "/docs/faq" as const },
    ],
  },
  {
    title: "Concepts",
    items: [
      { label: "Drop-in Agent", to: "/docs/drop-in-agent" as const },
      { label: "Workspace", to: "/docs/resources" as const },
      { label: "Context Awareness", to: "/docs/context-awareness" as const },
      { label: "Skills Guide", to: "/docs/skills-guide" as const },
      { label: "Agent Teams", to: "/docs/agent-teams" as const },
      { label: "A2A Protocol", to: "/docs/a2a-protocol" as const },
      { label: "MCP Clients", to: "/docs/mcp-clients" as const },
      { label: "MCP Protocol", to: "/docs/mcp-protocol" as const },
      { label: "Recurring Jobs", to: "/docs/recurring-jobs" as const },
      { label: "Voice Input", to: "/docs/voice-input" as const },
      {
        label: "Real-Time Collaboration",
        to: "/docs/real-time-collaboration" as const,
      },
      { label: "Agent Mentions", to: "/docs/agent-mentions" as const },
      { label: "Pure-Agent Apps", to: "/docs/pure-agent-apps" as const },
      { label: "Integrations", to: "/docs/integrations" as const },
    ],
  },
  {
    title: "Architecture",
    items: [
      { label: "Authentication", to: "/docs/authentication" as const },
      { label: "Security & Data Scoping", to: "/docs/security" as const },
      { label: "Server", to: "/docs/server" as const },
      { label: "Client", to: "/docs/client" as const },
      { label: "Actions", to: "/docs/actions" as const },
      {
        label: "Enterprise Workspace",
        to: "/docs/enterprise-workspace" as const,
      },
      { label: "Deployment", to: "/docs/deployment" as const },
    ],
  },
  {
    title: "Advanced",
    items: [
      { label: "CLI Adapters", to: "/docs/cli-adapters" as const },
      { label: "Frames", to: "/docs/frames" as const },
      { label: "Creating Templates", to: "/docs/creating-templates" as const },
    ],
  },
  {
    title: "Templates",
    items: [
      { label: "Mail", to: "/docs/template-mail" as const },
      { label: "Calendar", to: "/docs/template-calendar" as const },
      { label: "Content", to: "/docs/template-content" as const },
      { label: "Slides", to: "/docs/template-slides" as const },
      { label: "Video", to: "/docs/template-video" as const },
      { label: "Analytics", to: "/docs/template-analytics" as const },
    ],
  },
];

// Flat list for prev/next navigation and current-item lookups
export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
