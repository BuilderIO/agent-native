---
title: "Images"
description: "Brand-consistent AI image generation — libraries of references, palette, and style brief that ground every generation in your brand."
---

# Images

Images is the agent-native AI image generation app. Instead of a one-shot prompt-to-image tool, you organize **libraries** — collections of reference images, brand palette, style brief, and an optional canonical logo. Every generation grounds itself in the chosen library, so the output stays on-brand by default.

The headline model is **Gemini 3.1 Flash Image (Nano Banana 2)**. The Generate popover and the Settings page expose a model picker so you can opt up to Nano Banana Pro for high-stakes work, or down to a cheaper option for cost-sensitive runs.

## What You Can Do With It

- **Curate libraries.** Drop in 5–20 reference images per category — blog hero, landing, product, logo, diagram. Tag what each one is for. The agent uses the right slice of references depending on what you ask for.
- **Generate brand-consistent images.** "Make 3 blog hero images for an article about cold-start latency." The agent reads your library's style brief, palette, and references, then generates candidates in parallel.
- **Pick from a candidate grid.** The Generate flow always shows you 1–4 candidates. Click Save on the one you want; the others stay as ephemeral candidates until you clear them.
- **Iterate naturally.** "Make the second one darker, less coral, more navy." The agent uses Gemini's multi-turn chat under the hood, preserving identity from the previous image.
- **Composite real logos.** When a library has a canonical logo and you toggle "Use logo," the agent generates the scene with a placeholder rectangle, then composites the actual logo (PNG or SVG) server-side via Sharp. The logo stays pixel-perfect — never AI-degraded.
- **Call from other apps via A2A.** Slides, design, content, and mail can all delegate to the images agent over A2A. A 5-slide deck fans out 5 parallel A2A calls; you see image previews stream into the calling app's chat.

## Why It's Interesting

Most AI image tools forget your brand the moment they start generating. Images flips that around: every generation runs through a per-library prompt envelope that hex-codes your palette, role-tags 3–5 references, and pins a style narrative. The agent never makes up colors, never reinvents your visual grammar, and never guesses at your logo.

Because libraries live in SQL with the standard `ownableColumns` model, you can share a library with a teammate or your whole org, and the same A2A surface that powers slides cross-app generation also lets you list, create, generate, and iterate from any other agent-native app.

## For Developers

The rest of this doc is for anyone forking the Images template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-images --template images --standalone
```

### Customize It

Images is a complete, cloneable template. Some practical extension ideas:

- "Add a 'crop to focal point' export preset for thumbnails."
- "Auto-extract a palette from a website URL when creating a new library."
- "Surface SynthID provenance on every saved asset."
- "Add a 'private link' share for an asset that bypasses login."
- "Wire up our company's S3 bucket as the storage provider."

The agent edits routes, components, actions, schema migrations, and the A2A skill list as needed. See [Templates](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [Getting Started](/docs/getting-started) if this is your first agent-native template.

## What's Next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**A2A Protocol**](/docs/a2a-protocol) — how slides, design, mail, and other apps call the images agent
- [**Creating Templates**](/docs/creating-templates) — current build patterns for agent-native templates
