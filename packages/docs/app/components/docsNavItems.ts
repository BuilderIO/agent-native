export type NavItem = { label: string; to: string };
export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Getting Started", to: "/docs" as const },
      { label: "Core Philosophy", to: "/docs/core-philosophy" as const },
      { label: "Key Concepts", to: "/docs/key-concepts" as const },
    ],
  },
  {
    title: "Concepts",
    items: [
      { label: "Context Awareness", to: "/docs/context-awareness" as const },
      { label: "Skills Guide", to: "/docs/skills-guide" as const },
      { label: "A2A Protocol", to: "/docs/a2a-protocol" as const },
    ],
  },
  {
    title: "Architecture",
    items: [
      { label: "Server", to: "/docs/server" as const },
      { label: "Client", to: "/docs/client" as const },
      { label: "Resources & Skills", to: "/docs/resources" as const },
      { label: "Scripts", to: "/docs/scripts" as const },
      { label: "File Sync", to: "/docs/file-sync" as const },
    ],
  },
  {
    title: "Advanced",
    items: [
      { label: "CLI Adapters", to: "/docs/cli-adapters" as const },
      { label: "Deployment", to: "/docs/deployment" as const },
      { label: "Harnesses", to: "/docs/harnesses" as const },
      { label: "Creating Templates", to: "/docs/creating-templates" as const },
    ],
  },
];

// Flat list for prev/next navigation and current-item lookups
export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
