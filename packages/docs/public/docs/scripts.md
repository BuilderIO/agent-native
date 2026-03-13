# Scripts

`@agent-native/core` provides a script dispatcher and utilities for building agent-callable scripts.

## Script Dispatcher

The script system lets you create scripts that agents can invoke via `pnpm script <name>`. Each script is a TypeScript file that exports a default async function.

```ts
// scripts/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();
```

```ts
// scripts/hello.ts — example script
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(`Hello, ${name ?? "world"}!`);
}
```

```bash
# Run it
pnpm script hello --name Steve
```

## parseArgs(args)

Parse CLI arguments in `--key value` or `--key=value` format:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## Shared Agent Chat

`@agent-native/core` provides an isomorphic chat bridge that works in both browser and Node.js:

```ts
import { agentChat } from "@agent-native/core";

// Auto-submit a message
agentChat.submit("Generate a report for Q4");

// Prefill without submitting
agentChat.prefill("Draft an email to...", contextData);

// Full control
agentChat.send({
  message: "Process this data",
  context: JSON.stringify(data),
  submit: true,
});
```

In the browser, messages are sent via `window.postMessage()`. In Node.js (scripts), they use the `BUILDER_PARENT_MESSAGE:` stdout format that the Electron host translates to postMessage.

## Utility Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `loadEnv(path?)` | `void` | Load .env from project root (or custom path) |
| `camelCaseArgs(args)` | `Record` | Convert kebab-case keys to camelCase |
| `isValidPath(p)` | `boolean` | Validate relative path (no traversal, no absolute) |
| `isValidProjectPath(p)` | `boolean` | Validate project slug (e.g. "my-project") |
| `ensureDir(dir)` | `void` | mkdir -p helper |
| `fail(message)` | `never` | Print error to stderr and exit(1) |

## Firestore Adapter

For apps that need bidirectional file sync across instances, import from `@agent-native/core/adapters/firestore`:

```ts
import { FileSync } from "@agent-native/core/adapters/firestore";

const sync = new FileSync({
  appId: "my-app",
  ownerId: "owner-123",
  contentRoot: "./content",
  getFileCollection: () => db.collection("fusionAppFiles"),
});

await sync.initFileSync();
```

Features: startup sync, real-time Firestore listeners, chokidar file watchers, three-way merge with LCS-based conflict resolution, and `.conflict` sidecar files for unresolvable conflicts.
