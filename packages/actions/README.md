# @agent-native/actions

Define your app's operations once with `defineAction()` and call them everywhere — typed UI hooks (React, SolidJS, Vue, Svelte), HTTP endpoints, a built-in CLI, a Streamable HTTP & `stdio` MCP server, and AI SDK tools (Vercel AI SDK, Anthropic SDK, OpenAI SDK).

Works incrementally in **any** existing app — Next.js, Vite, SolidJS, Vue, Nuxt, SvelteKit, Hono, Express, Fastify, Cloudflare Workers, or plain Node.js.

## Quickstart

```bash
npx @agent-native/actions init
```

Define an action in `actions/create-todo.ts`:

```ts
import { defineAction } from "@agent-native/actions";
import { z } from "zod";
import { db } from "../lib/db";

export default defineAction({
  description: "Create a new todo item",
  schema: z.object({
    title: z.string().describe("What needs to be done"),
  }),
  run: async ({ title }, ctx) => {
    return db.todos.create({ title, userId: ctx.user.id });
  },
});
```

Call it from everywhere:

- **UI Hooks:** `useActionMutation("create-todo")` (React, SolidJS, Vue, Svelte 5)
- **HTTP:** `POST /api/agent-native/actions/create-todo`
- **CLI:** `pnpm action create-todo --title "Ship docs"`
- **MCP:** Streamable HTTP at `/api/agent-native/mcp` or `npx @agent-native/actions mcp`
- **AI SDKs:** `toAiSdkTools()`, `toAnthropicTools()`, `toOpenAiTools()`

## Documentation

Full guides, framework integrations, and auth/migration recipes:
https://agent-native.com/docs/actions-package/?utm_source=npm&utm_medium=referral&utm_content=actions-readme
