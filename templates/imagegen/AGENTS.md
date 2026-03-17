# Brand Asset Manager — Agent Guide

## Overview

This app manages brand assets and generates on-brand images using Gemini. The agent's role is to analyze brand references, build style profiles, and generate images that match the brand's visual style.

## Agent Skills

See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

## Architecture

Files are the database. All state lives in `data/`:

- `data/brand/config.json` — Brand identity (name, colors, fonts)
- `data/brand/style-profile.json` — Agent-generated style analysis
- `data/brand/logos/` — Uploaded logo files
- `data/brand/references/` — Style reference images
- `data/generations/{id}.json` — Generation records
- `data/generations/{id}_N.png` — Generated images
- `data/settings.json` — Default generation settings

## Scripts

Run scripts with `pnpm script <name>`:

### analyze-brand

Analyzes all reference images and generates a style profile.

```bash
pnpm script analyze-brand
```

### generate-images

Generates on-brand image variations from a prompt.

```bash
pnpm script generate-images --prompt "A team meeting" --variations 4 --model gemini-3-pro-image-preview
```

Optional: `--references file1.png,file2.png`

## Key Workflows

### When user uploads new reference images

1. Acknowledge the upload
2. Run `pnpm script analyze-brand` to update the style profile
3. Report the updated style analysis

### When user asks to generate images

1. Run `pnpm script generate-images` with the user's prompt and preferences
2. Report results and offer to adjust

### When user edits brand config

The UI handles config changes directly via API. No agent action needed unless the user asks for suggestions.

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Environment

- `GEMINI_API_KEY` — Required for style analysis and image generation
