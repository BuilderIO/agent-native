import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import {
  archiveDashboard,
  unarchiveDashboard,
} from "../server/lib/dashboards-store";
import { cliBoolean } from "./schema-helpers";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Archive (soft-delete) or restore a saved dashboard by ID. Archived dashboards " +
    "stay in the database but are hidden from dashboard lists. There is no explicit " +
    "restore UI; restore them by running this action with `archived: false`. Use " +
    "this instead of `delete-dashboard` when the user might want the dashboard back " +
    "later — only use a hard delete when the user explicitly asks to remove a " +
    "dashboard permanently.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    archived: cliBoolean
      .optional()
      .default(true)
      .describe(
        "true = archive (default), false = restore an archived dashboard",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const ctx = resolveScope();
    const dash = args.archived
      ? await archiveDashboard(args.id, ctx)
      : await unarchiveDashboard(args.id, ctx);
    if (!dash) {
      throw new Error(
        `Dashboard "${args.id}" not found (or you don't have access).`,
      );
    }
    return {
      id: dash.id,
      name: dash.title,
      archivedAt: dash.archivedAt,
      message: args.archived
        ? `Dashboard "${dash.title}" archived. Ask the agent in chat to restore it if needed.`
        : `Dashboard "${dash.title}" restored.`,
    };
  },
});
