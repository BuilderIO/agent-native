---
name: frontend-design
description: >-
  Create distinctive, production-grade frontend interfaces with high design
  quality. Use when building web components, pages, or applications.
  Generates creative, polished UI that avoids generic AI aesthetics.
---

# Frontend Design

In the agent-native framework context:
- Agent-native apps use React 18, Vite, TailwindCSS, and shadcn/ui
- Custom styles go in component CSS or Tailwind classes — never inline styles
- All new UI components should be placed in `app/components/`
- Always use Tabler Icons (`@tabler/icons-react`) — never Lucide, Heroicons, or inline SVGs
- Always use shadcn/ui components for standard UI patterns

## Related Skills

- **self-modifying-code** — The agent can edit source code to apply design changes
