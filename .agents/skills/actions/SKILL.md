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

### Using `defineAction` (recommended for new actions)

```ts
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Process some data",
  parameters: {
    input: { type: "string", description: "Input file path" },
    output: { type: "string", description: "Output file path" },
  },
  run: async (args) => {
    // do work
    return "Done";
  },
});
```

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
- **Use `parseArgs()`** for structured argument parsing. It converts `--key value` pairs to a `Record<string, string>`.
- **Use `loadEnv()`** if the action needs environment variables (API keys, etc.).
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Write results to files.** The agent and UI will pick them up via the file watcher.
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
- **Action runs but UI doesn't update** -- Make sure results are written to a path under `data/` that the file watcher monitors.

## Related Skills

- **files-as-database** -- Actions read/write data files in `data/`
- **delegate-to-agent** -- The agent invokes actions via `pnpm action <name>`
- **sse-file-watcher** -- File writes from actions trigger SSE events to update the UI
