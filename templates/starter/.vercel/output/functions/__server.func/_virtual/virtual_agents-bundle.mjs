const e={agentsMd:'# {{APP_NAME}} — Agent Guide\n\nThis app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you\'re looking at via application state. See the root AGENTS.md for full framework documentation.\n\nThis is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with polling for real-time sync.\n\n## Resources\n\nResources are SQL-backed persistent files for storing notes, learnings, and context.\n\n**At the start of every conversation, read these resources (both personal and shared scopes):**\n\n1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.\n2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.\n\n**Update `LEARNINGS.md` when you learn something important.**\n\n### Resource scripts\n\n| Action            | Args                                           | Purpose                 |\n| ----------------- | ---------------------------------------------- | ----------------------- |\n| `resource-read`   | `--name <name> [--scope personal\\|shared]`     | Read a resource         |\n| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |\n| `resource-list`   | `[--scope personal\\|shared]`                   | List all resources      |\n| `resource-delete` | `--name <name> [--scope personal\\|shared]`     | Delete a resource       |\n\n## Application State\n\nEphemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.\n\n| State Key    | Purpose                                   | Direction                  |\n| ------------ | ----------------------------------------- | -------------------------- |\n| `navigation` | Current view                              | UI -> Agent (read-only)    |\n| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |\n\n## Agent Operations\n\nThe current screen state is automatically included with each message as a `<current-screen>` block. You don\'t need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation.\n\n**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template\'s root before running any action:\n\n```bash\ncd templates/starter && pnpm action <name> [args]\n```\n\n`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.\n\n### Actions\n\n| Action        | Args                              | Purpose                         |\n| ------------- | --------------------------------- | ------------------------------- |\n| `view-screen` |                                   | See current UI state            |\n| `navigate`    | `--view <name>` or `--path <url>` | Navigate the UI                 |\n| `hello`       | `[--name <name>]`                 | Example script                  |\n| `db-schema`   |                                   | Show all tables, columns, types |\n| `db-query`    | `--sql "SELECT ..."`              | Run a SELECT query              |\n| `db-exec`     | `--sql "INSERT ..."`              | Run INSERT/UPDATE/DELETE        |\n\n## Skills\n\n| Skill                 | When to read                                                   |\n| --------------------- | -------------------------------------------------------------- |\n| `storing-data`        | Before storing or reading any app state                        |\n| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |\n| `actions`             | Before creating or modifying scripts                           |\n| `self-modifying-code` | Before editing source, components, or styles                   |\n| `frontend-design`     | Before building or restyling any UI component, page, or layout |\n\n## When Adding Features\n\nAs you build out this app, follow this checklist for each new feature:\n\n1. **Add navigation state entries** -- extend `use-navigation-state.ts` to track new routes\n2. **Enhance view-screen** -- make the view-screen script return relevant context for the new view\n3. **Create domain scripts** -- add scripts for CRUD operations on new data models\n4. **Create domain skills** -- add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations\n5. **Update this AGENTS.md** -- add the new scripts, state keys, and common tasks\n\n### Authentication\n\nAuth is automatic and environment-driven:\n\n- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.\n- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts.\n\nUse `getSession(event)` server-side and `useSession()` client-side.\n\n### UI Components\n\n**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.\n\n**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.\n\n**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.\n\n---\n\nFor code editing and development guidance, read `DEVELOPING.md`.\n',workspaceAgentsMd:``,skills:{actions:{meta:{name:`actions`,description:`How to create and run agent-callable actions in actions/. Use when creating a new action, adding an API integration, implementing a complex agent operation, or running pnpm action commands.`},content:`---
name: actions
description: >-
  How to create and run agent-callable actions in actions/. Use when creating
  a new action, adding an API integration, implementing a complex agent
  operation, or running pnpm action commands.
---

# Agent Actions

## Rule

Complex operations the agent needs to perform are implemented as actions in \`actions/\`. The agent runs them via \`pnpm action <name>\`.

## Why

Actions give the agent callable tools with structured input/output. They keep the agent's chat context clean (no massive code blocks), they're reusable, and they can be tested independently.

## How to Create an Action

Create \`actions/my-action.ts\`:

\`\`\`ts
import fs from "fs";
import { parseArgs, loadEnv, fail, agentChat } from "@agent-native/core";

export default async function myAction(args: string[]) {
  loadEnv();

  const parsed = parseArgs(args);
  const input = parsed.input;
  if (!input) fail("--input is required");

  const outputPath = parsed.output ?? "data/result.json";
  const raw = fs.readFileSync(input, "utf-8");
  const data = JSON.parse(raw) as unknown;

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  agentChat.submit(\`Processed \${input}, result saved to \${outputPath}\`);
}
\`\`\`

### Using \`defineAction\` with Zod schema (recommended for new actions)

\`\`\`ts
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Process some data",
  schema: z.object({
    input: z.string().describe("Input file path"),
    output: z.string().optional().describe("Output file path"),
  }),
  run: async (args) => {
    // args is fully typed: { input: string; output?: string }
    // do work
    return "Done";
  },
});
\`\`\`

The \`schema\` field accepts a Zod schema (or any Standard Schema-compatible library). It provides runtime validation with clear error messages, TypeScript type inference for \`run()\` args, and auto-generated JSON Schema for the agent's tool definition. \`zod\` is a dependency of all templates.

The legacy \`parameters\` field (plain JSON Schema object) still works as a fallback.

## How to Run

\`\`\`bash
pnpm action my-action --input data/source.json --output data/result.json
\`\`\`

## Action Dispatcher

The default template uses core's \`runScript()\` in \`actions/run.ts\`:

\`\`\`ts
import { runScript } from "@agent-native/core";
runScript();
\`\`\`

This is the canonical approach for new apps. Action names must be lowercase with hyphens only (e.g., \`my-action\`).

## Guidelines

- **One action, one job.** Keep actions focused on a single operation. The agent composes multiple action calls for complex operations.
- **Use \`parseArgs()\`** for structured argument parsing. It converts \`--key value\` pairs to a \`Record<string, string>\`.
- **Use \`loadEnv()\`** if the action needs environment variables (API keys, etc.).
- **Use \`fail()\`** for user-friendly error messages (exits with message, no stack trace).
- **Write results to the database.** The agent and UI will pick them up via db sync polling.
- **Use \`agentChat.submit()\`** to report results or errors back to the agent chat.
- **Import from \`@agent-native/core\`** -- Don't redefine \`parseArgs()\` or other utilities locally.

## Common Patterns

**API integration action** (e.g., image generation):

\`\`\`ts
import fs from "fs";
import { parseArgs, loadEnv, fail } from "@agent-native/core";

export default async function generateImage(args: string[]) {
  loadEnv();
  const parsed = parseArgs(args);
  const prompt = parsed.prompt;
  if (!prompt) fail("--prompt is required");

  const outputPath = parsed.output ?? "data/generated-image.png";
  const imageUrl = await callImageAPI(prompt);
  const buffer = await fetch(imageUrl).then((r) => r.arrayBuffer());
  fs.writeFileSync(outputPath, Buffer.from(buffer));
}
\`\`\`

**Data processing action:**

\`\`\`ts
import fs from "fs";
import { parseArgs, fail } from "@agent-native/core";

export default async function transform(args: string[]) {
  const parsed = parseArgs(args);
  const source = parsed.source;
  if (!source) fail("--source is required");

  const data = JSON.parse(fs.readFileSync(source, "utf-8")) as unknown[];
  const result = data.map(transformItem);
  fs.writeFileSync(source, JSON.stringify(result, null, 2));
}
\`\`\`

## Troubleshooting

- **Action not found** -- Check that the filename matches the command name exactly. \`pnpm action foo-bar\` looks for \`actions/foo-bar.ts\`.
- **Args not parsing** -- Ensure args use \`--key value\` or \`--key=value\` format. Boolean flags use \`--flag\` (sets value to \`"true"\`).
- **Action runs but UI doesn't update** -- Make sure results are written to the database so db sync polling picks them up.

## Related Skills

- **storing-data** -- Actions read/write data via SQL
- **delegate-to-agent** -- The agent invokes actions via \`pnpm action <name>\`
- **real-time-sync** -- Database writes from actions trigger poll events to update the UI
`,dir:`.agents/skills/actions`,extraFiles:[]},"capture-learnings":{meta:{name:`capture-learnings`,description:`Capture and apply accumulated knowledge in learnings.md. Use when the user corrects a mistake, when debugging reveals unexpected behavior, or when an architectural decision should be recorded for future reference.`},content:`---
name: capture-learnings
description: >-
  Capture and apply accumulated knowledge in learnings.md. Use when the user
  corrects a mistake, when debugging reveals unexpected behavior, or when an
  architectural decision should be recorded for future reference.
user-invocable: false
---

# Capture Learnings

This is background knowledge, not a slash command. Read \`learnings.md\` before starting significant work. Update it when you discover something worth remembering.

## When to Capture

Use judgment, not rules. Capture when:

- **Surprising behavior** — Something didn't work as expected and you figured out why
- **Repeated friction** — You hit the same issue twice; write it down so there's no third time
- **Architectural decisions** — Why something is done a certain way (the "why" isn't in the code)
- **API/library quirks** — Undocumented behavior, version-specific gotchas
- **Performance insights** — What's slow and what fixed it

Don't capture:

- Things that are obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes

## Format

Add entries to \`learnings.md\` at the project root. Match the existing format — typically a heading per topic with a brief explanation:

\`\`\`markdown
## [Topic]

[What you learned and why it matters. Keep it to 2-3 sentences.]
\`\`\`

## Graduation

When a learning is referenced repeatedly, it's outgrowing \`learnings.md\`. Propose adding it to the relevant skill or creating a new skill via \`create-skill\`.

- Updating \`learnings.md\` is a Tier 1 modification (data — auto-apply)
- Updating a SKILL.md based on learnings is Tier 2 (source — verify after)

## Related Skills

- **self-modifying-code** — Learnings.md updates are Tier 1; skill updates are Tier 2
- **create-skill** — When a learning graduates, create a skill from it
`,dir:`.agents/skills/capture-learnings`,extraFiles:[]},"create-skill":{meta:{name:`create-skill`,description:`How to create new skills for an agent-native app. Use when adding a new skill, documenting a pattern the agent should follow, or creating reusable guidance for the agent.`},content:`---
name: create-skill
description: >-
  How to create new skills for an agent-native app. Use when adding a new
  skill, documenting a pattern the agent should follow, or creating reusable
  guidance for the agent.
---

# Create a Skill

## When to Use

Create a new skill when:

- There's a pattern the agent should follow repeatedly
- A workflow needs step-by-step guidance
- You want to scaffold files from a template

Don't create a skill when:

- The guidance already exists in another skill (extend it instead)
- You're documenting something the agent already knows (e.g., how to write TypeScript)
- The guidance is a one-off — put it in \`AGENTS.md\` or \`learnings.md\` instead

## 5-Question Interview

Before writing the skill, answer these:

1. **What should this skill enable?** — The core purpose in one sentence.
2. **Which agent-native rule does it serve?** — Rule 1 (files), Rule 2 (delegate), Rule 3 (scripts), Rule 4 (SSE), Rule 5 (self-modify), or "utility."
3. **When should it trigger?** — Describe the situations in natural language. Be slightly pushy — over-triggering is better than under-triggering.
4. **What type of skill?** — Pattern, Workflow, or Generator (see templates below).
5. **Does it need supporting files?** — References (read-only context) or none. Keep it minimal.

## Skill Types and Templates

### Pattern (architectural rule)

For documenting how things should be done:

\`\`\`markdown
---
name: my-pattern
description: >-
  [Under 40 words. When should this trigger?]
---

# [Pattern Name]

## Rule

[One sentence: what must be true]

## Why

[Why this rule exists]

## How

[How to follow it, with code examples]

## Don't

[Common violations]

## Related Skills

[Which skills compose with this one]
\`\`\`

### Workflow (step-by-step)

For multi-step implementation tasks:

\`\`\`markdown
---
name: my-workflow
description: >-
  [Under 40 words. When should this trigger?]
---

# [Workflow Name]

## Prerequisites

[What must be in place first]

## Steps

[Numbered steps with code examples]

## Verification

[How to confirm it worked]

## Troubleshooting

[Common issues and fixes]

## Related Skills
\`\`\`

### Generator (scaffolding)

For creating files from templates:

\`\`\`markdown
---
name: my-generator
description: >-
  [Under 40 words. When should this trigger?]
---

# [Generator Name]

## Usage

[How to invoke — what args/inputs are needed]

## What Gets Created

[List of files and their purpose]

## Template

[The template content with placeholders]

## After Generation

[What to do next — wire up SSE, add routes, etc.]

## Related Skills
\`\`\`

## Naming Conventions

- Hyphen-case only: \`[a-z0-9-]\`, max 64 characters
- Pattern skills: descriptive names (\`storing-data\`, \`delegate-to-agent\`)
- Workflow/generator skills: verb-noun (\`create-script\`, \`capture-learnings\`)

## Tips

- **Keep descriptions under 40 words** — They're loaded into context on every conversation.
- **Keep SKILL.md under 500 lines** — Move detailed content to \`references/\` files.
- **Use standard markdown headings** — No XML tags or custom formats.

## Anti-Patterns

- **Inline LLM calls** — Skills must not call LLMs directly (violates Rule 2)
- **Database patterns** — Skills must not introduce databases (violates Rule 1)
- **Ignoring db sync** — If a skill creates data, mention wiring up \`useDbSync\`
- **Vague descriptions** — "Helps with development" won't trigger. Be specific about _when_.
- **Pure documentation** — Skills should guide action, not just explain concepts

## File Structure

\`\`\`
.agents/skills/my-skill/
├── SKILL.md              # Main skill (required)
└── references/           # Optional supporting context
    └── detailed-guide.md
\`\`\`

## Related Skills

- **capture-learnings** — When a learning graduates to reusable guidance, create a skill
- **self-modifying-code** — The agent can create new skills (Tier 2 modification)
`,dir:`.agents/skills/create-skill`,extraFiles:[]},"delegate-to-agent":{meta:{name:`delegate-to-agent`,description:`How to delegate all AI work to the agent chat. Use when delegating AI work from UI or scripts to the agent, when tempted to add inline LLM calls, or when sending messages to the agent from application code.`},content:`---
name: delegate-to-agent
description: >-
  How to delegate all AI work to the agent chat. Use when delegating AI work
  from UI or scripts to the agent, when tempted to add inline LLM calls, or
  when sending messages to the agent from application code.
---

# Delegate All AI to the Agent

## Rule

The UI and server never call an LLM directly. All AI work is delegated to the agent through the chat bridge.

## Why

The agent is the single AI interface. It has context about the full project, can read/write the database, and can run scripts. Inline LLM calls bypass this — they create a shadow AI that doesn't know what the agent knows and can't coordinate with it.

## How

**From the UI (client):**

\`\`\`ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Generate a summary of this document",
  context: documentContent, // optional hidden context (not shown in chat UI)
  submit: true, // auto-submit to the agent
});
\`\`\`

**From scripts (Node):**

\`\`\`ts
import { agentChat } from "@agent-native/core";

agentChat.submit("Process the uploaded images and create thumbnails");
\`\`\`

**From the UI, detecting when agent is done:**

\`\`\`ts
import { useAgentChatGenerating } from "@agent-native/core";

function MyComponent() {
  const isGenerating = useAgentChatGenerating();
  // Show loading state while agent is working
}
\`\`\`

## \`submit\` vs Prefill

The \`submit\` option controls whether the message is sent automatically or placed in the chat input for user review:

| \`submit\` value | Behavior                                | Use when                                                                            |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| \`true\`         | Auto-submits to the agent immediately   | Routine operations the user has already approved                                    |
| \`false\`        | Prefills the chat input for user review | High-stakes operations (deleting data, modifying code, API calls with side effects) |
| omitted        | Uses the project's default setting      | General-purpose delegation                                                          |

\`\`\`ts
// Auto-submit: routine operation
sendToAgentChat({ message: "Update the project summary", submit: true });

// Prefill: let user review before sending
sendToAgentChat({
  message: "Delete all projects older than 30 days",
  submit: false,
});
\`\`\`

## Capture user input first when generating from a prompt

Buttons that produce new content ("New Design", "Create Dashboard", "Make Deck", "Generate Form") need the user's prompt as input. **Never hardcode a generic message** — the result will be a generic generation the user didn't actually ask for.

**Bad** — auto-submits a placeholder message; the user never said what they wanted:

\`\`\`tsx
<Button
  onClick={() =>
    sendToAgentChat({ message: "make a design", submit: true })
  }
>
  New Design
</Button>
\`\`\`

**Good** — Popover anchored to the button captures the prompt, then submits it:

\`\`\`tsx
<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button>New Design</Button>
  </PopoverTrigger>
  <PopoverContent className="w-96">
    <Textarea
      autoFocus
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      placeholder="What do you want to design?"
    />
    <Button
      onClick={() => {
        sendToAgentChat({ message: prompt, submit: true });
        setOpen(false);
        setPrompt("");
      }}
    >
      Create
    </Button>
  </PopoverContent>
</Popover>
\`\`\`

**Always ask for input first when** the output depends on a prompt the user must provide — "design what?", "deck about what?", "dashboard for which metric?", "form for which use case?".

**Auto-submit without input is fine when intent is unambiguous:**

- "Try to fix" on a tool error — submits the error details with a clear fix instruction
- "Retry the last operation" after a transient failure
- Single-purpose buttons where there is nothing meaningful for the user to add

If you find yourself writing \`submit: true\` with a hardcoded creative verb (\`"design a..."\`, \`"write a..."\`, \`"build a..."\`), stop and add a Popover.

## Don't

- Don't \`import Anthropic from "@anthropic-ai/sdk"\` in client or server code
- Don't \`import OpenAI from "openai"\` in client or server code
- Don't make direct API calls to any LLM provider
- Don't use AI SDK functions like \`generateText()\`, \`streamText()\`, etc.
- Don't build "AI features" that bypass the agent chat
- Don't auto-submit a hardcoded prompt for generative actions — capture user input first (see above)

## Exception

Scripts may call external APIs (image generation, search, etc.) — but the AI reasoning and orchestration still goes through the agent. A script is a tool the agent uses, not a replacement for the agent.

## Related Skills

- **scripts** — The agent invokes scripts via \`pnpm action <name>\` to perform complex operations
- **self-modifying-code** — The agent operates through the chat bridge to make code changes
- **storing-data** — The agent writes results to the database after processing requests
- **real-time-sync** — The UI updates automatically when the agent writes to the database
`,dir:`.agents/skills/delegate-to-agent`,extraFiles:[]},"frontend-design":{meta:{name:`frontend-design`,description:`Create distinctive, production-grade frontend interfaces with high design quality. Use when building web components, pages, artifacts, posters, or applications (websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished UI that avoids generic AI aesthetics.`},content:`---
name: frontend-design
description: >-
  Create distinctive, production-grade frontend interfaces with high design
  quality. Use when building web components, pages, artifacts, posters, or
  applications (websites, landing pages, dashboards, React components,
  HTML/CSS layouts, or when styling/beautifying any web UI). Generates
  creative, polished UI that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
---

# Frontend Design

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (\`animation-delay\`) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

## Anti-Patterns to Avoid

NEVER use generic AI-generated aesthetics like:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

## Implementation Notes

**Match implementation complexity to the aesthetic vision.** Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

In the agent-native framework context:
- Agent-native apps use React 18, Vite, TailwindCSS, and shadcn/ui
- Custom styles go in component CSS or Tailwind classes — never inline styles
- For complex visual effects, use a \`<style>\` tag in the component or a dedicated CSS file
- Fonts can be loaded from Google Fonts via \`@import\` in a CSS file or \`<link>\` in \`index.html\`
- Animation libraries: prefer CSS transitions and keyframes; use Framer Motion for complex sequences
- All new UI components should be placed in \`app/components/\`

## Related Skills

- **self-modifying-code** — The agent can edit source code to apply design changes
- **storing-data** — Design configuration can be stored in the settings table for agent-editable theming
`,dir:`.agents/skills/frontend-design`,extraFiles:[]},security:{meta:{name:`security`,description:`Data security model, user/org scoping, and auth patterns. Use when adding tables with user data, implementing multi-user features, setting up A2A cross-app calls, or reviewing data access patterns.`},content:`---
name: security
description: >-
  Data security model, user/org scoping, and auth patterns. Use when adding
  tables with user data, implementing multi-user features, setting up A2A
  cross-app calls, or reviewing data access patterns.
---

# Security & Data Scoping

## How Data Isolation Works

In production, the framework enforces data isolation at the SQL level. Agents and users can only see and modify data they own. This is automatic — you don't write WHERE clauses yourself.

### Per-User Scoping (\`owner_email\`)

Every table with user-specific data **must** have an \`owner_email\` text column.

\`\`\`ts
import { table, text, integer } from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  owner_email: text("owner_email").notNull(), // REQUIRED for user data
});
\`\`\`

**What happens automatically:**
- \`db-query\` creates temporary views with \`WHERE owner_email = <current user>\`
- \`db-exec\` INSERT statements get \`owner_email\` auto-injected
- \`db-exec\` UPDATE/DELETE statements are scoped to the current user's rows
- The current user comes from \`AGENT_USER_EMAIL\` (set from the auth session)

### Per-Org Scoping (\`org_id\`)

For multi-user apps where teams share data, add an \`org_id\` column:

\`\`\`ts
export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_email: text("owner_email").notNull(), // who created it
  org_id: text("org_id").notNull(),           // which org it belongs to
});
\`\`\`

When both columns are present, queries are scoped by **both**: \`WHERE owner_email = ? AND org_id = ?\`.

The \`org_id\` comes from \`AGENT_ORG_ID\` which is automatically set from the user's active organization in Better Auth.

### Validation

Run \`pnpm action db-check-scoping\` to verify all tables have proper ownership columns. Use \`--require-org\` for multi-org apps.

## Auth Model

### Better Auth (Default)

The framework uses Better Auth for authentication. It's always on by default — users create an account on first visit.

**Environment variables:**
- \`BETTER_AUTH_SECRET\` — signing key (auto-generated if not set)
- \`GOOGLE_CLIENT_ID\` + \`GOOGLE_CLIENT_SECRET\` — enable Google OAuth
- \`GITHUB_CLIENT_ID\` + \`GITHUB_CLIENT_SECRET\` — enable GitHub OAuth
- \`AUTH_MODE=local\` — disable auth for solo local dev (escape hatch)

### Organizations

Better Auth's organization plugin is built-in. Every app supports:
- Creating organizations
- Inviting members (owner/admin/member roles)
- Switching active organization
- Per-org data scoping via \`org_id\`

The active organization ID flows from \`session.orgId\` → \`AGENT_ORG_ID\` → SQL scoping automatically.

### ACCESS_TOKEN (Legacy)

For simple deployments, set \`ACCESS_TOKEN\` or \`ACCESS_TOKENS\` (comma-separated) as environment variables. This provides a shared token for all users — no per-user identity.

## A2A Security

### Cross-App Identity

When apps call each other via A2A, they need to verify identity. Set the same \`A2A_SECRET\` on all apps that need to trust each other:

\`\`\`bash
# On both apps
A2A_SECRET=your-shared-secret-at-least-32-chars
\`\`\`

**How it works:**
1. App A signs a JWT with \`A2A_SECRET\` containing \`sub: "steve@builder.io"\`
2. App B receives the call, verifies the JWT signature
3. App B sets \`AGENT_USER_EMAIL\` from the verified \`sub\` claim
4. Data scoping applies — App B only shows steve's data

Without \`A2A_SECRET\`, A2A calls are unauthenticated (fine for local dev, not production).

## Rules for Agents

1. **Every new table with user data must have \`owner_email\`.** No exceptions.
2. **Never bypass scoping** — don't raw-query tables without going through \`db-query\`/\`db-exec\`.
3. **Don't expose user data in application state** — application state is per-session, not per-user. Use SQL tables with \`owner_email\` for persistent user data.
4. **Don't hardcode emails** — use \`AGENT_USER_EMAIL\` environment variable.
5. **Test with multiple users** — create two accounts and verify data isolation.
`,dir:`.agents/skills/security`,extraFiles:[]},"self-modifying-code":{meta:{name:`self-modifying-code`,description:`How the agent can modify the app's own source code. Use when the agent needs to edit components, routes, styles, or scripts, when designing UI for agent editability, or when deciding what the agent should and shouldn't modify.`},content:`---
name: self-modifying-code
description: >-
  How the agent can modify the app's own source code. Use when the agent needs
  to edit components, routes, styles, or scripts, when designing UI for agent
  editability, or when deciding what the agent should and shouldn't modify.
---

# Self-Modifying Code

## Rule

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature, not a bug. Design your app expecting this.

## Why

An agent-native app isn't just an app the agent can _use_ — it's an app the agent can _change_. The agent can fix bugs, add features, adjust styles, and restructure code. This makes the agent a true collaborator, not just an operator.

## Modification Taxonomy

Not all modifications are equal. Use this to decide what level of care is needed:

| Tier          | What                  | Examples                                         | After modifying                   |
| ------------- | --------------------- | ------------------------------------------------ | --------------------------------- |
| 1: Data       | Files in \`data/\`      | JSON state, generated content, markdown          | Nothing — these are routine       |
| 2: Source     | App code              | Components, routes, styles, scripts              | Run \`pnpm typecheck && pnpm lint\` |
| 3: Config     | Project config        | \`package.json\`, \`tsconfig.json\`, \`vite.config.*\` | Ask for explicit approval first   |
| 4: Off limits | Secrets and framework | \`.env\`, \`@agent-native/core\` internals           | Never modify these                |

## Git Checkpoint Pattern

Before modifying source code (Tier 2+), create a rollback point:

1. Commit or stash current state
2. Make the edit
3. Run \`pnpm typecheck && pnpm lint\`
4. If verification fails → revert with \`git checkout -- <file>\`
5. If verification passes → continue

This ensures the agent can experiment without breaking the app.

## Designing for Agent Editability

Make your app easy for the agent to understand and modify:

**Expose UI state via \`data-*\` attributes** so the agent knows what's selected:

\`\`\`ts
const el = document.documentElement;
el.dataset.currentView = view;
el.dataset.selectedId = selectedItem?.id || "";
\`\`\`

**Expose richer context via \`window.__appState\`** for complex state:

\`\`\`ts
(window as any).__appState = {
  selectedId: id,
  currentLayout: layout,
  itemCount: items.length,
};
\`\`\`

**Use configuration-driven rendering** — Extract visual decisions (colors, layouts, sizes) into JSON config files in \`data/\`. The agent can modify the config (Tier 1) instead of the component source (Tier 2).

## Don't

- Don't modify \`.env\` files or files containing secrets
- Don't modify \`@agent-native/core\` package internals
- Don't modify \`.agents/skills/\` or \`AGENTS.md\` unless explicitly requested
- Don't skip the typecheck/lint step after editing source code
- Don't make source changes without a git checkpoint to roll back to

## Related Skills

- **storing-data** — Tier 1 modifications (database writes) are the safest and most common
- **scripts** — The agent can create or modify scripts to add new capabilities
- **delegate-to-agent** — Self-modification requests come through the agent chat
- **real-time-sync** — Source edits and database writes trigger SSE events to update the UI
`,dir:`.agents/skills/self-modifying-code`,extraFiles:[]}}};export{e as default};