# Slides

An open-source, agent-native alternative to Google Slides, Pitch, and PowerPoint.
Generate full decks from a prompt, edit slides visually, and present full-screen.

**Live app: [slides.agent-native.com](https://slides.agent-native.com)**

Ask the agent for "a 10-slide pitch deck for a coffee subscription service" and
watch it stream in slide-by-slide, then refine it visually or by prompt. Anything
you can do in the editor, the agent can do too.

## Features

- Generate full presentation decks from a prompt.
- Edit slides visually with a bubble menu and slash-menu blocks.
- AI image generation, stock photo search, and company logo lookup.
- Present full-screen with keyboard navigation and speaker notes.
- Real-time collaboration, comments, and public read-only share links.
- Import from PDF, PPTX, DOCX, Google Docs, or a URL; export to PPTX, Google
  Slides, or HTML.
- Design systems and per-deck version history.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-slides](https://agent-native.com/docs/template-slides).
