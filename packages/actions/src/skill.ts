import fs from "node:fs";
import path from "node:path";

export const AGENT_NATIVE_ACTIONS_SKILL_NAME = "agent-native-actions";

export const AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH = path.join(
  ".agents",
  "skills",
  AGENT_NATIVE_ACTIONS_SKILL_NAME,
  "SKILL.md",
);

export const AGENT_NATIVE_ACTIONS_SKILL_MD = `---
name: agent-native-actions
description: Build and maintain backend operations with @agent-native/actions. Use whenever adding a new feature, endpoint, mutation, data fetch, CLI command, or AI tool in this app so UI, HTTP, CLI, MCP, and AI SDKs always share one typed action.
---

# Agent-Native Actions

This repository uses \`@agent-native/actions\` as the single source of truth for application operations.

## Core Rule: Always Build New Capabilities as Actions

When adding any new backend feature, query, mutation, or integration:

1. **Create one file per operation in \`actions/<verb-noun>.ts\`** (for example \`actions/list-deals.ts\`, \`actions/create-invoice.ts\`, \`actions/refund-charge.ts\`).
2. **Do not create parallel ad-hoc \`/api/*\` REST routes, Next.js Server Actions, tRPC procedures, or standalone database scripts** for normal app operations. Put the operation in \`actions/\` so your UI hooks, HTTP API, CLI, MCP server, and AI SDK tools automatically stay in parity.
3. Reserve custom routes only for streaming responses, binary/file uploads, inbound third-party webhooks, OAuth callbacks, or non-JSON endpoints.

## Defining an Action

Use the app's typed \`defineAction\` helper from \`actions/context.ts\` if present (otherwise import \`defineAction\` from \`@agent-native/actions\`):

\`\`\`ts
// actions/list-todos.ts
import { z } from "zod";
import { defineAction } from "./context"; // or "@agent-native/actions"

export default defineAction({
  description: "List todos for the current user",
  schema: z.object({
    done: z.boolean().optional().describe("Filter by completion status"),
  }),
  http: { method: "GET" },
  readOnly: true,
  authorize: (_input, ctx) => Boolean(ctx.user),
  run: async ({ done }, ctx) => {
    return db.todos.findMany({ where: { userId: ctx.user.id, done } });
  },
});
\`\`\`

### Action Authoring Checklist

- **Filename = action name:** \`actions/create-todo.ts\` becomes \`create-todo\`. Subfolders join with hyphens (\`actions/billing/refund.ts\` -> \`billing-refund\`). Prefix shared helpers with \`_\` (\`actions/_shared/db.ts\`) so they are not registered as actions.
- **Describe every field:** Always provide a concise one-line \`description\` and \`.describe(...)\` on schema fields so the CLI \`--help\`, MCP clients, and AI agents know how to call the action.
- **Mark reads explicitly:** Set \`http: { method: "GET" }\` and \`readOnly: true\` on read-only queries. Leave mutations on default \`POST\` (or \`PUT\` / \`DELETE\`).
- **Enforce auth in \`authorize(input, ctx)\`:** Never trust UI hiding. Check \`ctx\` (resolved once in \`actions/context.ts\`) inside \`authorize(input, ctx)\` so HTTP, CLI, MCP, and AI callers all go through the same check.
- **Gate sensitive writes with \`needsApproval\`:** For destructive, irreversible, or high-value mutations (deleting data, issuing refunds, sending external emails), set \`needsApproval: true\` or \`needsApproval: (input, ctx) => ...\` and \`destructive: true\`.
- **Throw structured errors with \`fail()\` or \`defineActionErrors()\`:** Never throw bare strings or swallow errors into fake empty results. Use \`fail("Invoice not found", { statusCode: 404, errorCode: "not_found" })\`.
- **Hide internal-only actions from external agents when needed:** Set \`mcpTool: false\` (or \`agentTool: false\`) on UI-only or internal admin operations.

## Calling Actions from UI Code

Use the typed client hooks for this repo's framework — never hand-write \`fetch("/api/...")\` calls for actions:

- **React / Next.js:** \`useActionQuery("list-todos", { done: false })\` and \`useActionMutation("create-todo")\` from \`@agent-native/actions/react\` (or \`@agent-native/actions/next\`)
- **SolidJS:** \`createActionQuery\` / \`createActionMutation\` from \`@agent-native/actions/solid\`
- **Vue / Nuxt:** \`useActionQuery\` / \`useActionMutation\` from \`@agent-native/actions/vue\`
- **Svelte 5 / SvelteKit:** \`createActionQuery\` / \`createActionMutation\` from \`@agent-native/actions/svelte\`
- **Plain TypeScript:** \`createActionClient()\` from \`@agent-native/actions/client\`

Mutations automatically invalidate related queries so views stay fresh without manual query-key plumbing.

## Regenerating Types & Verifying via CLI

After adding or changing actions:

1. Regenerate \`.generated/actions.ts\` and \`.generated/action-types.d.ts\` if the dev server is not running:
   \`\`\`bash
   npx @agent-native/actions generate
   \`\`\`
2. Verify discovery and execution through the CLI:
   \`\`\`bash
   pnpm action --list
   pnpm action <action-name> --help
   pnpm action <action-name> '{"key":"value"}'
   \`\`\`
`;

export interface InstallActionsSkillOptions {
  projectRoot: string;
  dryRun?: boolean;
  overwrite?: boolean;
}

export interface InstallActionsSkillResult {
  filePath: string;
  relativePath: string;
  status: "created" | "updated" | "skipped" | "would-create" | "would-update";
}

export function installActionsSkill(
  options: InstallActionsSkillOptions,
): InstallActionsSkillResult {
  const filePath = path.join(
    options.projectRoot,
    AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH,
  );
  const exists = fs.existsSync(filePath);

  if (exists && !options.overwrite) {
    return {
      filePath,
      relativePath: AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH,
      status: "skipped",
    };
  }

  if (options.dryRun) {
    return {
      filePath,
      relativePath: AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH,
      status: exists ? "would-update" : "would-create",
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, AGENT_NATIVE_ACTIONS_SKILL_MD, "utf8");
  return {
    filePath,
    relativePath: AGENT_NATIVE_ACTIONS_SKILL_RELATIVE_PATH,
    status: exists ? "updated" : "created",
  };
}
