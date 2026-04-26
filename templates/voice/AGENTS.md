# Voice — Agent Guide

Voice is an agent-native voice dictation app inspired by Wispr Flow. The agent and UI are equal partners: every dictation, every snippet, every dictionary term, every style setting is something both the user and the agent can do — via the same actions, against the same SQL database, synced in real time by the framework's polling layer. This guide is how you (the agent) operate inside this app. See the root `AGENTS.md` for the framework-wide rules.

**Naming:** always call the app **"Voice"** and individual sessions **"dictations"** in user-facing strings and agent messages.

**Core philosophy.** Users dictate text via push-to-talk or hands-free mode. The app transcribes speech to text (via Whisper), applies context-aware formatting and style presets, expands snippets, and delivers polished text. The agent assists: manages snippets, tunes style presets, adds dictionary terms for tricky words, reviews dictation history, and helps the user get the most out of voice input.

**Context is automatic.** The current screen state (navigation + dictation metadata) is included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action. Use `view-screen` when you need a refreshed snapshot.

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context like dictation preferences and team settings. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — the app's memory with user preferences, corrections, and patterns. Read both scopes.

**Update `LEARNINGS.md` when you learn something important** — user corrects formatting, shares style preferences, or reveals dictation patterns.

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Architecture

```
+------------------------+     +------------------------+
|  Frontend              |     |  Agent Chat            |
|  (React + Vite)        |<--->|  (AI agent)            |
|                        |     |                        |
|  - Push-to-talk UI     |     |  - calls actions       |
|  - Snippet expansion   |     |  - manages snippets    |
|  - Style settings      |     |  - tunes styles        |
|  - Dictation history   |     |  - delegates AI        |
|  - writes app-state    |     |    via sendToAgent     |
+----------+-------------+     +----------+-------------+
           |                              |
           +-------------+---------------+
                         v
                 +---------------+
                 |  Nitro server |
                 |               |
                 |  actions/     |  <-  auto-mounted at
                 |               |     /_agent-native/actions/:name
                 +-------+-------+
                         |
                         v
                 +---------------+
                 |  SQL Database |
                 |  (Neon/PG/SQL)|
                 +---------------+
```

## Data Sources

All structured data lives in SQL via Drizzle ORM -- dialect-agnostic (Neon Postgres in production, SQLite for local). See `server/db/schema.ts` for full column definitions.

| Table                  | Holds                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `dictations`           | Core resource. Polished text, raw transcript, audio path, app context, style, language, duration.         |
| `dictation_snippets`   | Text expansion shortcuts. Trigger + expansion pairs. Supports personal and team-shared (isTeam flag).     |
| `dictation_dictionary` | Custom vocabulary. Terms Whisper gets wrong, with optional corrections. Auto-learned or manually added.   |
| `dictation_styles`     | Per-category formatting presets. Maps categories (personal_messages, work, email, other) to tone presets. |
| `dictation_stats`      | Daily usage tracking. Words dictated, session count, and streak per day per user.                         |

## Application State

Ephemeral UI state lives in `application_state`, accessed via `readAppState(key)` / `writeAppState(key, value)`.

| State Key         | Purpose                                                          | Direction               |
| ----------------- | ---------------------------------------------------------------- | ----------------------- |
| `navigation`      | Current view + selected IDs                                      | UI -> Agent (read-only) |
| `navigate`        | One-shot navigation command (auto-deleted after UI reads)        | Agent -> UI             |
| `refresh-signal`  | Bump timestamp -- invalidates lists (dictations, snippets, etc.) | Agent -> UI             |
| `dictation-state` | Current dictation session state (recording, paused, idle)        | UI -> Agent (read-only) |
| `selection`       | User's current text selection                                    | UI -> Agent (read-only) |

### Navigation state shape

```json
{
  "view": "home",
  "dictationId": "abc123"
}
```

Views: `home`, `dictation`, `snippets`, `dictionary`, `styles`, `stats`, `settings`.

**Do NOT write to `navigation`** -- it is overwritten by the UI. To navigate, write to `navigate` via the `navigate` action.

## Common Tasks

| User request                               | What to do                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| "What am I looking at?"                    | `pnpm action view-screen`                                                                                     |
| "Show my recent dictations"                | `pnpm action list-dictations --sort=recent --limit=10`                                                        |
| "Search my dictations for 'meeting'"       | `pnpm action list-dictations --search="meeting"`                                                              |
| "Delete this dictation"                    | `pnpm action delete-dictation --id=<id>`                                                                      |
| "Add a snippet for my email signature"     | `pnpm action create-snippet --trigger="@@sig" --expansion="Best regards,\nSteve Sewell\nCEO, Builder.io"`     |
| "Show all my snippets"                     | `pnpm action list-snippets`                                                                                   |
| "Update my signature snippet"              | `pnpm action update-snippet --id=<id> --expansion="New signature text"`                                       |
| "Delete the @@sig snippet"                 | Find id via `list-snippets`, then `pnpm action delete-snippet --id=<id>`                                      |
| "Import these snippets"                    | `pnpm action import-snippets --snippets='[{"trigger":"@@ty","expansion":"Thank you!"}]'`                      |
| "Add 'Kubernetes' to my dictionary"        | `pnpm action add-dictionary-term --term="Kubernetes"`                                                         |
| "Whisper keeps hearing 'cubernettes'"      | `pnpm action add-dictionary-term --term="cubernettes" --correction="Kubernetes" --source=auto`                |
| "Show my dictionary"                       | `pnpm action list-dictionary`                                                                                 |
| "Remove a dictionary term"                 | `pnpm action remove-dictionary-term --id=<id>`                                                                |
| "Make my work messages more formal"        | `pnpm action update-style-settings --category=work_messages --preset=formal`                                  |
| "What are my style settings?"              | `pnpm action get-style-settings`                                                                              |
| "Add a custom prompt for emails"           | `pnpm action update-style-settings --category=email --customPrompt="Use bullet points, keep under 200 words"` |
| "How many words did I dictate this month?" | `pnpm action get-dictation-stats --days=30`                                                                   |
| "Go to snippets page"                      | `pnpm action navigate --view=snippets`                                                                        |
| "Go to settings"                           | `pnpm action navigate --view=settings`                                                                        |

After any mutation (create, update, delete) the actions trigger a UI refresh automatically via `refresh-signal`.

## Actions

**Always use `pnpm action <name>` for all operations.** Actions handle validation, access checks, and refresh signals. Never use raw HTTP or raw SQL for Voice operations.

**Running actions from the frame.** The terminal cwd is the framework root. Always `cd` first:

```bash
cd templates/voice && pnpm action <name> [args]
```

`.env` is loaded automatically.

### Dictations

| Action             | Args                                                                                                   | Purpose                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `list-dictations`  | `[--search] [--language] [--sort recent\|oldest\|longest] [--limit] [--offset]`                        | List dictations with optional filters |
| `create-dictation` | `--text <polished> --rawText <raw> [--audioPath] [--appContext] [--style] [--language] [--durationMs]` | Store a new dictation result          |
| `delete-dictation` | `--id <id>`                                                                                            | Delete a dictation                    |

### Snippets

| Action            | Args                                                                | Purpose                      |
| ----------------- | ------------------------------------------------------------------- | ---------------------------- |
| `list-snippets`   | `[--search] [--teamOnly] [--limit] [--offset]`                      | List text expansion snippets |
| `create-snippet`  | `--trigger <text> --expansion <text> [--isTeam] [--organizationId]` | Create a snippet             |
| `update-snippet`  | `--id <id> [--trigger] [--expansion] [--isTeam]`                    | Update a snippet             |
| `delete-snippet`  | `--id <id>`                                                         | Delete a snippet             |
| `import-snippets` | `--snippets '<json-array>' [--organizationId]`                      | Bulk import snippets         |

### Dictionary

| Action                   | Args                                                      | Purpose                      |
| ------------------------ | --------------------------------------------------------- | ---------------------------- |
| `list-dictionary`        | `[--search] [--source auto\|manual] [--limit] [--offset]` | List custom dictionary terms |
| `add-dictionary-term`    | `--term <word> [--correction] [--source auto\|manual]`    | Add a dictionary term        |
| `remove-dictionary-term` | `--id <id>`                                               | Remove a dictionary term     |

### Style Settings

| Action                  | Args                                                                                | Purpose                              |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `get-style-settings`    |                                                                                     | Get style presets for all categories |
| `update-style-settings` | `--category <cat> [--preset formal\|casual\|very_casual\|excited] [--customPrompt]` | Update a style preset                |

Categories: `personal_messages`, `work_messages`, `email`, `other`.
Presets: `formal`, `casual`, `very_casual`, `excited`.

### Stats

| Action                | Args           | Purpose              |
| --------------------- | -------------- | -------------------- |
| `get-dictation-stats` | `[--days <n>]` | Get usage statistics |

### Navigation + Context

| Action         | Args                                     | Purpose                                     |
| -------------- | ---------------------------------------- | ------------------------------------------- |
| `view-screen`  |                                          | Snapshot of what the user is looking at now |
| `navigate`     | `--view <name> [--dictationId] [--path]` | Navigate the UI                             |
| `refresh-list` |                                          | Bump the `refresh-signal` timestamp         |

## Style Presets

Voice formats dictated text based on the communication context. Each category has a preset that controls tone:

- **formal** -- Professional language, complete sentences, proper grammar. Good for business emails and official communications.
- **casual** -- Relaxed but clear. Good for work chat and friendly emails.
- **very_casual** -- Shorthand, abbreviations, lowercase ok. Good for personal messages, texting style.
- **excited** -- Enthusiastic tone with energy. Good for congratulations, celebrations, hype.

Custom prompts override preset behavior entirely. When set, the custom prompt is sent to the agent for formatting instead of the preset rules.

## Transcription

Voice uses Whisper for speech-to-text. Prefers **Groq** (`whisper-large-v3-turbo` -- 10x faster than OpenAI Whisper, ~$0.04/hr) via `GROQ_API_KEY`, falls back to **OpenAI** (`whisper-1`) via `OPENAI_API_KEY`. At least one key is required.

All AI formatting (applying style presets, expanding snippets, polishing text) goes through the agent chat via `sendToAgentChat`. Do **not** import AI SDKs directly.

## UI Components

- **shadcn/ui only** for all standard patterns.
- **Tabler Icons only** (`@tabler/icons-react`). No other icon libraries. No emojis as icons.
- **Never** use `window.confirm`, `window.alert`, or `window.prompt`. Use shadcn `AlertDialog`.

## Rules

1. **All AI goes through the agent chat.** Call `sendToAgentChat({ background: true, context, message })` from UI or actions. Do not import AI SDKs directly.
2. **Transcription is the one exception.** Whisper runs directly because it takes an audio file, not a prompt.
3. **SQL must be dialect-agnostic.** No SQLite-specific or Postgres-specific functions. Use Drizzle operators only. Use `now()` from `@agent-native/core/db/schema`.
4. **Screen context is auto-included.** Check `<current-screen>` before calling `view-screen`.
5. **Trigger refresh after mutations.** Most actions do this automatically via `writeAppState("refresh-signal", { ts: Date.now() })`.
6. **Scoping.** All list/get actions filter by `ownerEmail`. Write actions verify ownership before mutating.

## Authentication

Auth is automatic and environment-driven:

- **Dev mode.** Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set). Auth middleware auto-mounts.

Use `getSession(event)` server-side and `useSession()` client-side.

## Development

For code editing and development guidance, read `DEVELOPING.md` if present, or the root `AGENTS.md`.
