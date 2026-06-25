import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { hideDashboard, unhideDashboard } from "../server/lib/dashboards-store";
import { cliBoolean } from "./schema-helpers";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Hide or unhide a saved analytics dashboard by ID. Hidden dashboards stay " +
    "openable by direct link and searchable, but they are omitted from regular " +
    "dashboard lists. When an unowned cleanup dashboard is unhidden, the current " +
    "user becomes its owner.",
  schema: z.object({
    id: z.string().describe("The dashboard ID"),
    hidden: cliBoolean
      .optional()
      .default(true)
      .describe("true = hide (default), false = unhide"),
  }),
  run: async (args) => {
    const ctx = resolveScope();
    const dash = args.hidden
      ? await hideDashboard(args.id, ctx)
      : await unhideDashboard(args.id, ctx);
    if (!dash) {
      throw new Error(
        `Dashboard "${args.id}" not found (or you don't have access).`,
      );
    }
    return {
      id: dash.id,
      name: dash.title,
      hiddenAt: dash.hiddenAt,
      hiddenBy: dash.hiddenBy,
      ownerEmail: dash.ownerEmail,
      message: args.hidden
        ? `Dashboard "${dash.title}" hidden from regular lists.`
        : `Dashboard "${dash.title}" is visible in regular lists.`,
    };
  },
});
