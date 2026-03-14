# Content Workspace — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.

---

## Architecture

Three pillars. Understand these and you understand the entire app.

```
┌─────────────────────────────────────────────────────────────┐
│                    File System (disk)                        │
│          content/projects/*, *.md, *.json, media/*           │
│                                                              │
│         ┌──── reads/writes ────┐                             │
│         │                      │                             │
│         ▼                      ▼                             │
│   ┌──────────┐          ┌──────────┐                         │
│   │ Frontend │          │  Agent   │                         │
│   │ (React)  │◄────────►│ AI Chat  │  ◄── sendToAgentChat() │
│   └──────────┘          └──────────┘                         │
│         │                      │                             │
│         ▼                      ▼                             │
│   ┌──────────┐          ┌──────────┐                         │
│   │ Backend  │◄────────►│ scripts/ │                         │
│   │(Express) │          │ (CLI)    │                         │
│   └──────────┘          └──────────┘                         │
│                    npm run script --                          │
└─────────────────────────────────────────────────────────────┘
```

### 1. Files as the Database

**Everything stateful is a file on disk** — markdown, JSON, images. The file system _is_ the database.

- User edits a draft in the UI → writes to `content/projects/<slug>/draft.md` → agent reads the same file
- Agent writes a draft via script → writes to the same `draft.md` → UI displays it instantly
- User uploads an image → saved to `content/projects/<slug>/media/` → agent sees it
- Agent generates an image → saved to the same `media/` folder → UI displays it

No sync layer. No webhooks. No database migrations. One source of truth.

**Why this matters:**

- Transparent: all content is human-readable markdown and JSON
- Version controlled: Git tracks every change from both human and agent
- No sync bugs: one source of truth, not two systems to keep aligned
- Portable: projects are just folders
- Debuggable: something wrong? Open the file

**When building new features:** If you need to persist state, save it as a file (JSON, markdown, image). Both the UI and the agent will automatically have access. Don't reach for a database — reach for `fs.writeFileSync`.

### 2. Scripts for Agent Operations

The `scripts/` folder contains standalone TypeScript scripts for operations the agent invokes via the Bash tool. This is the primary way the agent chat executes backend logic.

```bash
npm run script -- generate-image --prompt "..." --model gemini --preset "Hero images"
npm run script -- search-twitter --query "topic" --filter articles
npm run script -- fetch-url-as-markdown --url "https://..."
```

**Key design:** Scripts directly import and reuse core functions from `server/routes/*` rather than making HTTP calls. The UI endpoints and the agent scripts share the exact same implementation — one function, two interfaces.

**Adding a new script:**

1. Create `scripts/my-script.ts`
2. Export: `export default async function main(args: string[]): Promise<void>`
3. Use `parseArgs()` and `camelCaseArgs()` from `scripts/_utils.ts`
4. Output to stdout. It's immediately available as `npm run script -- my-script`

**The agent can also generate scripts on the fly.** If the agent needs a one-off capability, it can write a script, execute it, and clean up. If it's reusable, it keeps and commits the script.

**ACL compatibility:** Commands MUST be a **single line** (no backslash continuations). Use `npm run script --` as the prefix.

### 3. Agent Chat Bridge

The app can trigger agent chat actions from UI interactions via `@agent-native/core`. This lets buttons and workflows delegate to the AI for tasks best done through chat (alt text generation, style enforcement, content rewrites, etc.).

**From browser code (React components):**

```typescript
import {
  sendToAgentChat,
  useAgentChatGenerating,
} from "@agent-native/core/client";

// Auto-submit to the agent
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Hidden context for the agent...",
  submit: true,
});

// Hook for tracking generation state
const [isGenerating, send] = useAgentChatGenerating();
```

**From scripts/CLI (Node.js context):**

```typescript
import { agentChat } from "@agent-native/core";

agentChat.submit("Fix the lint errors", lintOutput);
```

**Use the utilities:**

```typescript
// Client-side (React components)
import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core";

sendToAgentChat({
  message: "Generate alt text for this image",
  context: `Image path: ${imagePath}\nDocument: ${currentFile}`,
  submit: true,
});

// Script-side (CLI scripts)
import { agentChat } from "@agent-native/core";

agentChat.send({
  message: "Fix the lint errors",
  context: lintOutput,
});
```

**Example use cases:**

- Button click → generate alt text for a selected image
- Button click → enforce house style rules on the current document
- Form submit → generate OG description from article content
- Image upload → auto-generate alt text
- Any repetitive AI task that benefits from a pre-wired prompt

**Why this matters:** Instead of building custom AI integrations for each feature, wire a button to `sendToAgentChat()` with the right prompt and context. The AI handles the rest. Each call is isolated with exactly the context it needs — no bloat from unrelated skills or files.

---

## Agent Rules — MANDATORY

These rules are non-negotiable. They exist because of past mistakes.

### Writing

1. **NEVER use emdashes (—).** Use a single dash with spaces `-` instead. No exceptions.

### General

2. **Read LEARNINGS.md before starting any work** in a workspace. It contains evolved preferences and corrections that prevent repeated mistakes.
3. **Update LEARNINGS.md when you receive feedback.** If the user corrects you in chat — a preference, a style choice, a workflow change — immediately add it to LEARNINGS.md so it's captured for future sessions. Don't wait until the end of a task.
4. **Read AGENTS.md rules before starting any task.**
5. **Files are the transfer medium.** When you need to persist or share state between UI and agent, use files. Not in-memory state, not API-only data.
6. **Always use scripts for backend operations.** Never use `curl`, `fetch`, or inline code to call endpoints. Use `npm run script -- <name>`. If a script doesn't exist for what you need, create one.

### Image Generation

6. **Always use scripts for image generation.** Run `npm run script -- generate-image` (single line). Never call the HTTP API directly.
7. **Never generate images without a preset.** Every call MUST include `--preset` with reference images. Images without presets look generic and off-brand. No exceptions.
8. **Always use Gemini** (`--model gemini`) unless the user explicitly asks for a different model.
9. **Preset selection by image type:**
   - Hero images → `--preset "Hero images"`
   - Body/inline/diagram images → `--preset "Diagrams"`
10. **3 variations by default.** Always show all generated images in chat so the user can pick. Use `--count` only if explicitly requested.
11. **When iterating on an image**, always pass the original image as a `--reference-image-paths` argument so the model can see what it's refining. Don't just re-describe — show the image.
12. **Never invent logos.** When an image includes a product logo (Claude, GitHub, VS Code, etc.), use the actual recognizable logo — never a made-up letter or generic icon. If you can't reproduce the exact logo, use the product's commonly recognized text/ASCII representation.
13. **Presets have instructions.** Presets can include an `instructions` field (e.g., "minimal text, mobile-readable"). These are automatically injected into the generation prompt. Respect them.
14. **Reference images inform STYLE only, not content.** The reference images define colors, rendering technique, and composition approach. The blog topic determines the subject matter. Never copy scenes or objects from reference images into the output.

### Displaying Images in Chat

15. **Always show generated images in chat** — don't make the user navigate to see results.
16. **Use the public URL** from `APP_ORIGIN` (run `env | grep APP_ORIGIN`). Never use localhost.
17. **URL pattern:** `${APP_ORIGIN}/api/projects/<slug>/media/<filename>`
18. **Use markdown:** `![description](https://...)`

---

## Tech Stack

- **PNPM** (prefer pnpm)
- **Frontend**: React 18 + React Router 6 (SPA) + TypeScript + Vite + TailwindCSS 3
- **Backend**: Express (integrated with Vite dev server, single port 8080)
- **UI**: Radix UI + TailwindCSS 3 + Lucide React icons
- **Testing**: Vitest

## Project Structure

```
client/                   # React SPA frontend
├── pages/                # Route components (Index.tsx = home)
├── components/ui/        # Pre-built UI component library
├── lib/                  # Utilities
│   └── utils.ts          # cn() helper
├── App.tsx               # App entry + SPA routing
└── global.css            # TailwindCSS 3 theming

server/                   # Express API backend
├── index.ts              # Server setup + route registration
└── routes/               # API handlers (shared with scripts)

scripts/                  # CLI scripts for agent operations
├── run.ts                # Dispatcher (npm run script)
├── _utils.ts             # Shared helpers + agentChat re-export
├── generate-image.ts     # AI image generation
├── search-twitter.ts     # Twitter/X search
└── ...                   # One script per capability

shared/                   # Types shared between client & server
└── api.ts                # API interfaces

content/                  # All persistent state (files = database)
├── projects/             # Workspaces and projects
│   ├── <workspace>/      # e.g. steve/
│   │   ├── <project>/    # e.g. claude-code-for-designers/
│   │   │   ├── .project.json
│   │   │   ├── draft.md
│   │   │   ├── media/
│   │   │   └── resources/
│   │   ├── shared-resources/   # Workspace-level references
│   │   └── LEARNINGS.md        # Workspace preferences & feedback
│   └── ...
└── shared-resources/     # Global references (image presets, etc.)
    ├── image-presets.json
    └── image-references/
```

## Adding Features

Follow this decision tree:

1. **Persistent state?** → Store as a file (markdown, JSON, image). Both UI and agent get access automatically.
2. **External API call?** → Add a server route in `server/routes/`, then add a script in `scripts/` so the agent can use it too.
3. **AI-assisted UI action?** → Wire a button to `sendToAgentChat()` with the right prompt and context.
4. **New page?** → Create in `client/pages/`, add route in `client/App.tsx`.

### New Script

```typescript
// scripts/my-script.ts
import { loadEnv, parseArgs, camelCaseArgs, fail } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log("Usage: npm run script -- my-script --name <value>");
    return;
  }

  const { name } = opts;
  if (!name) fail("--name is required");

  console.log(`Hello, ${name}!`);
}
```

Immediately available: `npm run script -- my-script --name world`

### New API Route

1. Create handler in `server/routes/my-route.ts`
2. Register in `server/index.ts`
3. Optionally add shared types in `shared/api.ts`
4. Add a corresponding script in `scripts/` if the agent needs it

---

## Content Organization

### Projects (`content/projects/<workspace>/<project>/`)

Discrete deliverables: blog posts, articles, campaigns, PRDs. Each has `.project.json`, `draft.md`, `media/`, `resources/`.

### Context Files (the "Files" section)

Every project can have additional files beyond `draft.md` - these appear in the **Files** section of the sidebar. Use these for transcripts, reference material, brainstorm notes, source documents, or any context that informs the draft.

**When editing a draft, always check the project's other files first.** They contain context - meeting transcripts, research notes, prior discussions - that should inform your writing. Don't ask the user to re-explain what's already captured in these files.

**Examples of context files:**

- Meeting transcripts (e.g., `brainstorm-transcript.md`)
- Research notes or competitor analysis
- Source material or reference documents
- Stakeholder feedback

**Adding context files:** Save them as markdown or text files directly in the project folder (alongside `draft.md`). They'll appear automatically in the Files section of the sidebar.

### Shared Resources

- **Global** (`content/shared-resources/`): Image presets, cross-workspace templates
- **Workspace** (`content/projects/<workspace>/shared-resources/`): Style guides, reference material for that workspace

### Workspace Learnings (`LEARNINGS.md`)

Each workspace has a `LEARNINGS.md` file (e.g., `content/projects/steve/LEARNINGS.md`) that tracks preferences, patterns, and feedback-driven learnings.

**This is a living document. Treat it as institutional memory.**

- **Read it before starting any work** in that workspace — it prevents repeating past mistakes.
- **Update it immediately when you receive feedback** — if the user corrects you, add a dated entry.
- **Keep entries concise and actionable** — not a changelog, but a reference guide for future sessions.
- **Format:** Each entry should have a date, category, and the specific learning.

**Example entries:**

```markdown
### 2026-02-24 — Image Generation: Logo Accuracy

Never invent logos. Use actual recognizable logos for real products.

### 2026-02-24 — Hero Images: Simplicity

Hero images should be bold and simple. Minimize text. Must read well on mobile.

### 2026-02-24 — Writing: Opening Pattern

Start with a bold claim or counterintuitive observation, not a question.
```

**What to capture:**

- Style/aesthetic preferences
- Content voice corrections
- Workflow preferences (e.g., "always show 3 image options")
- Things that went wrong and how to avoid them
- Tool usage patterns that work well

---

## Scripts Reference

| Script                  | Key Args                                      | Purpose                                |
| ----------------------- | --------------------------------------------- | -------------------------------------- |
| `generate-image`        | `--prompt, --model, --preset, --project-slug` | AI image generation with style presets |
| `list-image-presets`    | —                                             | Show available presets                 |
| `search-twitter`        | `--query, --filter?`                          | Search Twitter/X                       |
| `get-twitter-article`   | `--tweet-id`                                  | Fetch X Article content                |
| `fetch-url-as-markdown` | `--url`                                       | Convert webpage to markdown            |
| `preview-link`          | `--url`                                       | Get OG metadata                        |
| `list-projects`         | —                                             | List all projects                      |
| `get-file-tree`         | `--project-slug?`                             | Show project file tree                 |
| `read-file`             | `--file-path, --project-slug?`                | Read a file                            |
| `write-file`            | `--file-path, --content, --project-slug?`     | Write a file                           |
| `get-research`          | `--project-slug`                              | Get research data                      |
| `save-research`         | `--project-slug, --data`                      | Save research JSON                     |
| `get-editor-selection`  | —                                             | Get editor text selection              |

Run any script with `--help` for full usage.

---

## UI Guidelines

Follow [UI.md](./UI.md) for aesthetic and component preferences.

## Development Commands

```bash
pnpm dev              # Start dev server (client + server, port 8080)
pnpm build            # Production build
pnpm typecheck        # TypeScript validation
pnpm test             # Run Vitest tests
npm run script -- <name> [--args]   # Run a CLI script
```
