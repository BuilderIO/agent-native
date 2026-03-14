# Deck Generator — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.

---

## Core Principle: Everything is Files

All stateful data in this app is stored in **files**. The frontend (React/Vite) reads and writes files. The agent chat reads and writes files. Scripts read and write files. Files are the shared state mechanism between all three.

This means:

- When the UI updates something, it writes to files via the backend API (`/api/decks`)
- When the agent needs to do something, it reads/writes the same JSON files directly (in `data/decks/`)
- **All decks are JSON files** in `data/decks/` — including the FMD deck
- The FMD TypeScript source files (`client/data/builderFMDSlides*.ts`) are only used for initial seeding. Once `data/decks/builder-fmd.json` exists, it is the source of truth
- **No localStorage** — JSON files are the only source of truth
- The frontend subscribes to file changes via SSE (`/api/decks/events`), so agent edits to JSON files appear in the UI in real-time

```
┌─────────────────────┐         ┌─────────────────────┐
│  Frontend           │         │  Agent Chat         │
│  (React + Vite)     │◄───────►│  (AI agent)         │
│                     │  files  │                     │
│  - reads/writes     │         │  - reads/writes     │
│    files via API    │         │    files + code     │
│  - sends prompts    │         │  - runs scripts     │
│    via agentChat    │         │    via pnpm script  │
│                     │         │  - generates code   │
└────────┬────────────┘         └──────────┬──────────┘
         │                                 │
         │         ┌───────────────┐       │
         └────────►│  Backend      │◄──────┘
                   │  (Express)    │
                   │               │
                   │  - API routes │
                   │  - image gen  │
                   │  - share      │
                   └───────┬───────┘
                           │
                   ┌───────┴───────┐
                   │  scripts/     │
                   │               │
                   │  Reusable     │
                   │  Node.js      │
                   │  scripts run  │
                   │  via pnpm     │
                   └───────────────┘
```

## Firestore File Sync

Data files are bidirectionally synced with Firestore so multiple users (and the cloud-hosted Builder harness) share the same state. The sync is powered by `@agent-native/core/adapters/firestore`.

**What syncs:** Configured in `data/sync-config.json`:

- `data/decks/**/*.json` — All deck JSON files
- `data/**/*.md` — Reference docs (e.g. `builder-positioning.md`)

**What doesn't sync:** Code files, uploads, sync-config itself, conflict sidecar files.

**How it works:**

- On server start, `initFileSync()` does a startup sync (compare local vs Firestore timestamps, resolve conflicts)
- A Firestore real-time listener pushes remote changes to disk
- A file watcher pushes local changes to Firestore
- Three-way merge resolves conflicts; unresolvable conflicts create `.conflict` sidecar files

**Important for agents:**

- Files in `data/decks/` and `data/*.md` are **gitignored** (synced at runtime, not checked in)
- The `.ignore` file overrides this so agents can still search/grep/read these files
- When editing deck JSON files, the changes are automatically synced to Firestore within seconds
- Never edit `data/sync-config.json` unless adding new sync patterns

## Running Scripts

The agent executes backend logic via `pnpm script <name> [--args]`:

```bash
pnpm script generate-image --prompt "a diagram of microservices" --count 3
```

The script runner (`scripts/run.ts`) dispatches to individual script files in `scripts/`. Each script exports a default async function that receives CLI args.

### Available Scripts

| Script             | Purpose                                                        | Example                                                                |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `generate-image`   | Generate images with Gemini + style references                 | `pnpm script generate-image --prompt "hero image" --count 3`           |
| `image-gen-status` | Check if Gemini API key is configured                          | `pnpm script image-gen-status`                                         |
| `image-search`     | Search Google Images via Custom Search API                     | `pnpm script image-search --query "Intuit logo transparent" --count 5` |
| `logo-lookup`      | Get company logo URL via Logo.dev API (free tier, needs token) | `pnpm script logo-lookup --domain intuit.com`                          |

### Adding New Scripts

1. Create `scripts/my-script.ts`:

```typescript
export default async function main(args: string[]) {
  // Parse args, do work, output results
  console.log("Done!");
}
```

2. Register in `scripts/run.ts`:

```typescript
const scripts: Record<string, () => Promise<...>> = {
  "my-script": () => import("./my-script.js"),
  // ...existing scripts
};
```

3. The agent can now run it: `pnpm script my-script --whatever`

### When to Generate vs Reuse Scripts

- **Core functionality** (image generation, data transforms, etc.) → create a permanent script, commit it
- **One-off tasks** (quick data fix, one-time migration) → generate a temporary script, run it, delete it
- **Exploratory** (debugging, investigation) → generate inline, run, clean up

## Agent Chat Integration (UI → Agent)

The app can delegate tasks to the agent chat using `sendToAgentChat()` and `agentChat` from `@agent-native/core`. This lets any UI button or action trigger an agentic flow with full conversational follow-up.

### How It Works

From browser code (React components):

```typescript
import { agentChat } from "@agent-native/core";

// Auto-submit to the agent
agentChat.submit(
  "Generate 3 hero images for the AI slide",
  "Hidden context: slide id is 'slide-3', deck id is 'my-deck', current content is...",
);

// Or prefill for user review
agentChat.prefill(
  "Update all slides to use dark gradient backgrounds",
  "Context about the current deck state...",
);
```

From scripts (Node.js context):

```typescript
import { agentChat } from "@agent-native/core";

agentChat.submit(
  "Image generation complete — 3 variations saved to /tmp/images/",
);
```

### Transport

The `@agent-native/core` chat bridge handles the transport automatically — it works in both browser (postMessage) and Node (stdout) contexts. The harness picks up the messages and routes them to the agent.

### Key Pattern: Image Generation via Chat

Instead of generating images directly in the UI (which has no follow-up capability), the Image button in the editor delegates to the agent chat:

1. User clicks "Image" → fills in a prompt → clicks "Generate via AI Chat"
2. The app sends a `agentChat.submit()` with the prompt + slide context
3. The agent receives it, runs `pnpm script generate-image --prompt "..." --count 3`
4. The agent shows 3 variations to the user in the chat
5. User picks their favorite ("use #2")
6. The agent writes the chosen image into the correct slide file/content
7. User can follow up: "make it darker" / "try a different angle" — full conversation history

This pattern applies to any complex operation where follow-up is valuable.

### Key Pattern: Logo Lookup

When the user asks to insert a company logo:

**Option 1: Logo.dev API** (best quality, requires free token via `LOGO_DEV_TOKEN` env var):

1. Run `pnpm script logo-lookup --domain companyname.com`
2. Use the returned URL: `https://img.logo.dev/companyname.com?token=TOKEN&size=128`
3. Update the slide content in the appropriate data file (`client/data/builderFMDSlides*.ts`)
4. Sign up for a free token at https://logo.dev/signup

**Option 2: Google Image Search** (fallback, always available):

1. Run `pnpm script image-search --query "CompanyName logo transparent" --count 5`
2. Pick the best result (prefer official domains, transparent PNGs, reasonable dimensions)
3. Update the slide content in the appropriate data file

**Never use web_search or manual URL guessing for images.**

### Key Pattern: Slide Content Generation

When generating slide content (new decks, converting from PDF/images, or adding slides):

- **Use image placeholders** for all visual elements — diagrams, charts, photos, illustrations, screenshots, icons, etc.
- Use `.fmd-img-placeholder` divs for image areas. Never try to recreate complex visuals with HTML/CSS.
- **Only render actual text**: headings, bullet points, key text, labels, captions.
- When converting existing slides from uploaded PDFs or images, extract the text content and use placeholders for all visual elements.
- The user can generate proper images later via the image generation flow.

### Source of Truth: Slide Styling

**`data/decks/vkkvhkbJ_Q.json` (SKO2026 - Steve)** is the canonical reference for slide styling. All new deck generation should follow this deck's styling patterns. The default slide templates in `DeckContext.tsx` are also based on this deck.

Key styling rules for all generated slides:

- **Background**: Always `bg-[#000000]` (pure black)
- **Font**: `font-family: 'Poppins', sans-serif` on all text
- **Slide container**: `<div class="fmd-slide" style="...">` with explicit inline styles for padding and justify-content
- **Standard padding**: `padding: 80px 110px` for most slides
- **Section labels**: `font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 32px`
- **Headings**: `font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px`
- **Title slides** (large single word): `font-size: 54px; font-weight: 900` with `justify-content: center`
- **Bullet points**: Use flex layout with `&#x25CF;` bullet character (8px, white), gap: 20px, font-size: 22px, color: rgba(255,255,255,0.85)
- **Sub-bullets**: Use `&#x25CB;` (open circle), padding-left: 36px, slightly smaller font
- **Bold key terms in bullets**: `<strong style="font-weight: 800; color: #fff;">Term</strong>` followed by description in rgba(255,255,255,0.55)
- **Accent color**: `#00E5FF` (cyan) for section labels, emphasis, and highlights
- **Section divider slides**: Single large word, `justify-content: center`, `font-size: 54px`
- **Two-column slides**: Use flex with `gap: 40px`, text on left, image placeholder on right
- **Tables**: Use CSS grid with `grid-template-columns`, alternating row backgrounds with rgba(255,255,255,0.04/0.07)

Reference the 37 slides in `data/decks/vkkvhkbJ_Q.json` for specific examples of each slide type.

## Current Selection State

The editor exposes the current selection state so the AI agent agent can access it:

### Browser Context (DOM)

Data attributes on `<html>` element:

- `data-deck-id` — current deck ID
- `data-slide-id` — current slide ID
- `data-slide-index` — current slide index (0-based)
- `data-selected-image` — selected image src (only present when an image is selected)

### Browser Context (JavaScript)

```javascript
window.__deckSelection;
// Returns:
// {
//   deckId: string,
//   deckTitle: string,
//   slideId: string | null,
//   slideIndex: number,
//   slideLayout: string | null,
//   slideContent: string | null,
//   selectedImageSrc: string | null
// }
```

The agent can read this from the browser console or via injected scripts to understand what the user is currently looking at and working on.

## Project Structure

```
client/                        # React SPA frontend
├── pages/                     # Route components
│   ├── DeckEditor.tsx         # Main editor page
│   ├── DeckList.tsx           # Deck listing / home
│   └── PresentView.tsx        # Presentation mode
├── components/
│   ├── editor/                # Editor UI components
│   │   ├── EditorToolbar.tsx  # Main toolbar (layout, bg, image, undo/redo)
│   │   ├── EditorSidebar.tsx  # Slide list with drag-and-drop
│   │   ├── SlideEditor.tsx    # Slide preview / code editor
│   │   ├── ImageGenPanel.tsx  # Image gen dialog (delegates to agent chat)
│   │   ├── HistoryPanel.tsx   # Undo/redo history popover
│   │   └── ShareDialog.tsx    # Share link dialog
│   ├── deck/
│   │   └── SlideRenderer.tsx  # Core 960x540 slide rendering
│   └── ui/                    # Reusable UI primitives (Radix-based)
├── data/
│   ├── builderFMDSlides1.ts   # FMD slides 1-7 (title, overview, stats, workflow)
│   ├── builderFMDSlides2.ts   # FMD slides 8-14 (platform features, guardrails)
│   └── builderFMDSlides3.ts   # FMD slides 15-21 (use cases, architecture, appendix)
├── context/
│   └── DeckContext.tsx        # Central state: decks, slides, undo/redo (fetches from /api/decks)
├── lib/
│   └── utils.ts               # cn() utility
└── App.tsx                    # Router setup

server/                        # Express API backend
├── index.ts                   # Server setup + route registration
└── routes/
    ├── decks.ts               # GET/PUT/POST/DELETE /api/decks (file-based CRUD)
    ├── image-gen.ts           # POST /api/image-gen/generate (Gemini)
    ├── generate-slides.ts     # POST /api/generate-slides (Gemini)
    └── share.ts               # POST /api/share, GET /api/share/:token

data/                          # File-based data storage
└── decks/                     # User-created deck JSON files

shared/                        # Shared between client + server + scripts
└── api.ts                     # Types, interfaces, DEFAULT_STYLE_REFERENCE_URLS

scripts/                       # Runnable via `pnpm script <name>`
├── run.ts                     # Script dispatcher
├── generate-image.ts          # Image generation with style references
├── image-gen-status.ts        # Check API key status
├── image-search.ts            # Google Image search
└── logo-lookup.ts             # Clearbit logo URL lookup
```

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS 3
- **Backend**: Express (integrated with Vite dev server in dev)
- **UI components**: Radix UI primitives + Lucide icons
- **Image generation**: Google Gemini via `@google/genai`
- **State**: File-based via `/api/decks` (JSON files in `data/decks/`), in-memory undo/redo, share tokens
- **Logo lookup**: Logo.dev API (free tier with token) or Google Image Search fallback
- **Path aliases**: `@/*` → client/, `@shared/*` → shared/

## Development

```bash
pnpm dev          # Start dev server (client + server on port 8080)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm script <name> [--args]  # Run a backend script
```

## Learnings

This project maintains a `LEARNINGS.md` file at the repo root. This file captures preferences, corrections, and patterns learned from feedback during chat sessions.

**Rules:**

- **Always read `LEARNINGS.md` before starting work** — it contains important preferences and past corrections
- **Update `LEARNINGS.md` when corrected** — if the user gives feedback or corrects a mistake, capture the learning immediately
- **Keep entries concise** — short, actionable bullets grouped by category
- **Don't duplicate** — if a learning already exists, refine it rather than adding a duplicate

## Content Generation: Positioning & Messaging

When generating outbound content (deck slides, marketing copy, sales materials, competitive positioning), always consult **`data/builder-positioning.md`** for:

- **Messaging pillars**: Context, Collaboration, Trust
- **Top-level message**: "The AI product development platform where your team and AI agents build, review, and ship with confidence."
- **Elevator analogy**: What Figma did for product design, Builder is doing for product development, with AI.
- **5 personas**: Engineering Leaders (exec buyers), Champions (frontend devs), Design Platform/Systems Leads, Influencers (product/design leaders), Core Contributors (PM/designer/marketer)
- **4 competitive categories**: Prototyping/AI App Builders (v0, Lovable, Bolt), AI IDEs (Cursor, Copilot, Windsurf), Traditional CMS (Contentful, Webflow), AI Agents (Devin, Factory.ai)
- **Shared differentiators**: Real component systems, visual + code flexibility, production quality, ongoing iteration
- **Customer evidence**: Adobe, Cisco, Frete, EagleEye, Conservice proof points
- **Strategic narrative**: From sequential/engineer-bottlenecked → parallel/collaborative AI product development

Always match content to the appropriate persona and competitive context. Use proof points and customer quotes where relevant.

## Key Conventions

1. **Files are the only source of truth** — all deck state lives in JSON files in `data/decks/`. UI edits save to these files via API. Agent edits the files directly. SSE pushes file changes to the UI in real-time. Undo/redo is client-side but each state change writes to the file.
2. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`. Create reusable scripts for common operations, generate throwaway scripts for one-offs
3. **Agent chat for complex flows** — use `sendToAgentChat()` from the client or `agentChat.submit()` from scripts to delegate multi-step operations, especially when follow-up conversation is valuable (image generation, content refinement, etc.)
4. **Keep the UI thin** — the UI should be for direct manipulation. Anything that benefits from AI reasoning or iteration should route through the agent chat
5. **Always use default style references** — image generation always includes brand reference images from `DEFAULT_STYLE_REFERENCE_URLS` in `shared/api.ts` unless explicitly disabled
