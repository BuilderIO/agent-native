# Extra Action Examples and Compatibility Patterns

Read this for a second worked example beyond the one in SKILL.md, for the
legacy `parameters` form or CLI-only bare-export action you may find in
existing code.

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
import { defineAction, fail } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";

export default defineAction({
  description: "Navigate the UI to a view or path",
  schema: z.object({
    view: z.string().optional().describe("Target view"),
    path: z.string().optional().describe("URL path to navigate to"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      fail("At least --view or --path is required.", {
        errorCode: "invalid_navigation",
      });
    }
    const navigation: Record<string, string> = {};
    if (args.view) navigation.view = args.view;
    if (args.path) navigation.path = args.path;
    navigation._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", navigation);
    return { message: `Navigating to ${args.view || args.path}` };
  },
});
```

## Legacy `parameters` Field

The older `defineAction` form accepts a JSON Schema object through `parameters`. It still supplies the agent's input schema and infers TypeScript args for supported parameter shapes, but does not provide the Standard Schema validation and transforms of `schema`. Prefer `schema: z.object({...})` for new actions and when updating existing ones.

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

The CLI runner still accepts this function form, but it is CLI-only: it is not registered as an agent tool, does not mount an HTTP endpoint, and has no typed frontend hook. Prefer `defineAction` for actions shared with the agent or UI. See `actions-advanced` for this legacy form and its helpers.
