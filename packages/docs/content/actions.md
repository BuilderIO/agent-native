---
title: "Actions"
description: "Action dispatcher, parseArgs, standard actions, and utility functions for agent-callable operations."
---

# Actions

`@agent-native/core` provides an action dispatcher and utilities for building agent-callable actions.

## Action Dispatcher {#action-dispatcher}

The action system lets you create actions that agents can invoke via `pnpm action <name>`. Each action is a TypeScript file that exports a default async function.

```ts
// actions/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();
```

```ts
// actions/hello.ts — example action
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(`Hello, ${name ?? "world"}!`);
}
```

```bash
# Run it
pnpm action hello --name Steve
```

## parseArgs(args) {#parseargs}

Parse CLI arguments in `--key value` or `--key=value` format:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## Standard actions {#standard-actions}

Every template should include these two actions for [context awareness](/docs/context-awareness):

### view-screen {#view-screen}

Reads the current navigation state, fetches contextual data, and returns a snapshot of what the user sees. The agent should always call this before acting.

```ts
// actions/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = { navigation };

  if (navigation?.view === "inbox") {
    const res = await fetch("http://localhost:3000/api/emails?label=" + navigation.label);
    screen.emailList = await res.json();
  }

  console.log(JSON.stringify(screen, null, 2));
}
```

```bash
pnpm action view-screen
```

### navigate {#navigate}

Writes a one-shot navigation command to application-state. The UI reads it, navigates, and deletes the entry.

```ts
// actions/navigate.ts
import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const parsed = parseArgs(args);
  await writeAppState("navigate", parsed);
  console.log("Navigate command written:", parsed);
}
```

```bash
pnpm action navigate --view inbox --threadId thread-123
```

## Shared Agent Chat {#shared-agent-chat}

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

In the browser, messages are sent via `window.postMessage()`. In Node.js (actions), they use the `BUILDER_PARENT_MESSAGE:` stdout format that the Electron host translates to postMessage.

## Utility Functions {#utility-functions}

| Function | Returns | Description |
|----------|---------|-------------|
| `loadEnv(path?)` | `void` | Load .env from project root (or custom path) |
| `camelCaseArgs(args)` | `Record` | Convert kebab-case keys to camelCase |
| `isValidPath(p)` | `boolean` | Validate relative path (no traversal, no absolute) |
| `isValidProjectPath(p)` | `boolean` | Validate project slug (e.g. "my-project") |
| `ensureDir(dir)` | `void` | mkdir -p helper |
| `fail(message)` | `never` | Print error to stderr and exit(1) |
