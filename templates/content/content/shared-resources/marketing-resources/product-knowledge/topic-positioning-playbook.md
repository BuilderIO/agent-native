# Topic Positioning Playbook

Extended positioning examples organized by topic category and content type. Each entry shows the content type, selected capability, target persona, integration pattern, and a sample paragraph demonstrating how Builder.io was mentioned.

**Status:** Living document. After each successful project, the marketing-compound skill can append a new positioning example here.

---

## React/Next.js/Frameworks

**Content type:** Blog post / technical landing page
**Capability:** Visual development + design system intelligence
**Persona:** Developer
**Integration pattern:** Code-First Showcase

> You've got the data layer wired up. Now your PM wants to tweak the card layout and your designer wants to adjust spacing on the metric tiles. Instead of fielding Slack messages and copy-pasting feedback to an agent, Builder.io lets them propose changes directly in the branch. They see the real Next.js components in a visual canvas, make edits, and send you validated code. You review the diff, not a screenshot in Figma.

---

## Design-to-Code / Figma

**Content type:** Marketing landing page
**Capability:** Figma integration + design system intelligence
**Persona:** Designer
**Integration pattern:** Before/After

> Before: Export from Figma. Open VS Code side-by-side. Spend 45 minutes recreating what's already been designed, then file redlines when the dev gets the spacing wrong.
>
> After: Copy-paste the Figma frame into Builder.io. It maps your Figma components to your codebase components -- your actual Button with your design tokens, not a generated look-alike. The output goes directly to a PR. No redlines. No waiting. What you designed is what goes to production.

---

## AI Development Tools

**Content type:** Comparison page / battle card
**Capability:** Massively parallel agents + collaborative workspace
**Persona:** Developer
**Integration pattern:** Honest Comparison

> Most AI coding tools optimize for one developer writing code faster -- you prompt, it generates, you wait. Builder.io takes a different approach: you spin up 20+ agents in parallel, each in its own cloud container with a browser preview and full dev environment. While agents work, your PM verifies the UI changes directly in the branch and your designer fine-tunes the responsive behavior. You get back fully-validated PRs, not raw code output that still needs manual QA.

---

## CI/CD / DevOps / PRs

**Content type:** Case study
**Capability:** Git integration + auto-PR + review response
**Persona:** Engineering Leader
**Integration pattern:** Before/After

> The typical cycle: designer hands off specs, developer builds, PM reviews staging, designer spots issues, developer fixes, repeat. Each round adds 1-2 days. Builder.io compresses this -- assign a Jira ticket to the bot, it reads acceptance criteria, creates a branch, implements, and opens a PR. When someone leaves a review comment, the bot responds and pushes a fix. When CI fails, it reads the output and patches the issue. The first PR is already closer to done because the team validated it collaboratively before you even opened the diff.

---

## Design Systems

**Content type:** Blog post / product page
**Capability:** Design system intelligence + component mapping
**Persona:** Design System Leader
**Integration pattern:** Code-First Showcase

> The promise of design systems is velocity plus consistency. The reality is teams don't adopt, adopt wrong, or quietly drift from the spec. Builder.io's design system intelligence indexes your codebase components, understands your tokens and spacing conventions, and enforces them by default. When anyone on the team builds with Builder, the AI reaches for your actual Button variant -- not a generated approximation. Adherence becomes the path of least resistance instead of a code review battle.

---

## Team Collaboration / DX

**Content type:** Marketing email (nurture sequence)
**Capability:** Collaborative workspace + full-team workflows
**Persona:** PM
**Integration pattern:** Before/After

> Before: PM writes a PRD. Designer interprets it in Figma. Developer interprets the Figma in VS Code. Three people, three interpretations, each losing fidelity. Every change request goes through the developer -- a bottleneck disguised as a workflow.
>
> After: PM describes the feature in Slack, tags @Builder.io. An agent creates a branch with a live preview. The designer refines the visual details directly in the branch. QA verifies. The developer gets a PR with fully-validated, production-grade code. They review architecture and merge -- no manual QA, no design redlines, no copy-pasting feedback.

---

## Parallel Development / Productivity

**Content type:** Social media series
**Capability:** Massively parallel agents + cloud containers
**Persona:** Developer
**Integration pattern:** Before/After

> Before: You prompt one agent, wait, scroll your phone. When it finishes, you QA the output, context-switch, prompt the next thing. You could run agents in background terminals, but then you're juggling git worktrees that can't preview in browser and your machine is melting from running multiple dev servers.
>
> After: Builder.io runs each agent in its own cloud container -- remote CPU, remote memory, full browser preview. You batch-assign 10 tasks, watch progress in a Kanban view, and review PRs as they land. No foreground-vs-background tradeoff. Your local machine stays free for architecture decisions, not compilation.

---

## MCP / AI Integrations

**Content type:** Technical landing page
**Capability:** MCP server ecosystem
**Persona:** Developer
**Integration pattern:** Product Showcase

> Builder.io ships with MCP servers for Neon, Supabase, Linear, Stripe, Sentry, Netlify, Notion, and Zapier out of the box. Your agents can query production databases, create project management tickets, trigger deployments, and connect to hundreds of services through Zapier -- all without custom integration code. Enterprise teams add their own MCP servers for proprietary internal tools. The agent doesn't just write code; it operates across your entire stack.

---

## Marketing / Demand Gen

**Content type:** Campaign landing page
**Capability:** Collaborative workspace + speed to market
**Persona:** Demand Gen Manager
**Integration pattern:** Problem-Solution

> Your next campaign launch is in two weeks. The landing page needs a hero section, three feature blocks, a testimonial carousel, and a pricing comparison. The old way: file a dev ticket, wait in the sprint queue, get the page three days before launch with no time for iteration. With Builder.io, your team builds the page directly -- designers propose the layout, marketers adjust copy in real-time, and the dev reviews a single PR. You launch on time with three rounds of iteration, not zero.

---

## Sales Enablement

**Content type:** Sales outreach email
**Capability:** Enterprise features + collaborative workspace
**Persona:** Account Executive
**Integration pattern:** Problem-Solution

> Hi [Name], I noticed [Company] is evaluating AI development tools. Most tools your team will see optimize for individual developer productivity. Builder.io is different -- it's a collaborative workspace where your entire engineering team runs 20+ agents in parallel, and your designers, PMs, and QA contribute directly to the code. The result: [Company]-scale teams ship 4x faster without adding headcount. Worth a 15-minute demo?

---

## Enterprise / Security

**Content type:** Battle card section
**Capability:** Enterprise features + compliance
**Persona:** Sales Engineer
**Integration pattern:** Honest Comparison

> When the CTO asks about security: Builder.io offers granular file-level permissions with glob patterns, role-based access control per project, selective editing capabilities (frontend teams can't touch backend code), custom Docker images, and self-hosted deployment for compliance-sensitive environments. Unlike tools that run everything through a third-party cloud, Builder.io gives IT full control over where code lives and who can access it.

---

## Customer Success Stories

**Content type:** Case study template
**Capability:** All (varies by customer)
**Persona:** Engineering Leader
**Integration pattern:** Social Proof

> **Everlane** (4x faster product launches):
> "We went from three-week launch cycles to shipping in days. Designers propose changes directly in the branch, PMs verify in real-time previews, and engineers focus on architecture instead of pixel-pushing."
>
> **J.Crew** (100% faster homepage content creation):
> "Our marketing team updates the homepage without filing dev tickets. Builder.io's visual canvas connects to our actual codebase, so every change is production-grade."
