---
title: "Images"
description: "An agent-native image library and cross-agent image service for brand-consistent AI imagery."
---

# Images

Images is an agent-native workspace for creating brand-consistent AI imagery. It organizes references into flat Libraries, lets teams upload examples for blog heroes, diagrams, landing pages, product shots, and logos, then routes generation through the agent chat so every image can be reviewed and refined.

Use it when your team needs reusable visual direction instead of one-off generic image prompts.

## What You Can Do With It

- **Create image libraries.** Group reference images, canonical logos, style notes, palettes, and generated output by brand, campaign, product, or image category.
- **Generate through chat.** The home composer and library Generate controls send the prompt to the agent with `sendToAgentChat()`, so users can inspect variants, give feedback, and iterate.
- **Upload references.** Add image examples from the library UI or the prompt composer attachment button, then tag them as hero, landing, product, logo, diagram, style-only, or other.
- **Keep a generation audit log.** Every run records prompts, model, aspect ratio, references, source asset, lineage, generated assets, status, errors, and timestamps for later design review.
- **Preserve logo accuracy.** The agent can generate a placeholder area and the server composites the uploaded canonical logo onto the final image instead of relying on the image model to redraw it.
- **Serve other agents.** Slides, Design, Content, Mail, and Dispatch can call Images through A2A to list libraries, generate batches, refine an asset, fetch exports, and render inline previews where embedding is allowed.

## Why It's Interesting

Most AI image tools treat brand consistency as a prompt-writing problem. Images treats it as application state: references, collections, style briefs, run history, and saved assets live in SQL, while image bytes live in object storage or the local file-upload fallback during development.

Because generation is an action and a chat workflow, the UI and the agent share the same operations. A user can start from the big prompt box, a library detail page, another app's chat, or an A2A request from Slides, and the same audit and lineage model is preserved.

## For Developers

The rest of this doc is for anyone forking the Images template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-images --template images --standalone
```

### Customize It

Images is a complete, cloneable template. Some practical extension ideas:

- "Add a product catalog connector so product reference shots can be selected by SKU."
- "Add a strict approval queue before generated images are marked usable for marketing."
- "Add a brand review dashboard that filters failed or low-rated generations by model."
- "Create a workspace-wide default image library and route Slides image generation through it."
- "Add a new provider behind the image generation interface after checking the latest provider docs."

The agent edits routes, components, actions, skills, and SQL-backed models as needed. See [Templates](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [A2A Protocol](/docs/a2a-protocol) for cross-app generation.

## What's Next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**A2A Protocol**](/docs/a2a-protocol) — how other apps call Images
- [**File Uploads**](/docs/file-uploads) — storage and authenticated asset serving
- [**Sharing & Privacy**](/docs/sharing) — library-level access control
