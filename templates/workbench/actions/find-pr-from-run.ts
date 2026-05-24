/**
 * Find a pull request linked to a given agent-native run via the
 * `workbench_run_pr_links` cross-room table. Returns the most recent link
 * for the run, scoped to the current user / org.
 *
 * The link table is populated when an action authoring a PR also knows the
 * run that authored it (e.g. an "open PR for this run" action). This
 * action's job is the lookup side — the Run Room renders a "Linked PR"
 * card whenever this returns a hit.
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";

export interface FindPrFromRunResult {
  pr: {
    owner: string;
    repo: string;
    number: number;
    linkedAt: string;
  } | null;
}

export default defineAction({
  description:
    "Look up the pull request linked to an agent-native run (if any).",
  schema: z.object({
    runId: z.string().min(1).describe("Run id"),
  }),
  http: { method: "GET" },
  run: async ({ runId }): Promise<FindPrFromRunResult> => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) return { pr: null };

    const db = getDb();
    const orgId = getRequestOrgId();

    // Scope to the user; if there's an org context, also restrict to it so
    // links created inside an org don't leak across personal/org views.
    const conditions = [eq(schema.workbenchRunPrLinks.runId, runId)];
    conditions.push(eq(schema.workbenchRunPrLinks.ownerEmail, userEmail));
    if (orgId) {
      conditions.push(eq(schema.workbenchRunPrLinks.orgId, orgId));
    }

    const [link] = await db
      .select({
        owner: schema.workbenchRunPrLinks.prOwner,
        repo: schema.workbenchRunPrLinks.prRepo,
        number: schema.workbenchRunPrLinks.prNumber,
        linkedAt: schema.workbenchRunPrLinks.linkedAt,
      })
      .from(schema.workbenchRunPrLinks)
      .where(and(...conditions))
      .orderBy(desc(schema.workbenchRunPrLinks.linkedAt))
      .limit(1);

    if (!link) return { pr: null };

    return {
      pr: {
        owner: link.owner,
        repo: link.repo,
        number: link.number,
        linkedAt: link.linkedAt,
      },
    };
  },
});
