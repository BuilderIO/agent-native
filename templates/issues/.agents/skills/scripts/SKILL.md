---
name: scripts
description: >-
  How to create and run agent-callable scripts in scripts/. Use when creating
  a new script, adding an API integration, implementing a complex agent
  operation, or running pnpm script commands.
---

# Agent Scripts

## Rule

Complex operations the agent needs to perform are implemented as scripts in `scripts/`. The agent runs them via `pnpm script <name>`.

## How to Create a Script

Create `scripts/my-script.ts`:

```ts
import { parseArgs, output } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "What this script does",
  parameters: {
    type: "object",
    properties: {
      myArg: { type: "string", description: "Description" },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  // Script logic here
  return JSON.stringify(result);
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  output(JSON.parse(result));
}
```

## Guidelines

- **One script, one job.** Keep scripts focused on a single operation.
- **Use `parseArgs()`** from `./helpers.js` for argument parsing.
- **Use `output()`** from `./helpers.js` for structured JSON output.
- **Use `fatal()`** from `./helpers.js` for error messages.

## Related Skills

- **delegate-to-agent** — The agent invokes scripts via `pnpm script <name>`
- **sse-file-watcher** — Database writes from scripts trigger SSE events to update the UI
