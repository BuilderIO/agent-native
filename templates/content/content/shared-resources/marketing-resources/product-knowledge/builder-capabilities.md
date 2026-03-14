# Builder.io Capabilities Reference

Last updated: 2026-02-18

**Status:** Living document. Update when the product ships new features. Items marked "(coming soon)" are on the roadmap but not yet shipped.

## What Builder.io Is

An Agentic Development Platform -- a collaborative workspace where your whole team (devs, designers, PMs, QA) builds real products together with massively parallel AI agents.

## Massively Parallel Agents

- Run 20+ agents simultaneously, each in its own remote cloud container
- Every agent gets a full end-to-end dev environment: browser preview, code editor, isolated file system
- No local machine resource drain -- compilation and dev servers run in the cloud
- Eliminates git worktree hacks and the inability to preview parallel branches in browser
- Everything runs with the UX of a foreground agent (live browser preview, direct editing) and the benefits of background (auto-generated PRs, check progress from phone)
- Agents create branches, generate preview URLs, open PRs with descriptions automatically

## Collaborative Development Workspace

- Real-time multiplayer -- multiple people editing and reviewing simultaneously
- Everything is shareable with a link (branches, previews, agent progress)
- Kanban visualization of all work: agents in progress, peer review, PR review, merged
- Full team workflow support: assign reviewers, get approvals, track status
- Designers, PMs, and QA can propose changes directly in the branch, verify them, and send fully-validated code to devs
- Devs focus on architecture, performance, and code review -- not manual QA and design feedback

## Stack Integrations

- **Slack**: Tag @Builder.io in any channel to turn a conversation into a feature request with real-time previews
- **Jira**: Assign tickets directly to the Builder bot. Bot reads acceptance criteria, implements, iterates via comments
- **Figma**: Bidirectional sync -- import designs as code, export generated UIs back to Figma
- **Git**: GitHub, GitLab, Azure DevOps, Bitbucket. PR-based workflows where @builder-bot responds to review feedback and fixes build failures
- **VS Code**: Extension providing full Builder capabilities inside the editor
- **CLI**: Multi-repo support for complex architectures

## Design System Intelligence

- Indexes your codebase components and understands your design patterns
- Maps Figma components to your actual codebase components (your Button, not a generated one)
- Enforces design tokens, spacing, and naming conventions
- Prevents pattern drift across the organization
- Design system leaders get a tool that makes adherence the default

## Figma-to-Code (formerly "Visual Copilot")

- Copy-paste Figma designs directly into the codebase
- Combines multiple Figma screens into single components
- Frameworks: React, Vue, Svelte, Angular, Qwik, Solid, React Native, HTML, Marko, Mitosis
- Styling: Plain CSS, Tailwind, Emotion, Styled Components, Styled JSX
- Pixel-perfect responsive output -- no manual tweaks for mobile
- Uses your existing components via design system intelligence (not generated look-alikes)
- No special Figma file preparation required

## Visual Development Canvas

- AI-powered visual canvas for building, editing, and reviewing directly in the browser
- Select elements visually and edit styling, content, and layout with code precision
- UX comparable to tools like Lovable/Replit but connected to your real codebase and team
- All visual edits produce real code backed by git

## MCP Server Integrations

- **Database**: Neon, Supabase (schema-aware feature generation)
- **Project Management**: Linear (fetch and interact with issues)
- **Deployment**: Netlify
- **Monitoring**: Sentry
- **Payments**: Stripe
- **Collaboration**: Notion
- **Automation**: Zapier (reach hundreds of services)
- **Custom**: Enterprise teams can add proprietary MCP servers

## Enterprise Features

- Granular permissions with glob patterns for sensitive code paths
- Role-based access control per project
- Selective editing capabilities (UI vs. backend)
- Custom Docker image support
- Self-hosted and compliance-friendly deployment options
- Desktop app: Mac/Windows, Cloud/Local/Docker deployment

## AI Model Support

- Multi-model: Anthropic, OpenAI, Google
- Not locked to a single provider

## Coming Soon (Roadmap)

- Automated browser testing: agents test their own work end-to-end
- PR review automation: review PRs for code correctness and QA before merge
- Proactive ticket handling: agent volunteers for tickets it can handle
- Context Graph: understanding the "why" behind all team decisions, learning how your team works over time
- Mobile app (iOS/Android) -- currently in private beta

## Key Metrics

- 10M+ designs and PRDs converted to production features
- Everlane: 4x faster product launches, 90% reduction in content update times
- J.Crew: 100% increase in homepage content creation speed

## What Builder.io Is NOT

- NOT a headless CMS (that was "Publish", the legacy product -- do not position Builder.io as a CMS)
- NOT a solo-developer coding assistant (team-oriented, cross-functional by design)
- NOT a prototype generator (generates production code shipped via PRs)
- NOT a new IDE (integrates with existing tools: VS Code, GitHub, Figma, Slack, Jira)
- NOT limited to one AI model (supports Anthropic, OpenAI, Google)
- NOT just another AI code-gen tool (the differentiator is parallel agents + collaborative workspace)
