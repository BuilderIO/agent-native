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
      { label: "FAQ", to: "/docs/faq" as const },
    ],
  },
  {
    title: "Concepts",
    items: [
      { label: "Context Awareness", to: "/docs/context-awareness" as const },
      { label: "Skills Guide", to: "/docs/skills-guide" as const },
      { label: "A2A Protocol", to: "/docs/a2a-protocol" as const },
      { label: "MCP Protocol", to: "/docs/mcp-protocol" as const },
      {
        label: "Real-Time Collaboration",
        to: "/docs/real-time-collaboration" as const,
      },
      { label: "Agent Mentions", to: "/docs/agent-mentions" as const },
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
      { label: "Resources & Skills", to: "/docs/resources" as const },
      { label: "Actions", to: "/docs/actions" as const },
    ],
  },
  {
    title: "Advanced",
    items: [
      { label: "CLI Adapters", to: "/docs/cli-adapters" as const },
      { label: "Deployment", to: "/docs/deployment" as const },
      { label: "Frames", to: "/docs/frames" as const },
      { label: "Creating Templates", to: "/docs/creating-templates" as const },
    ],
  },
];

// Flat list for prev/next navigation and current-item lookups
export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
