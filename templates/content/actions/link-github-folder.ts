import { ActionContractError, defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import type { GitHubLinkBlockedReason } from "../shared/github-source.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  createGitHubSourceLink,
  githubActionError,
  githubPreviewSummary,
  previewGitHubFolder,
  resolveGitHubFolder,
  syncGitHubSource,
  unexpectedSyncFailure,
  type GitHubSyncResult,
} from "./_github-source.js";
import { serializeDatabase } from "./_property-utils.js";

/** Time the first sync gets before the action returns; the rest follows. */
const FIRST_SYNC_BUDGET_MS = 6_000;

const linkGitHubFolderSchema = z
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
    url: z
      .string()
      .min(1)
      .describe(
        "GitHub folder link, like https://github.com/owner/repo/tree/main/docs, or owner/repo for the whole repository",
      ),
    connectionId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "GitHub connection to read through when there is more than one",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "Preview only: report the files, skipped files and columns without linking",
      ),
  })
  .strict()
  .refine(
    (args) => Boolean(args.databaseId) !== Boolean(args.documentId),
    "Provide exactly one databaseId or documentId",
  );

async function linkBlockedReason(
  database: { id: string; systemRole: string | null },
  db: ReturnType<typeof getDb> = getDb(),
): Promise<GitHubLinkBlockedReason | null> {
  if (database.systemRole) return "system-collection";
  const [source] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, database.id))
    .limit(1);
  if (source) return "already-linked";
  const [row] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, database.id),
        isNull(schema.documents.trashedAt),
      ),
    )
    .limit(1);
  return row ? "collection-has-rows" : null;
}

const BLOCKED_MESSAGES: Record<GitHubLinkBlockedReason, string> = {
  "collection-has-rows":
    "This collection already has rows. Link a GitHub folder from a new, empty collection.",
  "already-linked": "This collection is already linked to a source.",
  "system-collection": "This collection can't be linked to a GitHub folder.",
};

function blockedError(blocked: GitHubLinkBlockedReason) {
  return new ActionContractError(BLOCKED_MESSAGES[blocked], {
    errorCode:
      blocked === "collection-has-rows"
        ? "COLLECTION_NOT_EMPTY"
        : blocked === "already-linked"
          ? "SOURCE_ALREADY_LINKED"
          : "COLLECTION_NOT_LINKABLE",
    statusCode: 409,
  });
}

export default defineAction({
  description:
    "Link an empty content collection to a GitHub folder, view only: each Markdown file becomes a row, frontmatter becomes read-only columns, and pushes to the branch arrive on their own. Run with dryRun first to see the file count, skipped files with reasons, and the columns and types the frontmatter becomes.",
  mcpTool: true,
  // It only fills an empty collection, so it never replaces anyone's content.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  agentInputSchema: linkGitHubFolderSchema,
  schema: linkGitHubFolderSchema,
  run: async (args) => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) {
      throw new ActionContractError("Database not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "editor");
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new ActionContractError("Sign in to link a GitHub folder.", {
        errorCode: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }

    const blocked = await linkBlockedReason(database);
    if (blocked && !args.dryRun) throw blockedError(blocked);

    const connectionId = args.connectionId ?? null;
    let resolved: Awaited<ReturnType<typeof resolveGitHubFolder>>;
    let preview: Awaited<ReturnType<typeof previewGitHubFolder>>;
    try {
      resolved = await resolveGitHubFolder({ url: args.url, connectionId });
      preview = await previewGitHubFolder(resolved, connectionId);
    } catch (error) {
      throw githubActionError(error);
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        database: serializeDatabase(database),
        preview,
        canLink: blocked === null,
        blocked: blocked ? BLOCKED_MESSAGES[blocked] : null,
        blockedReason: blocked,
        summary: blocked
          ? BLOCKED_MESSAGES[blocked]
          : `${githubPreviewSummary(preview)} Run again without dryRun to link it.`,
      };
    }

    const sourceId = await createGitHubSourceLink({
      database,
      resolved,
      preview,
      connectionId,
      userEmail,
      // Reading GitHub takes seconds, so someone may have added a row since
      // the check above; this runs again under the collection's lock.
      assertLinkable: async (tx) => {
        const blockedNow = await linkBlockedReason(database, tx);
        if (blockedNow) throw blockedError(blockedNow);
      },
    });
    // The link is saved by now, so anything that fails from here is reported
    // on it rather than thrown, which would leave the caller thinking it failed.
    // A contract error is the exception: the link or its collection went away
    // during the sync, so there's nothing left to report on.
    let sync: GitHubSyncResult;
    try {
      sync = await syncGitHubSource({
        sourceId,
        budgetMs: FIRST_SYNC_BUDGET_MS,
      });
    } catch (error) {
      if (error instanceof ActionContractError) throw error;
      console.warn(
        "[github-source] first sync failed:",
        error instanceof Error ? error.message : String(error),
      );
      sync = unexpectedSyncFailure(new Date().toISOString());
    }
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(
      (error: unknown) => {
        // The change event below still reaches open pages.
        console.warn(
          "[github-source] refresh signal failed:",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    // coercion-ok: the status line reads the link on its own; this is a courtesy copy.
    const source = await getContentDatabaseSourceSnapshot(database).catch(
      () => null,
    );
    return {
      dryRun: false,
      database: serializeDatabase(database),
      preview,
      sync,
      source,
      summary:
        sync.state === "partial"
          ? `Linked ${preview.label}. ${sync.created} of ${preview.markdownFiles} rows are in; the rest follow within about a minute.`
          : sync.state === "error"
            ? `Linked ${preview.label}, but the first sync failed: ${sync.problem?.message ?? "GitHub sync failed."}`
            : `Linked ${preview.label}: ${sync.created} rows from commit ${sync.commitSha?.slice(0, 7) ?? "unknown"}.${sync.problem ? ` ${sync.problem.message}` : ""}`,
    };
  },
  // Everyone reading the collection gets its new rows, not just the caller.
  changeResource: (_input, result) =>
    result.dryRun ? null : documentChangeResource(result.database.documentId),
});
