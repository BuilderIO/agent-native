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

## Why

Scripts give the agent callable tools with structured input/output. They keep the agent's chat context clean (no massive code blocks), they're reusable, and they can be tested independently.

## How to Create a Script

Create `scripts/my-script.ts`:

```ts
import { parseArgs, loadEnv, fail, agentChat } from "@agent-native/core";
import { readSetting, writeSetting } from "@agent-native/core/settings";
import { readAppState, writeAppState } from "@agent-native/core/application-state";

export default async function myScript(args: string[]) {
  loadEnv();

  const parsed = parseArgs(args);
  const input = parsed.input;
  if (!input) fail("--input is required");

  // Read/write settings (persistent config)
  const settings = await readSetting("my-settings");
  await writeSetting("my-settings", { ...settings, lastRun: new Date().toISOString() });

  // Read/write app state (ephemeral UI state)
  await writeAppState("processing-status", { status: "done", input });

  agentChat.submit(`Processed ${input}`);
}
```

## How to Run

```bash
pnpm script my-script --input some-value
```

## Script Dispatcher

The default template uses core's `runScript()` in `scripts/run.ts`:

```ts
import { runScript } from "@agent-native/core";
runScript();
```

This is the canonical approach for new apps. Script names must be lowercase with hyphens only (e.g., `my-script`).

## Guidelines

- **One script, one job.** Keep scripts focused on a single operation. The agent composes multiple script calls for complex operations.
- **Use `parseArgs()`** for structured argument parsing. It converts `--key value` pairs to a `Record<string, string>`.
- **Use `loadEnv()`** if the script needs environment variables (API keys, etc.).
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Write results to the database.** Use `writeSetting()` or `writeAppState()` for structured data. The UI will pick up changes via SSE.
- **Use `agentChat.submit()`** to report results or errors back to the agent chat.
- **Import from `@agent-native/core`** — Don't redefine `parseArgs()` or other utilities locally.

## Common Patterns

**API integration script** (e.g., image generation):

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

**Data processing script:**

```ts
import { parseArgs, fail } from "@agent-native/core";
import { readSetting, writeSetting } from "@agent-native/core/settings";

export default async function transform(args: string[]) {
  const parsed = parseArgs(args);
  const key = parsed.key;
  if (!key) fail("--key is required");

  const data = await readSetting(key);
  const result = processData(data);
  await writeSetting(key, result);
}
```

## Troubleshooting

- **Script not found** — Check that the filename matches the command name exactly. `pnpm script foo-bar` looks for `scripts/foo-bar.ts`.
- **Args not parsing** — Ensure args use `--key value` or `--key=value` format. Boolean flags use `--flag` (sets value to `"true"`).
- **Script runs but UI doesn't update** — Make sure you're using core store helpers (`writeSetting`, `writeAppState`) which emit SSE events automatically. Direct SQL writes don't emit events.

## Related Skills

- **storing-data** — Scripts read/write data via core SQL stores and Drizzle ORM
- **delegate-to-agent** — The agent invokes scripts via `pnpm script <name>`
- **real-time-sync** — Database writes from scripts trigger SSE events to update the UI
