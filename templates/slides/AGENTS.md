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

| State Key        | Purpose                                   | Direction                  |
| ---------------- | ----------------------------------------- | -------------------------- |
| `navigation`     | Current view, deck ID, slide index        | UI -> Agent (read-only)    |
| `navigate`       | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |
| `show-questions` | Trigger question flow overlay in the UI   | Agent -> UI                |

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

### Question Flow (structured questions before generating)

Write to `show-questions` to trigger a full-panel question overlay in the deck editor. The UI polls this key every 2 seconds. When questions are present, the overlay appears instead of the slide editor. When the user submits answers or skips, the UI sends the answers to agent chat and deletes the key.

#### When to Ask Questions

| Scenario                                                      | Questions                              |
| ------------------------------------------------------------- | -------------------------------------- |
| Complex/ambiguous request ("make me a deck about X")          | Ask 4-8 structured questions           |
| Specific request with clear direction ("10-slide sales deck") | Ask 2-4 clarifying questions           |
| Simple tweaks/follow-ups ("add a slide about Y")              | Skip questions, just do it             |
| "Decide for me" / "surprise me"                               | Zero questions — pick a bold direction |

#### show-questions Format

```json
{
  "questions": [
    {
      "id": "audience",
      "type": "text-options",
      "question": "Who is the primary audience?",
      "options": [
        { "label": "Investors / Board", "value": "investors" },
        { "label": "Team / Internal", "value": "internal" },
        { "label": "Customers / Prospects", "value": "customers" },
        { "label": "Conference / Public", "value": "conference" }
      ],
      "required": true
    },
    {
      "id": "tone",
      "type": "text-options",
      "question": "What tone should the deck have?",
      "options": [
        { "label": "Professional & Polished", "value": "professional" },
        { "label": "Bold & Energetic", "value": "bold" },
        { "label": "Minimal & Clean", "value": "minimal" },
        { "label": "Narrative / Storytelling", "value": "narrative" }
      ]
    },
    {
      "id": "color-mood",
      "type": "color-options",
      "question": "Pick a color mood",
      "options": [
        { "label": "Ocean", "value": "#0EA5E9", "color": "#0EA5E9" },
        { "label": "Forest", "value": "#22C55E", "color": "#22C55E" },
        { "label": "Sunset", "value": "#F97316", "color": "#F97316" },
        { "label": "Midnight", "value": "#6366F1", "color": "#6366F1" },
        { "label": "Rose", "value": "#F43F5E", "color": "#F43F5E" },
        { "label": "Neutral", "value": "#64748B", "color": "#64748B" }
      ]
    },
    {
      "id": "slide-count",
      "type": "slider",
      "question": "How many slides?",
      "min": 3,
      "max": 20
    },
    {
      "id": "additional-context",
      "type": "freeform",
      "question": "Anything else the deck should include?",
      "description": "Key points, data, specific sections, etc."
    }
  ]
}
```

#### Question Types

| Type            | UI             | Use for                                |
| --------------- | -------------- | -------------------------------------- |
| `text-options`  | Button group   | Audience, tone, style, purpose choices |
| `color-options` | Color swatches | Color mood, theme selection            |
| `slider`        | Range slider   | Slide count, density, intensity        |
| `file`          | File upload    | Brand assets, reference images, docs   |
| `freeform`      | Text area      | Additional context, specific needs     |

Each question has: `id` (unique key), `type`, `question` (label shown to user), optional `description`, optional `required` flag.
For `text-options` and `color-options`: provide `options` array with `label`/`value` (and `color` for color-options). Set `multiSelect: true` for multi-pick.
For `slider`: provide `min`/`max`.

The UI automatically appends "Explore a few options" and "Decide for me" choices to every `text-options` question.

#### Writing show-questions from an action or script

```typescript
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("show-questions", {
  questions: [
    /* ... */
  ],
});
```

The UI will pick it up on its next 2-second poll cycle and display the overlay.

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

| Action             | Args                                                                                 | Purpose                    |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------- |
| `generate-image`   | `--prompt "..." [--model gemini\|openai\|auto] [--count 3] [--deck-id] [--slide-id]` | Generate images            |
| `image-search`     | `--query "..." [--count 5]`                                                          | Search Google Images       |
| `logo-lookup`      | `--domain acme.com`                                                                  | Get company logo URL       |
| `image-gen-status` |                                                                                      | Check configured providers |

### Design Systems

| Action                      | Args                                                              | Purpose                            |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `create-design-system`      | `--title "X" [--description "..."] --data '<json>'`               | Create a new design system         |
| `update-design-system`      | `--id <id> [--title "X"] [--data '<json>']`                       | Update design system tokens        |
| `get-design-system`         | `--id <id>`                                                       | Get design system with all tokens  |
| `list-design-systems`       | `[--compact]`                                                     | List all accessible design systems |
| `set-default-design-system` | `--id <id>`                                                       | Set one as the default             |
| `apply-design-system`       | `--deckId <id> --designSystemId <id>`                             | Link a design system to a deck     |
| `analyze-brand-assets`      | `[--websiteUrl "..."] [--companyName "..."] [--brandNotes "..."]` | Gather brand data for analysis     |

When generating slides for a deck that has a design system, **always use the design system's colors, fonts, and styles** instead of the default values. Check the design system with `get-design-system --id <id>` first.

### Import / Export

| Action           | Args                                           | Purpose                           |
| ---------------- | ---------------------------------------------- | --------------------------------- |
| `import-file`    | `--filePath <path> [--format auto] [--deckId]` | Import PPTX/DOCX/PDF to deck      |
| `import-pptx`    | `--filePath <path> [--deckId] [--title]`       | Direct PPTX import to deck        |
| `import-docx`    | `--filePath <path>`                            | Extract DOCX content for slides   |
| `export-pptx`    | `--deckId <id> [--includeNotes]`               | Export deck as PowerPoint         |
| `export-html`    | `--deckId <id>`                                | Export as standalone HTML         |
| `duplicate-deck` | `--deckId <id> [--title]`                      | Create a copy of an existing deck |

### Sharing

Decks are **private by default** — only the creator sees them. To grant access to others, change the visibility or add explicit share grants. These actions are auto-mounted framework-wide:

| Action                    | Args                                                                                                                          | Purpose                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `share-resource`          | `--resourceType deck --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant a user or org access to a deck |
| `unshare-resource`        | `--resourceType deck --resourceId <id> --principalType user\|org --principalId <email-or-orgId>`                              | Revoke a share grant                 |
| `list-resource-shares`    | `--resourceType deck --resourceId <id>`                                                                                       | Show current visibility + all grants |
| `set-resource-visibility` | `--resourceType deck --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility             |

Read (`get-deck`, `list-decks`, `view-screen`) admits rows the current user owns, has been shared on, or that match the resource's visibility. Write (`create-deck --deckId`, `add-slide`, `update-slide`) requires the `editor` role or above; owners always satisfy. The separate `share-link` dialog (anonymous public URL via `share_token`) is orthogonal to this — anyone with the link can view regardless of visibility. See the `sharing` skill for the full model.

### Replying to Cross-App Callers (A2A)

When this agent is called via A2A (e.g. dispatch asking "make a deck about X"), the caller is in a different app and **cannot see your local UI state, navigation, or deck list**. They only see the text you put in your reply.

**After creating or modifying a deck, always include the canonical deck URL in your reply text — fully-qualified, never a relative path:**

```
${process.env.APP_URL}/deck/<deckId>
```

The URL pattern is `/deck/<id>` (singular `deck`). If `process.env.APP_URL` isn't set, fall back to `https://slides.agent-native.com/deck/<id>` for the prod app.

**Examples — good vs bad replies for "Create a 3-slide deck about Builder.io. Reply with just the URL.":**

|     |                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❌  | "I'll create a 3-slide deck about Builder.io! Slide 1 — What is Builder.io? Slide 2 — Key features. Slide 3 — Get started." (no URL — caller has nothing to point to) |
| ❌  | "Created at `/deck/deck-123`" (relative path — caller's host won't resolve it)                                                                                        |
| ✅  | "https://slides.agent-native.com/deck/deck-1777482594025-d7x2x" (verbatim, fully-qualified, just the URL the user asked for)                                          |

Same rule for `/deck/<id>/present` (presentation mode), `/share/<token>` (share link), and any other URL the caller might need.

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
| "Import a PPTX file"                  | Upload file, then `import-pptx --filePath <path>`                                                                         |
| "Export this deck as PowerPoint"      | `export-pptx --deckId <id>`                                                                                               |
| "Set up brand identity"               | `analyze-brand-assets --websiteUrl "..."` then use results to `create-design-system`                                      |
| "Generate an image with OpenAI"       | `generate-image --prompt "..." --model openai`                                                                            |

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

**When a design system is active**, use its tokens instead of the defaults above. Call `get-design-system --id <id>` to get the current tokens: accent color, fonts, background color, etc. Replace `#00E5FF` with the design system's accent, `Poppins` with its heading/body font, `#000000` with its background.

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

---

## Visual Quality Standards — Anti-AI-Slop Rules

### Blacklisted Patterns (NEVER use these)

- Aggressive purple/blue gradients as primary backgrounds
- Left-border accent cards (the colored left stripe pattern)
- Emoji as icons — always use Tabler icons from `@tabler/icons-react`
- Inline SVG illustrations or hand-drawn SVG imagery
- Inter, Roboto, or Arial as primary fonts — use distinctive typography
- Fake statistics ("87% of users", "3x faster") — only real data
- Fake testimonials or quotes
- Generic stock-photo-style imagery
- Decorative sparkle/glow effects
- Excessive drop shadows or glassmorphism

### Required Quality Checks

- Body text minimum 24px on 1920x1080 slides, 16px on web UI
- "Earn its place" — every element must justify its existence
- Empty space is solved with composition, not filler content
- When you think "adding this would look better" — that is usually a sign of AI slop
- Default to restraint: fewer elements, more whitespace, stronger hierarchy

### Modern CSS Techniques to Use

- `text-wrap: balance` for headings, `text-wrap: pretty` for body
- `oklch()` color space for perceptually uniform color manipulation
- CSS Grid with named areas for complex layouts
- `color-mix()` for dynamic color variants
- Container queries for component-responsive design
- `:has()` selector for parent-based styling

---

## Design Philosophy Reference

When the user's request is vague about visual direction, recommend from these schools:

### Information Architecture School

- **Pentagram**: Grid-first, black/white/red, structured information hierarchy
- **Stamen Design**: Data-driven, cartographic precision, clear visual encoding

### Motion Poetics School

- **Locomotive**: Smooth scroll, parallax depth, cinematic pacing
- **Active Theory**: WebGL experiments, particle systems, immersive 3D
- **Field.io**: Generative art, algorithmic beauty, mathematical precision

### Minimalism School

- **Experimental Jetset**: Swiss typography, geometric forms, pure structure
- **Muller-Brockmann**: Grid systems, objective communication, typographic hierarchy
- **Build**: Reduction to essence, mono-font, pure whitespace

### Eastern Philosophy School

- **Kenya Hara**: Ma (negative space), simplicity as depth, emptiness as design
- **Takram**: Craft meets technology, material honesty, subtle animation

**Key insight**: Describe mood, not layout. Short emotional prompts outperform detailed layout specifications.

---

## Slide Design Patterns

### Batch Production Strategy

Always make 2 showcase slides first to lock the visual grammar before scaling:

1. Generate 2 hero slides (title + key content)
2. Get user approval on the visual language
3. Then produce remaining slides following the established grammar

### Slide Layout Types

- **Title**: Large heading, minimal text, strong visual impact
- **Data**: Charts, numbers, clear data visualization
- **Comparison**: Side-by-side, before/after, pros/cons
- **Timeline**: Sequential events, process flows
- **Quote**: Large pull quote with attribution
- **Gallery**: Image grid with captions
- **Code**: Syntax-highlighted code with annotations

### Typography on Slides

- Heading: 48-72px (1920x1080 canvas)
- Body: 24-32px minimum
- Caption: 18-20px
- Use `font-variation-settings` for weight morphing (if variable font available)
- Two-tier shadow: 1px tight shadow + 8px ambient shadow (never single shadow)

---

## Brand Asset Protocol

When using design system tokens in generated content, follow this hierarchy:

1. Logo > Product Photo > UI Screenshot > Colors > Fonts
2. Always verify brand colors from the design system — never approximate
3. Use design system's `imageStyle.styleDescription` in image generation prompts
4. Reference design system's `typography.headingFont` and `bodyFont`
5. Apply design system's spacing and border tokens consistently

---

## Development

For code editing and development guidance, read `DEVELOPING.md`.
