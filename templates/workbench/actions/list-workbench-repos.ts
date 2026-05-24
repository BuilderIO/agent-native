import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * List repos the current user has added to their Workbench queue.
 *
 * `workbench_repos` is per-user only — there's no shares table, no org
 * fan-out. Scoping is by `ownerEmail === getRequestUserEmail()`.
 *
 * Returned rows are the source the Attention Queue + PR Room use to know
 * "which repos do I pull PRs from?". A user with zero rows sees the empty
 * state and is steered to Settings → Connected repos to add one.
 */
export default defineAction({
  description:
    "List the GitHub repos the current user has added to their Workbench " +
    "queue. Used by Settings → Connected repos and by the Attention Queue / " +
    "PR Room empty states.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to list your Workbench repos.");
    }

    const db = getDb();
    const rows = await db
      .select({
        id: schema.workbenchRepos.id,
        owner: schema.workbenchRepos.owner,
        name: schema.workbenchRepos.name,
        addedAt: schema.workbenchRepos.addedAt,
      })
      .from(schema.workbenchRepos)
      .where(eq(schema.workbenchRepos.ownerEmail, ownerEmail))
      .orderBy(desc(schema.workbenchRepos.addedAt));

    return { repos: rows };
  },
});
