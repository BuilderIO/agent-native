---
title: "CLI Adapters"
description: "Connect any CLI tool to your agent-native app with a standard adapter interface for discovery and execution."
---

# CLI Adapters

Give your agent structured access to any CLI tool — with discovery, execution, and consistent output handling.

## Overview {#overview}

Agents are great at running CLI commands. But without structure, every script reinvents how to invoke a CLI, check if it's installed, and parse its output.

CLI adapters solve this with a small interface — similar to file sync adapters but for command-line tools. Each adapter wraps a single CLI (`gh`, `ffmpeg`, `stripe`, `aws`) and provides:

- **Discovery** — the agent can list what CLIs are available and what they do
- **Availability checks** — is the CLI installed?
- **Consistent execution** — stdout, stderr, and exit code in a standard format

## The interface {#the-interface}

Every CLI adapter implements `CliAdapter`:

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string; // "gh", "stripe", "ffmpeg"
  description: string; // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

## ShellCliAdapter {#shell-adapter}

For most CLIs, you don't need a custom class. `ShellCliAdapter` wraps any CLI binary with sensible defaults:

```ts
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
});

const ffmpeg = new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
  timeoutMs: 120_000, // 2 min for long encodes
});

const stripe = new ShellCliAdapter({
  command: "stripe",
  description: "Stripe CLI — manage payments, webhooks, and customers",
  env: { STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
});
```

### Options {#shell-adapter-options}

| Option        | Type   | Description                                         |
| ------------- | ------ | --------------------------------------------------- |
| `command`     | string | Binary name or path (required)                      |
| `description` | string | What the CLI does — shown to the agent (required)   |
| `name`        | string | Display name (defaults to `command`)                |
| `env`         | Record | Extra environment variables merged with process.env |
| `cwd`         | string | Working directory (defaults to process.cwd())       |
| `timeoutMs`   | number | Execution timeout (default: 30000)                  |

## Registry {#registry}

The `CliRegistry` collects adapters so the agent can discover what's available at runtime:

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();

cliRegistry.register(
  new ShellCliAdapter({
    command: "gh",
    description: "GitHub CLI — manage repos, PRs, issues, and releases",
  }),
);

cliRegistry.register(
  new ShellCliAdapter({
    command: "ffmpeg",
    description: "Audio/video processing and transcoding",
  }),
);

// List all registered CLIs
cliRegistry.list();
// → [{ name: "gh", ... }, { name: "ffmpeg", ... }]

// List only installed CLIs
await cliRegistry.listAvailable();
// → [{ name: "gh", ... }]  (if ffmpeg isn't installed)

// Get a full summary for agent discovery
await cliRegistry.describe();
// → [{ name: "gh", description: "...", available: true },
//    { name: "ffmpeg", description: "...", available: false }]

// Execute a command
const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
console.log(result?.stdout);
```

## Custom adapters {#custom-adapter}

When you need more than `ShellCliAdapter` provides — custom auth, output parsing, or pre/post processing — implement `CliAdapter` directly:

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";
import { execFile } from "node:child_process";

export class DockerAdapter implements CliAdapter {
  name = "docker";
  description =
    "Docker container management — build, run, and manage containers";

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.execute([
        "info",
        "--format",
        "{{.ServerVersion}}",
      ]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
      execFile(
        "docker",
        args,
        {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "utf-8",
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: (error as any)?.code ?? 0,
          });
        },
      );
    });
  }
}
```

> [!WARNING]
> **Edge and Serverless Compatibility:**
> CLI adapters (both `ShellCliAdapter` and custom adapters using `node:child_process`) rely on Node.js-specific system bindings (`child_process.execFile` or `child_process.spawn`).
> These APIs **do not exist** on edge/worker runtimes (e.g., Cloudflare Workers, Netlify Edge Functions). If you deploy your server routes to these edge presets, executing CLI adapters will throw runtime exceptions. Always ensure CLI adapter endpoints and tasks run in standard Node.js environments (like traditional server containers or serverless Node functions).

## Server route {#server-route}

Expose the registry to the UI via an API route so actions and components can discover and invoke CLIs:

`createServer()` returns an H3 `{ app, router }`. Mount routes on `router` with H3 handlers (`defineEventHandler`, `readBody`, `getRouterParam`):

```ts
// server/index.ts
import { createServer } from "@agent-native/core";
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";
import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
} from "h3";

const { router } = createServer();
const cliRegistry = new CliRegistry();

cliRegistry.register(
  new ShellCliAdapter({
    command: "gh",
    description: "GitHub CLI",
  }),
);

// Discovery endpoint — agent can query this
router.get(
  "/api/cli",
  defineEventHandler(async () => {
    return await cliRegistry.describe();
  }),
);

// Execution endpoint
router.post(
  "/api/cli/:name",
  defineEventHandler(async (event) => {
    const name = getRouterParam(event, "name");
    const adapter = name ? cliRegistry.get(name) : undefined;
    if (!adapter) {
      setResponseStatus(event, 404);
      return { error: "CLI not found" };
    }

    const { args } = await readBody(event);
    return await adapter.execute(args ?? []);
  }),
);
```

## Using from actions {#from-actions}

Actions can use CLI adapters directly for structured access:

```ts
// actions/list-prs.ts
import { defineAction } from "@agent-native/core/server";
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";
import { z } from "zod";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI",
});

export default defineAction({
  description: "List open pull requests via the GitHub CLI.",
  schema: z.object({}),
  async run() {
    if (!(await gh.isAvailable())) {
      throw new Error("GitHub CLI not installed. Run: brew install gh");
    }

    const result = await gh.execute([
      "pr",
      "list",
      "--json",
      "title,url,state",
      "--limit",
      "10",
    ]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "gh pr list failed");
    }

    return JSON.parse(result.stdout);
  },
});
```

Or use CLI adapters directly in a script under `scripts/` — adapters are useful when you want discovery, availability checks, and consistent error handling, but `defineAction` is required when the code runs inside the server action surface. Never call `process.exit` in an action; throw an error instead.
