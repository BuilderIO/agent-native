import { ActionContractError, defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { githubFolderName } from "../shared/github-source.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import type { DatabaseSetupReceipt } from "./_database-setup-mutation.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import {
  githubActionError,
  githubPreviewSummary,
  previewGitHubFolder,
  readLinkedGitHubSource,
  resolveGitHubFolder,
} from "./_github-source.js";
import { nanoid, serializeDatabase } from "./_property-utils.js";
import createContentDatabase from "./create-content-database.js";
import deleteContentDatabase from "./delete-content-database.js";
import {
  bringInGitHubLink,
  linkPreviewedGitHubFolder,
} from "./link-github-folder.js";

const createGitHubCollectionSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .describe(
        "GitHub folder link, like https://github.com/owner/repo/tree/main/docs, or owner/repo for the whole repository",
      ),
    spaceId: z
      .string()
      .min(1)
      .describe("Exact Content space ID for the new collection"),
    parentId: z
      .string()
      .min(1)
      .nullish()
      .describe("Page to put the collection under; leave out for the space"),
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
      .describe("Preview only: read the folder without making the collection"),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Creation intent key; reuse it unchanged after a lost response",
      ),
  })
  .strict();

export default defineAction({
  description:
    "Make a new collection from a GitHub folder, named after the folder and linked to it view only: each Markdown file becomes a row and pushes to the branch arrive on their own. Run with dryRun first to see the files, skipped files and columns without making anything.",
  mcpTool: true,
  // It only makes a new collection, so it never replaces anyone's content.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  agentInputSchema: createGitHubCollectionSchema,
  schema: createGitHubCollectionSchema,
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new ActionContractError("Sign in to link a GitHub folder.", {
        errorCode: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }
    // The same checks the new collection gets, so a preview doesn't promise
    // a collection the person can't make.
    await resolveContentSpaceAccess(args.spaceId, "contributor");
    if (args.parentId) await assertAccess("document", args.parentId, "editor");

    const connectionId = args.connectionId ?? null;
    let resolved: Awaited<ReturnType<typeof resolveGitHubFolder>>;
    let preview: Awaited<ReturnType<typeof previewGitHubFolder>>;
    try {
      resolved = await resolveGitHubFolder({ url: args.url, connectionId });
      preview = await previewGitHubFolder(resolved, connectionId);
    } catch (error) {
      throw githubActionError(error);
    }
    const title = githubFolderName(preview.location);

    if (args.dryRun) {
      return {
        dryRun: true as const,
        preview,
        title,
        summary: `${githubPreviewSummary(preview)} Run again without dryRun to make the "${title}" collection and link it.`,
      };
    }

    const created = await createContentDatabase.run({
      spaceId: args.spaceId,
      parentId: args.parentId ?? null,
      title,
      idempotencyKey: args.idempotencyKey ?? `github-collection-${nanoid()}`,
    });
    const database = await resolveDatabaseForSourceMutation({
      databaseId: created.database.id,
    });
    if (!database) {
      throw new ActionContractError("The new collection can't be found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    // A retry after a lost response gets back the collection the first try
    // made, which may be linked already.
    const { receipt } = created as { receipt?: DatabaseSetupReceipt };
    const madeEarlier = receipt?.idempotency.result === "replayed";
    const earlierLink = madeEarlier
      ? await readLinkedGitHubSource(database.id)
      : null;
    if (earlierLink && earlierLink.sourceName === preview.label) {
      return {
        dryRun: false as const,
        database: serializeDatabase(database),
        preview,
        title,
        ...(await bringInGitHubLink({
          database,
          preview,
          sourceId: earlierLink.id,
        })),
      };
    }
    let linked: Awaited<ReturnType<typeof linkPreviewedGitHubFolder>>;
    try {
      linked = await linkPreviewedGitHubFolder({
        database,
        resolved,
        preview,
        connectionId,
        userEmail,
      });
    } catch (error) {
      // The collection was made for this folder, so it doesn't stay behind
      // empty when the link can't be saved. One an earlier try made is left
      // alone.
      if (madeEarlier) throw error;
      try {
        await deleteContentDatabase.run({ databaseId: database.id });
      } catch (cleanupError) {
        console.warn(
          "[create-github-collection] could not remove the new collection",
          cleanupError,
        );
      }
      throw error;
    }
    return {
      dryRun: false as const,
      database: serializeDatabase(database),
      preview,
      title,
      ...linked,
    };
  },
  // Everyone reading the new collection gets its rows, not just the caller.
  changeResource: (_input, result) =>
    result.dryRun ? null : documentChangeResource(result.database.documentId),
});
