import { ActionContractError, defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { GITHUB_PULL_REQUESTS_MAX_ADD_BATCH } from "../shared/github-pull-requests.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import { addGitHubPullRequests } from "./_github-pull-requests-source.js";
import {
  addedPullRequestOutputSchema,
  parsePullRequestLinks,
  pullRequestCollectionOutputSchema,
} from "./create-github-pull-request-collection.js";

const addGitHubPullRequestsSchema = z
  .object({
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact pull request collection ID from discovery"),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact backing Page ID from discovery"),
    urls: z
      .array(z.string().min(1))
      .min(1)
      .max(GITHUB_PULL_REQUESTS_MAX_ADD_BATCH)
      .describe(
        "Pull request links, like https://github.com/owner/repo/pull/12 or owner/repo#12",
      ),
  })
  .strict()
  .refine(
    (args) => Boolean(args.databaseId) !== Boolean(args.documentId),
    "Provide exactly one databaseId or documentId",
  );

export default defineAction({
  description:
    "Add pull requests by link to a GitHub pull request collection, and get back each one's row. Rows added this way stay after the pull request merges or closes, so a relation to one keeps working. Adding one the collection has already returns its row unchanged, so it's safe to repeat. Only the person who linked the collection can add, since Content reads GitHub with their connection.",
  mcpTool: true,
  // It only adds rows, and adding one twice returns the same row.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  agentInputSchema: addGitHubPullRequestsSchema,
  schema: addGitHubPullRequestsSchema,
  outputSchema: z.object({
    database: pullRequestCollectionOutputSchema,
    pullRequests: z.array(addedPullRequestOutputSchema),
    summary: z.string(),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new ActionContractError("Sign in to add pull requests.", {
        errorCode: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }
    const database = await resolveDatabaseForSourceMutation(
      args.databaseId
        ? { databaseId: args.databaseId }
        : args.documentId
          ? { documentId: args.documentId }
          : {},
    );
    if (!database) {
      throw new ActionContractError("Database not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "editor");
    const refs = parsePullRequestLinks(args.urls);
    const pullRequests = await addGitHubPullRequests({
      databaseId: database.id,
      refs,
      actor: userEmail,
    });
    const created = pullRequests.filter((pr) => pr.created).length;
    return {
      database: {
        id: database.id,
        documentId: database.documentId,
        title: database.title,
      },
      pullRequests,
      summary:
        created > 0
          ? `Added ${created} pull request${created === 1 ? "" : "s"}${created < pullRequests.length ? `; ${pullRequests.length - created} were already in the collection` : ""}.`
          : `All ${pullRequests.length} were already in the collection; they now stay after they merge or close.`,
    };
  },
  // Everyone reading the collection gets its new rows, not just the caller.
  changeResource: (_input, result) =>
    documentChangeResource(result.database.documentId),
});
