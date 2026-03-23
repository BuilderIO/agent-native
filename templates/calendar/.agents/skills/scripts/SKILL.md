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
import { getSetting, putSetting } from "@agent-native/core/settings";

export default async function myScript(args: string[]) {
  loadEnv();

  const parsed = parseArgs(args);
  const input = parsed.input;
  if (!input) fail("--input is required");

  // Read settings from SQL
  const settings = await getSetting("my-settings");

  // Write results to SQL
  await putSetting("my-results", { processed: true, input });

  agentChat.submit(`Processed ${input}, result saved to settings`);
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
- **Write results to SQL.** Use `putSetting()`, `putAppState()`, or Drizzle queries. The UI will pick up changes via SSE.
- **Use `agentChat.submit()`** to report results or errors back to the agent chat.
- **Import from `@agent-native/core`** — Don't redefine `parseArgs()` or other utilities locally.

## Common Patterns

**Reading/writing settings:**

```ts
import { parseArgs, loadEnv, fail } from "@agent-native/core";
import { getSetting, putSetting } from "@agent-native/core/settings";

export default async function updateSettings(args: string[]) {
  loadEnv();
  const parsed = parseArgs(args);
  const timezone = parsed.timezone;
  if (!timezone) fail("--timezone is required");

  const current = await getSetting("calendar-settings") ?? {};
  await putSetting("calendar-settings", { ...current, timezone });
}
```

**Database operations:**

```ts
import { parseArgs, fail } from "@agent-native/core";
import { getDb } from "../server/db/index.ts";
import { bookings } from "../server/db/schema.ts";
import { eq } from "drizzle-orm";

export default async function listBookings(args: string[]) {
  const parsed = parseArgs(args);
  const db = getDb();
  const results = await db.select().from(bookings);
  console.log(JSON.stringify(results, null, 2));
}
```

## Troubleshooting

- **Script not found** — Check that the filename matches the command name exactly. `pnpm script foo-bar` looks for `scripts/foo-bar.ts`.
- **Args not parsing** — Ensure args use `--key value` or `--key=value` format. Boolean flags use `--flag` (sets value to `"true"`).
- **Script runs but UI doesn't update** — Make sure results are written via the settings API or Drizzle, which trigger SSE events.

## Related Skills

- **files-as-database** — Scripts read/write data via SQL helpers
- **delegate-to-agent** — The agent invokes scripts via `pnpm script <name>`
- **sse-file-watcher** — Database writes from scripts trigger SSE events to update the UI
