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

## Why It's Interesting

Design is useful because the agent edits an artifact that is already close to shippable web UI. There is no separate "AI mockup" format to translate later: the preview, the editable source, and the exported artifact all come from the same HTML.

The template is also a good example of agent-native ownership. The app stores designs in SQL, exposes template operations as actions, and lets you fork the whole workflow when your team needs a different renderer, exporter, or design-system model.

## For Developers

The rest of this doc is for anyone forking the Design template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-design --template design --standalone
```

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
