---
title: "Design"
description: "An AI-native design tool — sketch a UI, brand kit, or marketing visual by prompt or by hand, with the agent as your co-designer."
---

# Design

A design tool where the agent is a real collaborator. Sketch a UI, a brand kit, or a marketing visual by prompt or by hand, and the agent generates layouts, suggests color systems, swaps fonts, and adjusts spacing alongside you on the same canvas.

Think along the lines of Figma or Canva, but the agent has full edit rights — it can move shapes, restyle layers, and generate new artwork from a description, all in the same canvas you're working in.

## What you can do with it

- **Prompt-driven design.** Describe what you want — "a hero section for a B2B fintech SaaS, dark mode, brand color #14B8A6" — and the agent drafts it on the canvas.
- **Edit by hand or by chat.** Drag, resize, recolor with the toolbar; or ask the agent to "tighten the spacing", "swap the headline font for something more editorial", "make every CTA the brand teal".
- **AI image generation built in.** Generate background art, illustrations, or icons inline. Re-run with refined prompts without leaving the canvas.
- **Brand-aware.** Save a brand kit (colors, fonts, voice). The agent applies it consistently across new artwork.
- **Components and frames.** Reusable components, multi-page documents, and export to PNG/SVG/PDF.
- **Agent context awareness.** When a layer is selected, the agent knows what you've selected and can act on just that piece.

## Why it's interesting

Three things make Design a good showcase of what agent-native enables:

1. **The agent edits the canvas directly.** Layers, frames, styles — the agent calls the same actions the toolbar does. There's no "AI mode" separate from the design tool; they're the same tool.
2. **Selection-aware editing.** Select a button and ask "make this the brand teal across all pages" — the agent knows which element you mean and propagates the change.
3. **Designs you own.** The files live in your SQL, the artwork lives in your storage, the agent is yours. Fork the template, plug in a different image-generation provider, integrate your team's component library — it's your code.

## For developers

The rest of this doc is for anyone forking the Design template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-design --template design --standalone
```

### Customize it

Design is a full cloneable SaaS — fork it and ask the agent to extend it. Some examples:

- "Add a 'Generate variations' button that produces five color-swap alternatives for the selected frame."
- "Wire the brand kit to read from our marketing-site repo so colors stay in sync."
- "Add a comments layer with @-mentions and email notifications."
- "Auto-export every published frame as a 1200×630 OG image and upload to our CDN."
- "Let me drop a Figma link in chat and have the agent re-create it as native components here."

The agent edits routes, components, canvas actions, and the schema as needed. See [Cloneable SaaS](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [Getting Started](/docs/getting-started) if this is your first agent-native template.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows the selected layer
- [**Tools**](/docs/tools) — generate one-off image-creation utilities alongside the canvas
