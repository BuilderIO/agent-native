import { ActionContractError, defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  DEFAULT_GITHUB_PULL_REQUEST_SEARCH,
  GITHUB_PULL_REQUESTS_MAX_ADD_BATCH,
  parseGitHubPullRequestUrl,
  type GitHubPullRequestRef,
} from "../shared/github-pull-requests.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import type { DatabaseSetupReceipt } from "./_database-setup-mutation.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import {
  addGitHubPullRequests,
  createGitHubPullRequestsLink,
  githubPullRequestsSyncSummary,
  readLinkedGitHubPullRequests,
  syncGitHubPullRequests,
  type AddedGitHubPullRequest,
  type GitHubPullRequestsSyncResult,
} from "./_github-pull-requests-source.js";
import { nanoid } from "./_property-utils.js";
import createContentDatabase from "./create-content-database.js";
import deleteContentDatabase from "./delete-content-database.js";

/** Time the first sync gets before the action returns; the rest follows. */
const FIRST_SYNC_BUDGET_MS = 6_000;

const createGitHubPullRequestCollectionSchema = z
  .object({
    spaceId: z
      .string()
      .min(1)
      .describe("Exact Content space ID for the new collection"),
    parentId: z
      .string()
      .min(1)
      .nullish()
      .describe("Page to put the collection under; leave out for the space"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Collection name; defaults to "Pull requests"'),
    search: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe(
        `GitHub search the rows follow, as on github.com/pulls, like "is:open author:@me" or "repo:owner/name is:open". Defaults to "${DEFAULT_GITHUB_PULL_REQUEST_SEARCH}". An empty string follows no search, so the collection holds only pull requests added by link.`,
      ),
    urls: z
      .array(z.string().min(1))
      .max(GITHUB_PULL_REQUESTS_MAX_ADD_BATCH)
      .optional()
      .describe(
        "Pull request links to add now, like https://github.com/owner/repo/pull/12 or owner/repo#12. They stay after they merge or close.",
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
      .describe("Preview only: check the inputs without making the collection"),
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

/** A pull request's row, as adding by link returns it. */
export const addedPullRequestOutputSchema = z.object({
  url: z.string(),
  key: z.string().describe("owner/repo#number, lowercased"),
  title: z.string(),
  documentId: z.string().describe("The row's page"),
  databaseItemId: z.string(),
  created: z
    .boolean()
    .describe("False when the collection had the row already"),
});

/** The collection, as both actions name it in their results. */
export const pullRequestCollectionOutputSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
});

const syncOutputSchema = z.object({
  state: z.enum(["synced", "busy", "error"]),
  created: z.number(),
  updated: z.number(),
  trashed: z.number(),
  rows: z.number(),
  searchTotal: z.number().nullable(),
  problem: z
    .object({
      code: z.enum([
        "connection",
        "forbidden",
        "rate_limited",
        "too_many_results",
        "unavailable",
      ]),
      message: z.string(),
      at: z.string(),
    })
    .nullable(),
});

const createGitHubPullRequestCollectionOutputSchema = z.discriminatedUnion(
  "dryRun",
  [
    z.object({
      dryRun: z.literal(true),
      title: z.string(),
      search: z.string().nullable(),
      urls: z.array(z.string()),
      summary: z.string(),
    }),
    z.object({
      dryRun: z.literal(false),
      database: pullRequestCollectionOutputSchema,
      title: z.string(),
      search: z.string().nullable(),
      sync: syncOutputSchema,
      added: z.array(addedPullRequestOutputSchema),
      addError: z
        .string()
        .nullable()
        .describe("Why the links weren't added, when they weren't"),
      summary: z.string(),
    }),
  ],
);

/** Reads each link, or fails naming every one that isn't a pull request. */
export function parsePullRequestLinks(urls: readonly string[]) {
  const refs: GitHubPullRequestRef[] = [];
  const invalid: string[] = [];
  for (const url of urls) {
    const ref = parseGitHubPullRequestUrl(url);
    if (ref) refs.push(ref);
    else invalid.push(url);
  }
  if (invalid.length > 0) {
    throw new ActionContractError(
      `Not a GitHub pull request link: ${invalid.join(", ")}. Use a link like https://github.com/owner/repo/pull/12, or owner/repo#12.`,
      { errorCode: "INVALID_PULL_REQUEST_URL", statusCode: 400 },
    );
  }
  return refs;
}

async function hasRows(databaseId: string, db: ReturnType<typeof getDb>) {
  const [row] = await db
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, databaseId),
        isNull(schema.documents.trashedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function hasSource(databaseId: string, db: ReturnType<typeof getDb>) {
  const [source] = await db
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.databaseId, databaseId))
    .limit(1);
  return Boolean(source);
}

/**
 * Brings in the link's first pull requests and any added by link, then says
 * how far it got. The link is saved by now, so a sync that fails is reported
 * on it rather than thrown, which would leave the caller thinking nothing
 * was made.
 */
async function bringInPullRequests({
  database,
  sourceId,
  refs,
  actor,
}: {
  database: typeof schema.contentDatabases.$inferSelect;
  sourceId: string;
  refs: GitHubPullRequestRef[];
  actor: string;
}) {
  let sync: GitHubPullRequestsSyncResult;
  try {
    sync = await syncGitHubPullRequests({
      sourceId,
      budgetMs: FIRST_SYNC_BUDGET_MS,
    });
  } catch (error) {
    if (error instanceof ActionContractError) throw error;
    console.warn(
      "[github-pull-requests] first sync failed:",
      error instanceof Error ? error.message : String(error),
    );
    sync = {
      state: "error",
      created: 0,
      updated: 0,
      trashed: 0,
      rows: 0,
      searchTotal: null,
      problem: {
        code: "unavailable",
        message:
          "Content couldn't bring the pull requests in yet. It tries again within five minutes, or when the collection is read.",
        at: new Date().toISOString(),
      },
    };
  }
  // Links fail loudly, since the caller named them: a typo shouldn't pass as
  // added. The collection stays; adding them again with
  // add-github-pull-requests is safe.
  let added: AddedGitHubPullRequest[] = [];
  let addError: string | null = null;
  if (refs.length > 0) {
    try {
      added = await addGitHubPullRequests({
        databaseId: database.id,
        refs,
        actor,
      });
    } catch (error) {
      // The collection is made by now, so even a failure that can't be
      // named returns it, rather than an error that reads as nothing made.
      if (error instanceof ActionContractError) {
        addError = error.message;
      } else {
        console.warn(
          "[github-pull-requests] adding links to a new collection failed:",
          error instanceof Error ? error.message : String(error),
        );
        addError =
          "Content couldn't add them yet. Adding them again with add-github-pull-requests is safe.";
      }
    }
  }
  await writeAppState("refresh-signal", { ts: Date.now() }).catch(
    (error: unknown) => {
      // The change event still reaches open pages.
      console.warn(
        "[github-pull-requests] refresh signal failed:",
        error instanceof Error ? error.message : String(error),
      );
    },
  );
  return {
    sync,
    added,
    addError,
    summary: [
      `Made "${database.title}". ${githubPullRequestsSyncSummary(sync)}`,
      added.length > 0
        ? `Added ${added.length} by link: ${added.map((pr) => pr.key).join(", ")}.`
        : null,
      addError ? `The links weren't added: ${addError}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export default defineAction({
  description:
    "Make a new collection of GitHub pull requests, view only: each pull request a GitHub search finds is a row, plus any added by link, with Repository, State, Review, Checks, dates and Days open as read-only columns that update within about a minute of a read, and within five minutes otherwise. Pull requests added by link stay after they merge or close, so other collections can point at them with a relation. Add more later with add-github-pull-requests.",
  mcpTool: true,
  // It only makes a new collection, so it never replaces anyone's content.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  agentInputSchema: createGitHubPullRequestCollectionSchema,
  schema: createGitHubPullRequestCollectionSchema,
  outputSchema: createGitHubPullRequestCollectionOutputSchema,
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new ActionContractError("Sign in to follow GitHub pull requests.", {
        errorCode: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }
    await resolveContentSpaceAccess(args.spaceId, "contributor");
    if (args.parentId) await assertAccess("document", args.parentId, "editor");

    const search =
      args.search === undefined
        ? DEFAULT_GITHUB_PULL_REQUEST_SEARCH
        : args.search.replace(/\s+/g, " ") || null;
    const refs = parsePullRequestLinks(args.urls ?? []);
    if (!search && refs.length === 0) {
      throw new ActionContractError(
        "Give a search, pull request links, or both; with neither the collection would stay empty.",
        { errorCode: "INVALID_INPUT", statusCode: 400 },
      );
    }
    const title = args.title ?? "Pull requests";
    if (args.dryRun) {
      return {
        dryRun: true as const,
        title,
        search,
        urls: refs.map((ref) => `${ref.owner}/${ref.repo}#${ref.number}`),
        summary: `Would make "${title}"${search ? `, following the search "${search}"` : ""}${refs.length ? `, with ${refs.length} pull request${refs.length === 1 ? "" : "s"} added by link` : ""}. Run again without dryRun to make it.`,
      };
    }

    const created = await createContentDatabase.run({
      spaceId: args.spaceId,
      parentId: args.parentId ?? null,
      title,
      idempotencyKey: args.idempotencyKey ?? `github-pull-requests-${nanoid()}`,
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
      ? await readLinkedGitHubPullRequests(database.id)
      : null;
    let sourceId = earlierLink?.source.id ?? null;
    if (!sourceId) {
      try {
        sourceId = await createGitHubPullRequestsLink({
          database,
          search,
          connectionId: args.connectionId ?? null,
          userEmail,
          // Runs under the collection's lock, so nothing lands in it between
          // the check and the link.
          assertLinkable: async (tx) => {
            if (database.systemRole) {
              throw new ActionContractError(
                "This collection can't follow GitHub pull requests.",
                { errorCode: "COLLECTION_NOT_LINKABLE", statusCode: 409 },
              );
            }
            if (
              (await hasSource(database.id, tx)) ||
              (await hasRows(database.id, tx))
            ) {
              throw new ActionContractError(
                "This collection already has rows or a source.",
                { errorCode: "COLLECTION_NOT_EMPTY", statusCode: 409 },
              );
            }
          },
        });
      } catch (error) {
        // The collection was made for these pull requests, so it doesn't
        // stay behind empty when the link can't be saved. One an earlier try
        // made is left alone.
        if (madeEarlier) throw error;
        try {
          await deleteContentDatabase.run({ databaseId: database.id });
        } catch (cleanupError) {
          console.warn(
            "[create-github-pull-request-collection] could not remove the new collection",
            cleanupError,
          );
        }
        throw error;
      }
    }
    return {
      dryRun: false as const,
      database: {
        id: database.id,
        documentId: database.documentId,
        title: database.title,
      },
      title,
      search,
      ...(await bringInPullRequests({
        database,
        sourceId,
        refs,
        actor: userEmail,
      })),
    };
  },
  // Everyone reading the new collection gets its rows, not just the caller.
  changeResource: (_input, result) =>
    result.dryRun ? null : documentChangeResource(result.database.documentId),
});
