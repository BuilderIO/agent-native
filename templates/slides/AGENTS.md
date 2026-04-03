# Slides — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via scripts. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **agent-native** presentation editor built with `@agent-native/core`.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Script            | Args                                           | Purpose                 |
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

**Always run `pnpm script view-screen` first** before taking any action. This shows what the user is looking at and provides deck/slide context. Don't skip this step.

**Always use `pnpm script <name>` for operations** -- never curl or raw HTTP.

### Reading & Searching

| Script        | Args            | Purpose                        |
| ------------- | --------------- | ------------------------------ |
| `view-screen` |                 | See current UI state + context |
| `list-decks`  | `[--compact]`   | List all decks with metadata   |
| `get-deck`    | `--id <deckId>` | Get a deck with all slides     |

### Navigation

| Script     | Args                               | Purpose                  |
| ---------- | ---------------------------------- | ------------------------ |
| `navigate` | `--deckId <id> [--slideIndex <n>]` | Navigate to a deck/slide |
| `navigate` | `--view list`                      | Navigate to deck list    |

### Image Generation

| Script             | Args                                                  | Purpose                     |
| ------------------ | ----------------------------------------------------- | --------------------------- |
| `generate-image`   | `--prompt "..." [--count 3] [--deck-id] [--slide-id]` | Generate images with Gemini |
| `image-search`     | `--query "..." [--count 5]`                           | Search Google Images        |
| `logo-lookup`      | `--domain acme.com`                                   | Get company logo URL        |
| `image-gen-status` |                                                       | Check Gemini API key status |

### Common Tasks

| User request                       | What to do                                                 |
| ---------------------------------- | ---------------------------------------------------------- |
| "What am I looking at?"            | `pnpm script view-screen`                                  |
| "List my decks"                    | `pnpm script list-decks`                                   |
| "Create a new deck about X"        | Create deck via `POST /api/decks`, then navigate to it     |
| "Add a slide about Y"              | Get deck, add slide to data, `PUT /api/decks/:id`          |
| "Generate an image for this slide" | `pnpm script generate-image --prompt "..." --deck-id <id>` |
| "Open deck abc123"                 | `pnpm script navigate --deckId=abc123`                     |
| "Go to the deck list"              | `pnpm script navigate --view=list`                         |
| "Find the company logo for X"      | `pnpm script logo-lookup --domain x.com`                   |

## Slide Styling Rules

All generated slides follow these conventions (see `.agents/skills/slide-editing` for full details):

- **Background**: `bg-[#000000]` (pure black)
- **Font**: `font-family: 'Poppins', sans-serif`
- **Headings**: `font-size: 40px; font-weight: 900; color: #fff`
- **Accent color**: `#00E5FF` (cyan)
- **Image placeholders**: `.fmd-img-placeholder` divs for visual elements

## Agent Chat Integration

The app delegates complex operations to the agent chat via `sendToAgentChat()`. The image generation flow works through the agent chat for conversational follow-up.

## Content Generation: Positioning & Messaging

When generating outbound content (deck slides, marketing copy), consult **`data/builder-positioning.md`** for messaging pillars, personas, competitive positioning, and customer evidence.

## Skills

| Skill                 | When to read                                 |
| --------------------- | -------------------------------------------- |
| `deck-management`     | Before reading/writing deck data             |
| `slide-editing`       | Before editing slide content or layout       |
| `slide-images`        | Before generating or sourcing images         |
| `storing-data`        | Before storing or reading any app state      |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation     |
| `scripts`             | Before creating or modifying scripts         |
| `self-modifying-code` | Before editing source, components, or styles |
| `frontend-design`     | Before building or restyling any UI          |

## API Routes

| Method | Route            | Description       |
| ------ | ---------------- | ----------------- |
| GET    | `/api/decks`     | List all decks    |
| POST   | `/api/decks`     | Create a new deck |
| GET    | `/api/decks/:id` | Get a deck        |
| PUT    | `/api/decks/:id` | Update a deck     |
| DELETE | `/api/decks/:id` | Delete a deck     |

## Development

For code editing and development guidance, read `DEVELOPING.md`.
