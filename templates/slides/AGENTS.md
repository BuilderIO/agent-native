# Deck Generator — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **storing-data** — All state is in SQL. No JSON files for data, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **real-time-sync** — UI stays in sync with agent changes via SSE (DB change events).
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

For code editing and development guidance, read `DEVELOPING.md`.

---

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context. They replace the old `learnings.md` file approach.

**Always read the `learnings.md` resource at the start of every conversation.** It contains user preferences, corrections, and patterns from past interactions.

**Update the `learnings.md` resource when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Resources can be **personal** (per-user, default) or **shared** (team-wide).

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

Resources are stored in SQL, not files. They persist across sessions and are not in git.

## Core Principle: Everything is in SQL

All stateful data in this app is stored in **SQL** (SQLite locally, cloud DB via `DATABASE_URL`). The frontend reads/writes via API routes. The agent reads/writes via scripts and core store helpers. SSE streams DB change events to keep the UI in sync.

This means:

- When the UI updates something, it writes to the database via the backend API (`/api/decks`)
- When the agent needs to do something, it reads/writes the same database via scripts
- **All decks are stored in the database**
- **No localStorage for data** — the database is the only source of truth
- The frontend subscribes to DB change events via SSE (`/api/events`), so agent writes appear in the UI in real-time

## Running Scripts

The agent executes backend logic via `pnpm script <name> [--args]`:

```bash
pnpm script generate-image --prompt "a diagram of microservices" --count 3
```

### Available Scripts

| Script             | Purpose                                                        | Example                                                              |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `generate-image`   | Generate images with Gemini + style references                 | `pnpm script generate-image --prompt "hero image" --count 3`         |
| `image-gen-status` | Check if Gemini API key is configured                          | `pnpm script image-gen-status`                                       |
| `image-search`     | Search Google Images via Custom Search API                     | `pnpm script image-search --query "Acme logo transparent" --count 5` |
| `logo-lookup`      | Get company logo URL via Logo.dev API (free tier, needs token) | `pnpm script logo-lookup --domain acme.com`                          |

### Adding New Scripts

1. Create `scripts/my-script.ts`:

```typescript
export default async function main(args: string[]) {
  // Parse args, do work, output results
  console.log("Done!");
}
```

2. It's immediately available as `pnpm script my-script --whatever` (auto-discovered by filename, no registration needed).

### When to Generate vs Reuse Scripts

- **Core functionality** (image generation, data transforms, etc.) → create a permanent script, commit it
- **One-off tasks** (quick data fix, one-time migration) → generate a temporary script, run it, delete it
- **Exploratory** (debugging, investigation) → generate inline, run, clean up

## Agent Chat Integration (UI → Agent)

The app can delegate tasks to the agent chat using `sendToAgentChat()` and `agentChat` from `@agent-native/core`. This lets any UI button or action trigger an agentic flow with full conversational follow-up.

From browser code (React components):

```typescript
import { agentChat } from "@agent-native/core";

agentChat.submit(
  "Generate 3 hero images for the AI slide",
  "Hidden context: slide id is 'slide-3', deck id is 'my-deck', current content is...",
);
```

From scripts (Node.js context):

```typescript
import { agentChat } from "@agent-native/core";

agentChat.submit(
  "Image generation complete — 3 variations saved to /tmp/images/",
);
```

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
3. Update the slide content in the deck JSON file
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

Reference existing deck JSON files in `data/decks/` for specific examples of each slide type.

## Current Selection State

The editor exposes the current selection state so the AI agent can access it:

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

1. **The database is the only source of truth** — all deck state lives in SQL. UI edits save to the database via API. Agent edits the database via scripts. SSE pushes DB change events to the UI in real-time. Undo/redo is client-side but each state change writes to the database.
2. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`. Create reusable scripts for common operations, generate throwaway scripts for one-offs
3. **Agent chat for complex flows** — use `sendToAgentChat()` from the client or `agentChat.submit()` from scripts to delegate multi-step operations, especially when follow-up conversation is valuable (image generation, content refinement, etc.)
4. **Keep the UI thin** — the UI should be for direct manipulation. Anything that benefits from AI reasoning or iteration should route through the agent chat
5. **Always use default style references** — image generation always includes brand reference images from `DEFAULT_STYLE_REFERENCE_URLS` in `shared/api.ts` unless explicitly disabled
