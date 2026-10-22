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
    "Sync a collection linked to a GitHub folder now: check the branch for new commits and bring rows up to date. An edited file replaces its page's body, and a deleted file moves its page to Trash. Returns what changed, the commit the rows match, and any problem reading GitHub. followUpFailed names any step after the sync that failed; the sync itself still stands.",
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
    const failed: SyncFollowUp[] = [];
    // A busy sync changed nothing; the run already going reports for itself.
    // A status that can't be read back counts as changed, so readers check.
    const statusChanged =
      sync.state !== "busy" &&
      (await afterSync("status_read", failed, () =>
        readGitHubStatusShown(linked.id),
      )) !== shownBefore;
    if (
      statusChanged ||
      (sync.state !== "unchanged" && sync.state !== "busy")
    ) {
      await afterSync("refresh_signal", failed, () =>
        writeAppState("refresh-signal", { ts: Date.now() }),
      );
    }
    const source = await afterSync("source_read", failed, () =>
      getContentDatabaseSourceSnapshot(database),
    );
    return {
      database: serializeDatabase(database),
      sync,
      statusChanged,
      source,
      followUpFailed: failed,
      summary: [
        githubSyncSummary(linked.sourceName, sync),
        ...failed.map((step) => FOLLOW_UP_FAILED[step]),
      ].join(" "),
    };
  },
  // Everyone reading the collection gets the synced rows and status, not just
  // the caller.
  changeResource: (_input, result) =>
    githubSyncChangedRows(result.sync) || result.statusChanged
      ? documentChangeResource(result.database.documentId)
      : null,
});

type SyncFollowUp = "status_read" | "refresh_signal" | "source_read";

const FOLLOW_UP_FAILED: Record<SyncFollowUp, string> = {
  status_read:
    "Whether the link's status changed couldn't be read, so readers were told to check it again.",
  refresh_signal:
    "Other open tabs couldn't be told about the changes; they show them once they reload.",
  source_read:
    "The link's status couldn't be read after the sync, so source is null; read the collection again for it.",
};

/**
 * The sync has already written its rows, so a failed read or signal after it
 * mustn't report the whole sync as failed. It's named in `failed` instead, so
 * a null source after a failed read isn't mistaken for an unlinked collection.
 */
async function afterSync<T>(
  step: SyncFollowUp,
  failed: SyncFollowUp[],
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.warn(`[sync-github-folder] ${step} failed after the sync`, error);
    failed.push(step);
    return null;
  }
}
