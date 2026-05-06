---
name: actions
description: >-
  How to create and run agent-callable actions in actions/. Use when creating
  a new action, adding an API integration, implementing a complex agent
  operation, or running pnpm action commands.
---

# Agent Actions

## Rule

Complex operations the agent needs to perform are implemented as actions in `actions/`. The agent runs them via `pnpm action <name>`.

## Why

Actions give the agent callable tools with structured input/output. They keep the agent's chat context clean (no massive code blocks), they're reusable, and they can be tested independently.

## How to Create an Action

Create `actions/my-action.ts`:

```ts
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
  agentChat.submit(`Processed ${input}, result saved to ${outputPath}`);
}
```

### Using `defineAction` with Zod schema (recommended for new actions)

```ts
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
```

The `schema` field accepts a Zod schema (or any Standard Schema-compatible library). It provides runtime validation with clear error messages, TypeScript type inference for `run()` args, and auto-generated JSON Schema for the agent's tool definition. `zod` is a dependency of all templates.

The legacy `parameters` field (plain JSON Schema object) still works as a fallback.

## How to Run

```bash
pnpm action my-action --input data/source.json --output data/result.json
```

## Action Dispatcher

The default template uses core's `runScript()` in `actions/run.ts`:

```ts
import { runScript } from "@agent-native/core";
runScript();
```

This is the canonical approach for new apps. Action names must be lowercase with hyphens only (e.g., `my-action`).

## Guidelines

- **One action, one job.** Keep actions focused on a single operation. The agent composes multiple action calls for complex operations.
- **Always use `defineAction` with a Zod `schema:`** for input validation. The framework validates automatically and returns clear error messages for invalid input. This prevents malicious or malformed input from reaching your code. The legacy `parseArgs()` format has no runtime validation — use it only for internal/dev scripts, not user-facing actions.
- **Never construct SQL with string concatenation** — use the `db-exec`/`db-query` tools which parameterize queries automatically (`?` placeholders). Drizzle ORM queries are always safe.
- **Use `loadEnv()`** if the action needs environment variables (API keys, etc.).
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Write results to the database.** The agent and UI will pick them up via db sync polling.
- **Use `agentChat.submit()`** to report results or errors back to the agent chat.
- **Import from `@agent-native/core`** -- Don't redefine `parseArgs()` or other utilities locally.

## Common Patterns

**API integration action** (e.g., image generation):

```ts
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
```

**Data processing action:**

```ts
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
```

## Troubleshooting

- **Action not found** -- Check that the filename matches the command name exactly. `pnpm action foo-bar` looks for `actions/foo-bar.ts`.
- **Args not parsing** -- Ensure args use `--key value` or `--key=value` format. Boolean flags use `--flag` (sets value to `"true"`).
- **Action runs but UI doesn't update** -- Make sure results are written to the database so db sync polling picks them up.

## Related Skills

- **storing-data** -- Actions read/write data via SQL
- **delegate-to-agent** -- The agent invokes actions via `pnpm action <name>`
- **real-time-sync** -- Database writes from actions trigger poll events to update the UI
