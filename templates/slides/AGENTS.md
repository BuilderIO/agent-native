# Slides — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **agent-native** presentation editor built with `@agent-native/core`.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view, deck ID, slide index        | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

### Navigation state (read what the user sees)

The UI writes `navigation` whenever the user navigates:

```json
{
  "view": "editor",
  "deckId": "abc123",
  "slideIndex": 2
}
```

Views: `"list"` (deck list), `"editor"` (editing a deck), `"present"` (presentation mode), `"settings"`.

**Do NOT write to `navigation`** -- it is overwritten by the UI. Use `navigate` to move the user.

### Navigate command (control the UI)

```json
{ "deckId": "abc123" }
{ "view": "list" }
```

## Data Model

All decks are stored in the `decks` SQL table via Drizzle ORM:

```sql
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL,       -- Full deck JSON (slides, metadata)
  created_at TEXT,
  updated_at TEXT
);
```

Each deck's `data` column contains a JSON object with `title` and `slides` array. Each slide has `id`, `content` (HTML), and optional `layout`.

## Agent Operations

**Always check the current screen before editing.** The user's view (which deck, which slide, scroll position) can change mid-conversation. Stale deck/slide IDs lead to editing the wrong thing.

### If you are the built-in agent-chat agent

A `<current-screen>` block is auto-injected into every user message with the current `deckId`, `currentSlideId`, and the full slide list. You don't need to call `view-screen` for the first action on a turn — the injected block is fresh. You **do** need to re-check if the user says "this slide" or "now do X" after several tool calls: the user may have navigated. When in doubt, call `view-screen`.

### If you are an external CLI agent (Claude Code, Codex, Cursor, etc.)

You do NOT get auto-injected screen state. You MUST call `view-screen` yourself at the start of every task AND whenever you're about to edit a specific slide/deck. Do not rely on what was visible in previous turns — the user may have switched to a different slide since your last action.

**Rule of thumb:** run `pnpm action view-screen` before any `update-slide`, `add-slide`, or `create-deck --deckId` call to make sure you have the current `deckId` and `slideId`.

### Running actions

**Always use `pnpm action <name>` for operations** — never curl or raw HTTP.

Your shell cwd is this template's root (e.g., `templates/slides/`). Run actions directly:

```bash
pnpm action <name> [args]
```

If your cwd is the monorepo root instead (e.g., running from the Frame wrapper), prefix with `cd templates/slides &&`. Check with `pwd` if you're unsure. If `pnpm action` fails with "command not found" or "No such file", `cd` to the template root first.

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

### Reading & Searching

| Action        | Args            | Purpose                        |
| ------------- | --------------- | ------------------------------ |
| `view-screen` |                 | See current UI state + context |
| `list-decks`  | `[--compact]`   | List all decks with metadata   |
| `get-deck`    | `--id <deckId>` | Get a deck with all slides     |

### Comments

| Action                | Args                                                                 | Purpose                     |
| --------------------- | -------------------------------------------------------------------- | --------------------------- |
| `list-slide-comments` | `--deckId <id> --slideId <id>`                                       | List comments on a slide    |
| `add-slide-comment`   | `--deckId <id> --slideId <id> --content "text" [--quotedText "..."]` | Add a comment to a slide    |
| `add-slide-comment`   | `--deckId <id> --slideId <id> --threadId <id> --content "reply"`     | Reply to an existing thread |

### Creating & Editing Slides

**Default flow — build a deck slide-by-slide (PREFERRED):**

1. If a deck is already open (check `<current-screen>` for `deckId`), skip to step 3.
2. Otherwise, create an empty deck: `create-deck --title "X" --slides '[]'`, then `navigate --deckId=<returned-id>`.
3. Call `add-slide --deckId=<id> --content="<html>"` once per slide. **Fire multiple `add-slide` calls in parallel in the same turn** — they run concurrently and the user sees each slide appear live.

**Why add-slide is preferred over create-deck with all slides:**

- The user sees slides stream in one-by-one (create-deck drops them all at once).
- Parallel tool calls mean all slides generate concurrently.
- If one slide fails, the others still land.

**Other operations:**

- **Replace one slide's content:** `update-slide --find/--replace` (surgical, syncs live via Yjs) or `--fullContent`.
- **Bulk replace (rare):** `create-deck --deckId <existing>` to atomically replace ALL slides in one deck.

| Action         | Args                                                             | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `add-slide`    | `--deckId <id> --content "<html>" [--layout ...] [--position N]` | **PREFERRED** — add one slide to an existing deck; parallel-safe |
| `create-deck`  | `--title "X" --slides '[]'`                                      | Create a new empty deck                                          |
| `create-deck`  | `--title "X" --slides '[...]'`                                   | Create a new deck with all slides (bulk, rarely preferred)       |
| `create-deck`  | `--title "X" --slides '[...]' --deckId <id>`                     | Replace all slides in an existing deck (atomic bulk replace)     |
| `update-slide` | `--deckId <id> --slideId <id> --find "old" --replace "new"`      | Surgical text edit — syncs live to editors                       |
| `update-slide` | `--deckId <id> --slideId <id> --fullContent "<html>"`            | Full slide content replacement                                   |

### Navigation

| Action     | Args                               | Purpose                  |
| ---------- | ---------------------------------- | ------------------------ |
| `navigate` | `--deckId <id> [--slideIndex <n>]` | Navigate to a deck/slide |
| `navigate` | `--view list`                      | Navigate to deck list    |

### Image Generation

| Action             | Args                                                  | Purpose                     |
| ------------------ | ----------------------------------------------------- | --------------------------- |
| `generate-image`   | `--prompt "..." [--count 3] [--deck-id] [--slide-id]` | Generate images with Gemini |
| `image-search`     | `--query "..." [--count 5]`                           | Search Google Images        |
| `logo-lookup`      | `--domain acme.com`                                   | Get company logo URL        |
| `image-gen-status` |                                                       | Check Gemini API key status |

### Sharing

Decks are **private by default** — only the creator sees them. To grant access to others, change the visibility or add explicit share grants. These actions are auto-mounted framework-wide:

| Action                    | Args                                                                                                                          | Purpose                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `share-resource`          | `--resourceType deck --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant a user or org access to a deck |
| `unshare-resource`        | `--resourceType deck --resourceId <id> --principalType user\|org --principalId <email-or-orgId>`                              | Revoke a share grant                 |
| `list-resource-shares`    | `--resourceType deck --resourceId <id>`                                                                                       | Show current visibility + all grants |
| `set-resource-visibility` | `--resourceType deck --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility             |

Read (`get-deck`, `list-decks`, `view-screen`) admits rows the current user owns, has been shared on, or that match the resource's visibility. Write (`create-deck --deckId`, `add-slide`, `update-slide`) requires the `editor` role or above; owners always satisfy. The separate `share-link` dialog (anonymous public URL via `share_token`) is orthogonal to this — anyone with the link can view regardless of visibility. See the `sharing` skill for the full model.

### Common Tasks

| User request                          | What to do                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "What am I looking at?"               | `pnpm action view-screen`                                                                                                 |
| "List my decks"                       | `pnpm action list-decks`                                                                                                  |
| "Create a new deck about X"           | `create-deck --title "X" --slides '[]'` → `navigate --deckId=<returned-id>` → fire multiple `add-slide` calls in parallel |
| "Fill this deck / add slides to this" | Read `deckId` from `<current-screen>`, then fire multiple `add-slide --deckId=<id>` calls in parallel — one per slide     |
| "Add a slide about Y"                 | `add-slide --deckId <id> --content "<html>"` (new slide) or `update-slide --fullContent` (replace existing)               |
| "Generate an image for this slide"    | `pnpm action generate-image --prompt "..." --deck-id <id>`                                                                |
| "Open deck abc123"                    | `pnpm action navigate --deckId=abc123`                                                                                    |
| "Go to the deck list"                 | `pnpm action navigate --view=list`                                                                                        |
| "Find the company logo for X"         | `pnpm action logo-lookup --domain x.com`                                                                                  |

## Slide HTML Templates

**Do NOT explore the codebase or call db-schema to understand slides.** Use these templates directly.

Every slide `content` is HTML. The slide renderer provides the black background — your HTML is the inner content.

### Outer wrapper (required for every slide)

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;"
>
  <!-- slide content here -->
</div>
```

### Title Slide

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 24px;"
  >
    LABEL OR DATE
  </div>
  <h1
    style="font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;"
  >
    Title Here
  </h1>
  <p style="font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;">
    Subtitle or presenter
  </p>
</div>
```

### Section Divider

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 20px;"
  >
    01
  </div>
  <h2
    style="font-size: 72px; font-weight: 900; color: #fff; line-height: 1.05; letter-spacing: -2px; margin: 0;"
  >
    Section Title
  </h2>
</div>
```

### Content Slide (bullets)

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;"
  >
    SECTION LABEL
  </div>
  <h2
    style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;"
  >
    Slide Heading
  </h2>
  <div style="display: flex; flex-direction: column; gap: 20px;">
    <div style="display: flex; align-items: flex-start; gap: 16px;">
      <span
        style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;"
        >&#x25CF;</span
      >
      <span
        style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;"
        >Bullet point text here</span
      >
    </div>
    <div style="display: flex; align-items: flex-start; gap: 16px;">
      <span
        style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;"
        >&#x25CF;</span
      >
      <span
        style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;"
        >Another bullet point</span
      >
    </div>
  </div>
</div>
```

### Statement / Quote Slide

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="width: 60px; height: 4px; background: #00E5FF; margin-bottom: 40px;"
  ></div>
  <p
    style="font-size: 48px; font-weight: 800; color: #fff; line-height: 1.2; letter-spacing: -1px; margin: 0 0 32px 0;"
  >
    &ldquo;Statement or quote here&rdquo;
  </p>
  <p style="font-size: 18px; color: rgba(255,255,255,0.45); margin: 0;">
    Source or attribution
  </p>
</div>
```

### Metrics / Stats Slide

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;"
  >
    SECTION LABEL
  </div>
  <h2
    style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 60px 0;"
  >
    Heading
  </h2>
  <div style="display: flex; gap: 60px;">
    <div style="flex: 1;">
      <div
        style="font-size: 72px; font-weight: 900; color: #00E5FF; letter-spacing: -2px; line-height: 1;"
      >
        42%
      </div>
      <div
        style="font-size: 18px; color: rgba(255,255,255,0.55); margin-top: 12px;"
      >
        Metric label
      </div>
    </div>
    <div style="flex: 1;">
      <div
        style="font-size: 72px; font-weight: 900; color: #00E5FF; letter-spacing: -2px; line-height: 1;"
      >
        10x
      </div>
      <div
        style="font-size: 18px; color: rgba(255,255,255,0.55); margin-top: 12px;"
      >
        Metric label
      </div>
    </div>
  </div>
</div>
```

### Closing / CTA Slide

```html
<div
  class="fmd-slide"
  style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;"
>
  <div
    style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 24px;"
  >
    GET STARTED
  </div>
  <h2
    style="font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 32px 0;"
  >
    Closing statement here
  </h2>
  <p style="font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;">
    Contact or next step
  </p>
</div>
```

### Image Placeholder

When a slide needs a visual:

```html
<div
  class="fmd-img-placeholder"
  style="width: 100%; height: 300px; border-radius: 12px;"
>
  Description of what image should show
</div>
```

### Complete Example — 2-slide deck

```bash
pnpm action create-deck --title "My Deck" --slides '[
  {
    "id": "slide-1",
    "layout": "title",
    "content": "<div class=\"fmd-slide\" style=\"padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: '\''Poppins'\'', sans-serif;\"><div style=\"font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 24px;\">2025</div><h1 style=\"font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;\">My Deck Title</h1><p style=\"font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;\">Subtitle here</p></div>"
  },
  {
    "id": "slide-2",
    "layout": "content",
    "content": "<div class=\"fmd-slide\" style=\"padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: '\''Poppins'\'', sans-serif;\"><div style=\"font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;\">OVERVIEW</div><h2 style=\"font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;\">Key Points</h2><div style=\"display: flex; flex-direction: column; gap: 20px;\"><div style=\"display: flex; align-items: flex-start; gap: 16px;\"><span style=\"font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;\">&#x25CF;</span><span style=\"font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;\">First point</span></div><div style=\"display: flex; align-items: flex-start; gap: 16px;\"><span style=\"font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;\">&#x25CF;</span><span style=\"font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;\">Second point</span></div></div></div>"
  }
]'
```

Then navigate: `pnpm action navigate --deckId=<returned-id>`

## Delegating to Sub-Agents

When spawning a sub-agent for slide work, write an explicit task description — never vague. The sub-agent has the same actions you do and will use them if you tell it to.

**Always include in every slide sub-agent task:**

1. **The exact deckId** if working on an existing deck
2. **Preferred action**: `add-slide` for slide-by-slide generation (parallel), not `create-deck` with a huge slides array
3. **DO NOT tell it to read skills or explore** — the templates are in this AGENTS.md

**Example — filling an open deck (PREFERRED — parallel add-slide):**

```
The user has deck "deck-1234567-abc" open. Populate it with 5 slides about "AI trends in 2025".

Fire FIVE parallel add-slide tool calls in a single turn:
  add-slide --deckId "deck-1234567-abc" --content "<title slide HTML>"
  add-slide --deckId "deck-1234567-abc" --content "<slide 2 HTML>"
  add-slide --deckId "deck-1234567-abc" --content "<slide 3 HTML>"
  add-slide --deckId "deck-1234567-abc" --content "<slide 4 HTML>"
  add-slide --deckId "deck-1234567-abc" --content "<closing slide HTML>"

Use the slide HTML templates from the AGENTS.md. DO NOT use db-schema, search-files, resource-read, or shell.
```

**Example — creating a new deck from scratch:**

```
Create a new deck titled "AI Trends 2025" with 5 slides.

Step 1: create-deck --title "AI Trends 2025" --slides '[]'  (empty deck)
Step 2: navigate --deckId=<returned-id>
Step 3: Fire 5 parallel add-slide calls (same pattern as the "open deck" example above).

DO NOT bundle all slides into step 1's --slides array. Adding them one-by-one via add-slide lets the user watch the deck build live.
```

**If the user has a deck open** (visible in `<current-screen>`), include the `deckId` from the screen state in your task. Never make the sub-agent guess or discover the deckId on its own.

## Slide Styling Rules

- **Background**: `bg-[#000000]` (pure black) — set by the renderer, not your HTML
- **Font**: `font-family: 'Poppins', sans-serif`
- **Headings**: `font-size: 40px; font-weight: 900; color: #fff`
- **Accent color**: `#00E5FF` (cyan)
- **Image placeholders**: `.fmd-img-placeholder` divs

## Agent Chat Integration

The app delegates complex operations to the agent chat via `sendToAgentChat()`. The image generation flow works through the agent chat for conversational follow-up.

## Content Generation: Positioning & Messaging

When generating outbound content (deck slides, marketing copy), consult **`data/builder-positioning.md`** for messaging pillars, personas, competitive positioning, and customer evidence.

## Skills (for code editing only)

These skills are **only** needed when modifying source code, styles, or architecture. They are **not** needed for creating slides — the slide HTML templates above have everything you need for slide generation.

The framework auto-injects a `<skills>` block in your system prompt listing every available skill with its directory path and description. Skills are folders at `.agents/skills/<name>/` containing `SKILL.md` plus any supporting files.

Read a skill via shell (dev mode):

```
shell(command="cat .agents/skills/actions/SKILL.md")
shell(command="ls .agents/skills/actions/")
```

In production mode (no shell): critical content should be inlined in this AGENTS.md. For this template, all slide HTML templates are already inlined above — skills are only needed for code modification, which happens in dev.

## Inline Previews in Chat

The agent can embed a single slide directly inside a chat message using the framework's `embed` fence. This renders a chromeless iframe at `/slide` that shows one slide from a deck.

**How to emit an inline slide preview:**

````
```embed
src: /slide?deckId=<id>&slideIndex=<n>
aspect: 16/9
title: <slide title or description>
```
````

- `deckId` — the deck's `id` field (required).
- `slideIndex` — zero-based index of the slide to show (default: `0`).
- `aspect: 16/9` — always use 16/9 for slides.
- `title` — a short human-readable label shown above the iframe in chat.

The preview route (`app/routes/slide.tsx`) fetches the deck via `/api/decks/:id`, renders the slide using the same `SlideRenderer` used in the editor, and shows an "Open in app" button (visible only when running inside the embed) that navigates the main app to the deck's presentation view at the correct slide.

**Example — show slide 2 of deck `abc123`:**

````
```embed
src: /slide?deckId=abc123&slideIndex=1
aspect: 16/9
title: Slide 2 — Key Metrics
```
````

## API Routes

| Method | Route            | Description       |
| ------ | ---------------- | ----------------- |
| GET    | `/api/decks`     | List all decks    |
| POST   | `/api/decks`     | Create a new deck |
| GET    | `/api/decks/:id` | Get a deck        |
| PUT    | `/api/decks/:id` | Update a deck     |
| DELETE | `/api/decks/:id` | Delete a deck     |

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## Development

For code editing and development guidance, read `DEVELOPING.md`.
