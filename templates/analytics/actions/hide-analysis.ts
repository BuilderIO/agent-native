import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { hideAnalysis, unhideAnalysis } from "../server/lib/dashboards-store";
import { cliBoolean } from "./schema-helpers";

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

export default defineAction({
  description:
    "Hide or unhide a saved ad-hoc analysis by ID. Hidden analyses stay " +
    "openable by direct link and searchable, but they are omitted from regular " +
    "analysis lists. When an unowned cleanup analysis is unhidden, the current " +
    "user becomes its owner.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
    hidden: cliBoolean
      .optional()
      .default(true)
      .describe("true = hide (default), false = unhide"),
  }),
  run: async (args) => {
    const ctx = resolveScope();
    const analysis = args.hidden
      ? await hideAnalysis(args.id, ctx)
      : await unhideAnalysis(args.id, ctx);
    if (!analysis) {
      throw new Error(
        `Analysis "${args.id}" not found (or you don't have access).`,
      );
    }
    return {
      id: analysis.id,
      name: analysis.name,
      hiddenAt: analysis.hiddenAt,
      hiddenBy: analysis.hiddenBy,
      ownerEmail: analysis.ownerEmail,
      message: args.hidden
        ? `Analysis "${analysis.name}" hidden from regular lists.`
        : `Analysis "${analysis.name}" is visible in regular lists.`,
    };
  },
});
