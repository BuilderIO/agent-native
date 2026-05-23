import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * Look up the Workbench-monitored agent run (if any) that produced this PR.
 * Reads `workbench_run_pr_links` — a row is written when a run produces a PR
 * Workbench knows about (the Run Room owns that write). Returns
 * `{ runId: null }` when no link exists rather than a hard error so the UI
 * can render "no linked run" without a broken loading state.
 *
 * This powers the "Linked Run" card on the right rail of `/prs/:owner/:repo/:n`
 * (and the inverse — `find-pr-from-run` — powers the same card on the Run
 * detail surface).
 */
export default defineAction({
  description:
    "Look up the agent run that authored a given PR via " +
    "`workbench_run_pr_links`. Returns `{ runId: null }` when no link " +
    "exists. Used for the 'Linked Run' card on `/prs/:owner/:repo/:n`.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.workbenchRunPrLinks)
      .where(
        and(
          accessFilter(schema.workbenchRunPrLinks, schema.workbenchRunPrLinks),
          eq(schema.workbenchRunPrLinks.prOwner, args.owner),
          eq(schema.workbenchRunPrLinks.prRepo, args.repo),
          eq(schema.workbenchRunPrLinks.prNumber, args.number),
        ),
      )
      .limit(1);

    const link = rows[0];
    if (!link) {
      return { runId: null as string | null, linkedAt: null };
    }
    return {
      runId: link.runId,
      linkedAt: link.linkedAt,
      owner: args.owner,
      repo: args.repo,
      number: args.number,
    };
  },
});
