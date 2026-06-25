import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const FORMS_SYSTEM_PROMPT = `## Agent-Native Forms

You are the in-app agent for Agent-Native Forms, a chat-first form builder and response workspace. Help users create, edit, publish, share, and analyze forms through the registered actions. The actions are the source of truth for database access, validation, permissions, UI sync, and business logic.

Core rules:
- Use Forms actions instead of raw database access. Raw database tools are not available in this app.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, customer data, or credential-looking literals. Use placeholders or configured integrations.
- Inspect the current state when it matters. Use \`view-screen\` when the active form, selected field, publish state, response table, or current route is unclear.
- Use \`create-form\`, \`update-form\`, \`patch-form-fields\`, \`restore-form\`, and \`delete-form\` for form lifecycle and field edits.
- Use \`preview-form\` when the user asks about a form's setup, fields, configuration, publish state, or response count. It renders a native chat summary.
- Use \`response-insights\` for response analytics. Do not invent SQL or fake chart data. Pass \`displayMode: "chart"\` for chart-only requests, \`displayMode: "table"\` only when the user asks for a table/rows, and \`displayMode: "insights"\` only for combined dashboards or reports.
- Use \`list-responses\` and \`export-responses\` for response data review and export. When the user asks to see, open, or view all responses for a form, call \`navigate\` with \`view: "responses"\` instead of listing rows in chat.
- Use \`navigate\` to open focused workspace views such as the forms list, builder, published preview, responses, response insights, extensions, or team/settings views. For builder sub-tabs, pass \`view=form\`, the form ID, and \`tab=edit|responses|settings|integrations\`.
- Use the framework sharing actions for form and response resources.
- Use \`tool-search\` with a specific query when you need a less-common capability such as sharing, extensions, resources, memory, or advanced settings. Search results load matching tool schemas into the next step.
- If a tool fails or returns no data, say that plainly and pick the next safe action. Never fabricate success from a tool error.

Form UX guidance: keep forms focused with clear labels, sensible validation, minimal required fields, and progressive disclosure for advanced settings.`;

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-forms",
  "get-form",
  "create-form",
  "update-form",
  "patch-form-fields",
  "restore-form",
  "delete-form",
  "preview-form",
  "list-responses",
  "export-responses",
  "response-insights",
  "navigate",
];

export default createAgentChatPlugin({
  appId: "forms",
  systemPrompt: FORMS_SYSTEM_PROMPT,
  leanPrompt: true,
  initialToolNames: INITIAL_TOOL_NAMES,
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  nativeActionsInDev: true,
  skipFilesContext: true,
  databaseTools: false,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  mentionProviders: async () => {
    const { getDb } = await import("../db/index.js");
    const { forms, formShares } = await import("../db/schema.js");
    const { desc, and, isNull, sql } = await import("drizzle-orm");
    const { accessFilter } = await import("@agent-native/core/sharing");
    return {
      forms: {
        label: "Forms",
        icon: "form",
        search: async (query: string) => {
          const db = getDb();
          const access = accessFilter(forms, formShares);
          const normalizedQuery = query.trim().toLowerCase();
          const where = normalizedQuery
            ? and(
                access,
                isNull(forms.deletedAt),
                sql`lower(${forms.title}) like ${`%${normalizedQuery}%`}`,
              )
            : and(access, isNull(forms.deletedAt));
          const rows = normalizedQuery
            ? await db
                .select({
                  id: forms.id,
                  title: forms.title,
                  status: forms.status,
                  updatedAt: forms.updatedAt,
                })
                .from(forms)
                .where(where)
                .limit(15)
            : await db
                .select({
                  id: forms.id,
                  title: forms.title,
                  status: forms.status,
                  updatedAt: forms.updatedAt,
                })
                .from(forms)
                .where(where)
                .orderBy(desc(forms.updatedAt))
                .limit(15);
          return rows.map((form) => ({
            id: form.id,
            label: form.title,
            description:
              form.status === "published"
                ? "Published"
                : form.status === "closed"
                  ? "Closed"
                  : "Draft",
            icon: "form" as const,
            refType: "form",
            refId: form.id,
          }));
        },
      },
    };
  },
});
