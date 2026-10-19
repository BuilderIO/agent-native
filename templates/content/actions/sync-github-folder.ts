import { ActionContractError, defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  githubSyncChangedRows,
  readGitHubStatusShown,
} from "./_github-source-freshness.js";
import {
  githubSyncSummary,
  readLinkedGitHubSource,
  syncGitHubSource,
} from "./_github-source.js";
import { serializeDatabase } from "./_property-utils.js";

const SYNC_BUDGET_MS = 20_000;

const syncGitHubFolderSchema = z
  .object({
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact collection ID from discovery"),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact backing Page ID from discovery"),
  })
  .strict()
  .refine(
    (args) => Boolean(args.databaseId) !== Boolean(args.documentId),
    "Provide exactly one databaseId or documentId",
  );

export default defineAction({
  description:
    "Sync a collection linked to a GitHub folder now: check the branch for new commits and bring rows up to date. An edited file replaces its page's body, and a deleted file moves its page to Trash. Returns what changed, the commit the rows match, and any problem reading GitHub.",
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  agentInputSchema: syncGitHubFolderSchema,
  schema: syncGitHubFolderSchema,
  run: async (args) => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) {
      throw new ActionContractError("Database not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "viewer");
    const linked = await readLinkedGitHubSource(database.id);
    if (!linked) {
      throw new ActionContractError(
        "This collection isn't linked to a GitHub folder.",
        { errorCode: "NOT_GITHUB_LINKED", statusCode: 409 },
      );
    }
    const shownBefore = await readGitHubStatusShown(linked.id);
    const sync = await syncGitHubSource({
      sourceId: linked.id,
      budgetMs: SYNC_BUDGET_MS,
    });
    // A busy sync changed nothing; the run already going reports for itself.
    const statusChanged =
      sync.state !== "busy" &&
      (await readGitHubStatusShown(linked.id)) !== shownBefore;
    if (
      statusChanged ||
      (sync.state !== "unchanged" && sync.state !== "busy")
    ) {
      await writeAppState("refresh-signal", { ts: Date.now() });
    }
    return {
      database: serializeDatabase(database),
      sync,
      statusChanged,
      source: await getContentDatabaseSourceSnapshot(database),
      summary: githubSyncSummary(linked.sourceName, sync),
    };
  },
  // Everyone reading the collection gets the synced rows and status, not just
  // the caller.
  changeResource: (_input, result) =>
    githubSyncChangedRows(result.sync) || result.statusChanged
      ? documentChangeResource(result.database.documentId)
      : null,
});
