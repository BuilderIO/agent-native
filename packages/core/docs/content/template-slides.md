---
title: "Slides Template"
description: "Agent-native presentation editor — generate decks from a prompt, edit visually, and present in full-screen."
---

# Slides Template

An open-source, agent-native presentation editor built on `@agent-native/core`. It replaces Google Slides, Pitch, and PowerPoint with a deck you can author in three ways at once — by talking to the agent, by clicking the canvas, or by editing HTML.

## Overview {#overview}

The Slides template is a full presentation studio:

- Generate complete decks from a prompt, one slide at a time.
- Edit slides visually or drop into raw HTML for full control.
- Generate images with Gemini, search stock photos, and look up company logos.
- Present full-screen with keyboard navigation and speaker notes.
- Comment, share, and collaborate in real time over Yjs.

Every operation the UI does — creating a deck, adding a slide, swapping an image — is exposed as an action the agent can call too. The agent and UI always stay in sync because they read and write the same SQL database.

## Quick start {#quick-start}

Create a new Slides app from the CLI:

```bash
npx @agent-native/core create my-slides --template slides
cd my-slides
pnpm dev
```

Or try the hosted demo at [slides.agent-native.com](https://slides.agent-native.com).

Once running, open the app, click "New deck", and ask the agent in the sidebar: "Generate a 10-slide pitch deck for a coffee subscription service."

## Key features {#key-features}

### Prompt-to-deck generation

Ask the agent for a deck and it builds one slide at a time. Slides stream into the editor live as each one is generated — the agent fires parallel `add-slide` calls so you see the deck assemble in seconds.

Under the hood, this is powered by the `add-slide` and `create-deck` actions in `templates/slides/actions/`.

### Eight slide layouts

Built-in layouts: title, section divider, content with bullets, two-column, image, statement or quote, full-bleed, and blank. Each layout is a pure HTML template with inline styles — the agent picks the right one based on slide purpose. Templates live inside `templates/slides/AGENTS.md` so the agent can reference them without exploring the codebase.

### Visual and code editing

- Double-click any text to edit inline.
- Click a block to open the bubble menu for styles, alignment, and layout.
- Switch to the code editor (`app/components/editor/CodeEditor.tsx`) to edit raw slide HTML.
- Use the slash menu (`SlideSlashMenu.tsx`) to insert blocks by typing `/`.

### AI image generation

Generate images with Gemini directly from the editor or via the agent. Each request returns multiple variations so you can pick the one that fits. Style reference images keep results visually consistent.

Actions: `generate-image`, `edit-image`, `image-search`, `logo-lookup`. UI panels: `ImageGenPanel.tsx`, `ImageSearchPanel.tsx`, `LogoSearchPanel.tsx`.

### Logo and stock image search

- `logo-lookup --domain acme.com` fetches a company logo via Logo.dev or Brandfetch.
- `image-search --query "mountain landscape"` searches Google Images for stock photos.

### Comments and threads

Leave comments on specific slides, quote selected text, and reply in threads. Stored in the `slide_comments` table. Actions: `add-slide-comment`, `list-slide-comments`.

### Drag and drop reordering

Reorder slides in the sidebar, duplicate, or delete with hover controls. The sidebar lives in `app/components/editor/EditorSidebar.tsx`.

### Presentation mode

Full-screen presentation at `/deck/:id/present` with keyboard navigation (arrow keys, space, escape), auto-hiding controls, and speaker notes. See `app/routes/deck.$id_.present.tsx` and `app/components/presentation/PresentationView.tsx`.

### Share links

Generate a public read-only URL for a deck so reviewers can view without an account. The share page is `app/routes/share.$token.tsx`. Fine-grained sharing (viewer, editor, admin roles, per-user or org-wide) is also available via the framework's `share-resource` action.

### Real-time collaboration

Multiple people can edit the same deck simultaneously. Text edits sync through Yjs CRDT so there are no conflicts, and the agent sees and edits the same live document via the `update-slide --find/--replace` action.

### Undo and redo

Cmd+Z and Cmd+Shift+Z work across the whole deck, with a labeled history panel (`HistoryPanel.tsx`) you can scrub through.

### Extract from PDF

Turn a PDF into a starter deck. The `extract-pdf` action parses the file and hands the content to the agent for layout.

## Working with the agent {#working-with-the-agent}

The agent chat lives in the sidebar. It can create decks, edit individual slides, generate images, search logos, and navigate the UI — all using the same actions you'd run from the CLI.

### Example prompts

- "Generate a 10-slide pitch deck for a coffee subscription service, audience is investors."
- "Add a pricing slide after slide 3."
- "Make the title on this slide bigger and change the accent color to green."
- "Generate a hero image for the current slide — dark, minimal, cinematic."
- "Find the logo for stripe.com and add it to slide 2."
- "Replace the word 'customers' with 'members' everywhere in this deck."
- "Summarize this PDF as a 6-slide deck." (attach the PDF)

### What the agent sees

When a deck is open, the agent automatically sees:

- The current `deckId` and `slideIndex`.
- The full list of slides in the open deck.
- The HTML content of the currently selected slide.

This is injected into every message as a `current-screen` block, so the agent never has to guess what "this slide" means. The data comes from the `navigation` application-state key, which the UI writes on every navigation. See `templates/slides/actions/view-screen.ts`.

### Selecting text for focused edits

Select text on a slide and hit Cmd+I to focus the agent with that selection pre-loaded. The agent will act only on what you selected.

### Inline slide previews in chat

The agent can embed a live slide preview directly in a chat reply using the framework's embed fence. It renders a chromeless iframe via `app/routes/slide.tsx` so you can see the result without leaving the conversation.

## Data model {#data-model}

All deck data lives in SQL via Drizzle ORM. Schema: `templates/slides/server/db/schema.ts`.

### decks

| Column       | Type | Notes                                                     |
| ------------ | ---- | --------------------------------------------------------- |
| `id`         | text | Primary key, e.g. `deck-1712345-abc`                      |
| `title`      | text | Deck title                                                |
| `data`       | text | JSON blob: `{ title, slides: [{ id, content, layout }] }` |
| `created_at` | text | Timestamp                                                 |
| `updated_at` | text | Timestamp                                                 |

Each deck also carries the standard `ownableColumns` (owner, visibility, share token) so it slots into the framework's sharing model.

### slide_comments

| Column                        | Notes                                  |
| ----------------------------- | -------------------------------------- |
| `id`                          | Primary key                            |
| `deck_id`                     | Parent deck                            |
| `slide_id`                    | Slide the comment lives on             |
| `thread_id`, `parent_id`      | Threading                              |
| `content`, `quoted_text`      | Comment body and optional text excerpt |
| `author_email`, `author_name` | Author                                 |
| `resolved`                    | Boolean flag                           |

### deck_shares

Framework-provided shares table (created via `createSharesTable`) that maps principals (users or orgs) to roles (viewer, editor, admin) per deck.

### Slide structure

Each slide inside `decks.data` is:

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` is raw HTML — the renderer (`app/components/deck/SlideRenderer.tsx`) provides the black background and fixed aspect ratio, and the HTML provides everything inside. Rich embedding is supported too: Excalidraw diagrams via `ExcalidrawSlide.tsx` and Mermaid charts via `MermaidRenderer.tsx`.

## Customizing it {#customizing-it}

The Slides template is fully forkable. Key places to look when extending it:

### Actions — `templates/slides/actions/`

Every agent-callable operation lives here as a TypeScript file. A few you'll touch often:

- `create-deck.ts` — new deck from scratch or bulk replace.
- `add-slide.ts` — append one slide; prefer this for streaming generation.
- `update-slide.ts` — surgical find/replace or full content swap.
- `view-screen.ts` — snapshot of what the user sees.
- `generate-image.ts`, `edit-image.ts`, `image-search.ts`, `logo-lookup.ts` — image tooling.
- `extract-pdf.ts` — PDF ingestion.

Every action is auto-mounted at `POST /_agent-native/actions/:name` and callable from the CLI as `pnpm action <name>`. Add a new file here to give the agent a new capability.

### Routes — `templates/slides/app/routes/`

- `_index.tsx` — deck list.
- `deck.$id.tsx` — the editor.
- `deck.$id_.present.tsx` — presentation mode.
- `share.$token.tsx` — public read-only share page.
- `slide.tsx` — single-slide embed used in chat previews.
- `settings.tsx` — template settings.
- `team.tsx` — org and team management.

### Editor components — `templates/slides/app/components/editor/`

Most UI customization happens here: `SlideEditor.tsx`, `EditorToolbar.tsx`, `EditorSidebar.tsx`, bubble menus, slash menu, and the panels for image generation, search, and history.

### Skills — `templates/slides/.agents/skills/`

Agent skills that explain patterns when the agent needs to modify code:

- `create-deck/` — how to create a new deck with slides.
- `slide-editing/` — how to edit individual slides.
- `deck-management/` — how decks are stored and accessed.
- `slide-images/` — image generation and search workflow.

### AGENTS.md

`templates/slides/AGENTS.md` is the single source of truth the agent reads on every conversation. It contains the full action list, every slide HTML template, the navigation state contract, and rules for delegating to sub-agents. Update this file whenever you add an action or a new slide layout pattern.

### API routes

For cases where actions aren't the right fit (file uploads, streaming), the template exposes a small set of REST endpoints: `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/:id`. See `templates/slides/server/routes/api/`.
