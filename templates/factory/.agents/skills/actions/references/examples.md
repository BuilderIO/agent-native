# Extra Examples, Legacy Pattern, and the Audit Script

Read this for a second worked example beyond the one in SKILL.md, for the
older bare-export action format you may find in existing code, or for the
advisory dead-action audit tool.

## Common Patterns

**Read action (GET):**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "List calendar events",
  schema: z.object({
    from: z.string().describe("Start date"),
    to: z.string().describe("End date"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    return await fetchEvents(args.from, args.to);
  },
});
```

**Write action (POST, default):**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Log a meal",
  schema: z.object({
    name: z.string().describe("Meal name"),
    calories: z.coerce.number().describe("Calorie count"),
  }),
  run: async (args) => {
    // args.calories is a number — z.coerce.number() handles string-to-number conversion from HTTP
    const meal = await insertMeal(args);
    return meal;
  },
});
```

**Agent-only action:**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Navigate the UI to a view",
  schema: z.object({
    view: z.string().describe("Target view"),
  }),
  http: false,
  run: async (args) => {
    await writeAppState("navigate", { command: "go", view: args.view });
    return "Navigated";
  },
});
```

## Legacy `parameters` Field

Before Standard Schema support, `defineAction` took a plain JSON Schema object via `parameters` instead of a Zod `schema`. It still works — the action is still callable — but skips runtime validation and TypeScript inference. Migrate to `schema: z.object({...})` when you touch one of these.

## Legacy Pattern (bare export)

Older actions use a bare async function export with `parseArgs`:

```ts
import { parseArgs, loadEnv, fail } from "@agent-native/core";

export default async function myAction(args: string[]) {
  loadEnv();
  const parsed = parseArgs(args);
  // ...
}
```

This still works but is not auto-exposed as HTTP. Prefer `defineAction` for all new actions.

## Audit Script (Advisory)

`pnpm actions:audit [template ...]` (or `node scripts/audit-template-actions.mjs`) statically scans a template's `actions/` and prints two kinds of suggestions:

1. **Likely UI-dead** — HTTP-exposed mutating actions whose name is never referenced under `app/` (candidates to delete or mark `agentTool: false`).
2. **Likely redundant clusters** — groups like `update-foo-name` / `update-foo-order` that could collapse into one orthogonal `update-foo`.

It is **advisory only**: it always exits 0, never fails CI, and uses conservative heuristics, so expect some false positives (e.g. an action the agent calls but the UI doesn't). Use it as a prompt to review, not a gate.
