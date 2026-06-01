---
title: "Design"
description: "An agent-native HTML prototyping studio — generate, refine, preview, and export interactive Alpine/Tailwind designs with an agent."
---

# Design

Design is an agent-native HTML prototyping studio. Instead of a layered drawing canvas, the agent generates complete self-contained Alpine/Tailwind HTML prototypes, renders them in an iframe, and lets you refine the result with prompts and tweak controls.

Use it when you want a polished landing page concept, product UI direction, brand exploration, or interactive prototype that can leave the tool as real HTML.

![Design studio showing generated HTML prototypes and tweak controls](https://cdn.builder.io/api/v1/image/assets%2F348da13fcd8b414c87de9066196f7266%2F961bedb713a94463b834c1f2f4643bcf?format=webp&width=1200)

## Start Here

1. **Describe the artifact.** Ask for the screen, flow, landing page, or visual
   direction you want. Include audience, tone, and any product constraints.
2. **Compare directions.** Generate a few variants, pick the strongest one, and
   keep refining instead of starting over.
3. **Tune the details.** Use tweak controls for common visual changes, or ask
   the agent for layout, copy, responsive, and interaction changes.
4. **Export when it is useful.** Download HTML, ZIP, or PDF once the prototype
   is ready to hand to another tool or teammate.

For Codex, Claude Code, and other local agent clients, the hosted Design app can
be installed as an app-backed skill plus MCP connector:

```bash
npx @agent-native/core@latest skills add design-exploration
```

If you only want the portable skill instructions through the open Skills CLI,
use:

```bash
npx skills add BuilderIO/agent-native --skill design-exploration
```

The Agent Native CLI path gives the agent instructions and MCP tools to create
a design shell, present 2-5 visual directions (3 is the sweet spot) in the
inline Design MCP app, wait for your pick, and iterate from the selected
prototype. See [Using it from your coding agent](#coding-agent) for the full
flow.

## Useful Prompts

- "Create three landing-page directions for a technical analytics product."
- "Make this dashboard denser and easier to scan for an operations team."
- "Apply our saved design system and simplify the mobile layout."
- "Export this prototype as a ZIP once the final variant is selected."
- "Turn this HTML into a stronger pricing page without changing the brand colors."

## What You Can Do With It

- **Generate complete prototypes.** Describe the screen or page you need and the agent creates a working HTML document with Tailwind styling and Alpine interactions.
- **Compare variants.** Start with multiple directions, pick the strongest one, then continue refining.
- **Tweak visually.** Use the built-in tweak controls for common changes, or ask the agent for copy, layout, color, spacing, and interaction updates.
- **Apply design systems.** Save and reuse design-system preferences so generated work stays closer to your brand.
- **Import references.** Bring in existing HTML or reference material as context for a new design pass.
- **Export real files.** Export HTML, ZIP, or PDF from the generated prototype.

## Using It From Your Coding Agent {#coding-agent}

Generate and pick design directions without leaving Codex, Claude Code, Claude, or ChatGPT.

1. **Install once.** This adds the skill instructions and registers the hosted MCP connector together:

   ```bash
   npx @agent-native/core@latest skills add design-exploration   # aliases: design, ux-exploration
   ```

   Default client is `codex`; add `--client claude-code` or `--client all` for
   others. If you only want the portable skill instructions through the open
   Skills CLI, use:

   ```bash
   npx skills add BuilderIO/agent-native --skill design-exploration
   ```

2. **Ask for directions.** In your agent's chat: "Create three landing-page directions for a technical analytics product." The agent generates 2-5 directions (3 is the sweet spot) you can compare side by side.
3. **Pick.** In inline hosts (ChatGPT, Claude.ai, Claude Desktop main chat) the variant grid renders right in the chat — pick a direction and it auto-persists as `index.html`, then keep refining. On CLI/link-only hosts (Codex, Claude Code, Claude Desktop "Code" tab) you get an **"Open in Design →"** link; open it, pick in the browser, then paste the copied handoff summary back into your chat — or just say "I picked direction B".

   ```text
   Paste this back into your chat so your agent continues from the chosen design.

   I picked the "<label>" design direction.
   It's saved as index.html in design <designId>. Refine from here with get-design-snapshot + generate-design, or export-coding-handoff to bring it into code. Don't show new variants unless I ask.

   Design selection context:
   { "selectedDesign": { "designId": "...", "variantId": "...", "label": "...", "file": "index.html" } }
   ```

4. **Apply to code.** Run `export-coding-handoff`; it returns a tokenized raw-code URL plus a ready-to-paste prompt. Your coding agent fetches that URL and writes the code.

## Why It's Interesting

Design is useful because the agent edits an artifact that is already close to shippable web UI. There is no separate "AI mockup" format to translate later: the preview, the editable source, and the exported artifact all come from the same HTML.

The template is also a good example of agent-native ownership. The app stores designs in SQL, exposes template operations as actions, and lets you fork the whole workflow when your team needs a different renderer, exporter, or design-system model.

## For Developers

The rest of this doc is for anyone forking the Design template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-design --template design --standalone
```

### Data Model

All data lives in SQL via Drizzle ORM. Schema: `templates/design/server/db/schema.ts`. Designs and design systems carry the standard `ownableColumns` and a matching framework shares table, so they slot into the per-user / per-org sharing model.

| Table                                    | What it holds                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `designs`                                | A design project — `title`, `description`, `project_type` (`prototype` / `other`), the `data` JSON blob, and an optional `design_system_id` link |
| `design_files`                           | Individual files belonging to a design (`filename`, `content`, `file_type` defaulting to `html`)                                                 |
| `design_versions`                        | Point-in-time `snapshot`s of a design with an optional `label`, for history and rollback                                                         |
| `design_systems`                         | Reusable brand tokens — `data` (colors/typography/spacing), `assets`, `custom_instructions`, and an `is_default` flag                            |
| `design_shares` / `design_system_shares` | Framework shares tables mapping principals (users or orgs) to roles (viewer, editor, admin)                                                      |

A design project is a shell until it has content: `create-design` makes an empty row (`data: "{}"`), then `generate-design` writes the actual standalone HTML/JSX files. The generated artifact, the editable source, and every export all come from the same HTML, so there is no separate "AI mockup" format to translate. A linked design system supplies tokens and `custom_instructions` that the agent honors on every generation pass.

Routes in the UI live under `templates/design/app/routes/`: `_index.tsx` (list), `design.$id.tsx` (editor), `present.$id.tsx` (presentation), `design-systems.tsx` and `design-systems_.setup.tsx`, `templates.tsx`, `examples.tsx`, plus `settings.tsx` and `team.tsx`.

### Key Actions

Every agent-callable operation is a TypeScript file in `templates/design/actions/`, auto-mounted at `POST /_agent-native/actions/:name` and runnable from the CLI as `pnpm action <name>`. The groupings:

- **Designs** — `create-design` (empty shell), `generate-design` (write generated HTML/JSX content), `update-design`, `get-design`, `list-designs`, `duplicate-design`, `delete-design`, and `apply-tweaks` for persisting live tweak-knob values (accent color, density, etc.).
- **Files** — `create-file`, `update-file`, `list-files`, `delete-file` for the files inside a design project.
- **Design systems** — `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `delete-design-system`, `set-default-design-system`, and `analyze-brand-assets` for gathering brand data ahead of analysis.
- **Import** — `import-code`, `import-figma`, `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF/XLSX), and `import-design-project` to lift a design system out of an existing project.
- **Export & handoff** — `export-html`, `export-pdf`, `export-svg`, `export-zip`, and `export-coding-handoff` to turn a design into a coding-tool handoff.
- **Context & navigation** — `view-screen` (current design, open file, view, pending question or variant grid), `get-design-snapshot` (current state for an external agent to continue from), and `navigate`.

### Customize It

Design is a complete, cloneable template. Some practical extension ideas:

- "Add a reusable ecommerce design system with our tokens and sample components."
- "Add an export step that uploads the ZIP to our internal review system."
- "Let me paste existing landing-page HTML and ask the agent for three stronger versions."
- "Add a saved prompt library for product-page, dashboard, and onboarding-screen briefs."
- "Add a custom PDF export preset for stakeholder review."

The agent edits routes, components, actions, and SQL-backed models as needed. See [Templates](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [Getting Started](/docs/getting-started) if this is your first agent-native template.

## What's Next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows what the user is viewing
- [**Creating Templates**](/docs/creating-templates) — current build patterns for agent-native templates
