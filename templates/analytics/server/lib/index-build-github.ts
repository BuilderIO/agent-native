import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { compileSourceIndex } from "../../scripts/build-source-index";
import { getAnalyticsProviderApiRuntime } from "./provider-api";
import {
  parseSourceIndexBundle,
  type SourceIndexBundle,
} from "./source-index-schema";

export const DBT_REPOSITORY_SETTING_KEY = "analytics-dbt-repository";

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

// "." and ".." match the character class but are path segments: interpolated
// into /repos/{owner}/{repo} they rewrite the GitHub API path.
const gitHubName = z
  .string()
  .regex(GITHUB_NAME)
  .max(100)
  .refine((name) => name !== "." && name !== "..");

export const dbtRepositorySettingSchema = z
  .object({
    owner: gitHubName,
    repo: gitHubName,
  })
  .strict();

export type DbtRepository = z.infer<typeof dbtRepositorySettingSchema>;

// ponytail: the provider runtime caps a tree listing at 10,000 entries and
// reports truncation, so a larger repo fails loudly. Switch to a raw tree
// request when a real repo needs more.
const MAX_TREE_ENTRIES = 10_000;
const FETCH_CONCURRENCY = 8;
// The generator reads every .sql and .yml/.yaml under the root, minus its own
// skipped directories. Fetching that superset keeps the two file sets from
// drifting when the generator's skip list changes.
const GENERATOR_INPUT_FILE = /\.(?:sql|ya?ml)$/i;

const commitListSchema = z.array(
  z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    commit: z.object({ committer: z.object({ date: z.string() }) }),
  }),
);

async function readHeadCommit(
  repository: DbtRepository,
): Promise<{ sha: string; committedAt: string }> {
  const result = z
    .object({
      response: z.object({
        ok: z.boolean(),
        status: z.number(),
        json: z.unknown(),
      }),
    })
    .parse(
      await getAnalyticsProviderApiRuntime().executeRequest({
        provider: "github",
        method: "GET",
        path: `/repos/${repository.owner}/${repository.repo}/commits`,
        query: { per_page: "1" },
      }),
    );
  if (!result.response.ok) {
    throw new Error(
      `GitHub commit lookup failed with HTTP ${result.response.status}.`,
    );
  }
  const head = commitListSchema.parse(result.response.json)[0];
  if (!head) {
    throw new Error("The dbt repository has no commits to index.");
  }
  return {
    sha: head.sha,
    committedAt: new Date(head.commit.committer.date).toISOString(),
  };
}

async function fetchFilesInto(
  root: string,
  repository: DbtRepository,
  ref: string,
  filePaths: string[],
): Promise<void> {
  const runtime = getAnalyticsProviderApiRuntime();
  for (let offset = 0; offset < filePaths.length; offset += FETCH_CONCURRENCY) {
    const batch = filePaths.slice(offset, offset + FETCH_CONCURRENCY);
    // allSettled waits for every write in the batch, so the caller's cleanup
    // cannot race a late write that would recreate directories.
    const settled = await Promise.allSettled(
      batch.map(async (filePath) => {
        const file = await runtime.readGitHubRepositoryFile({
          owner: repository.owner,
          repo: repository.repo,
          path: filePath,
          ref,
        });
        if (file.content === null) {
          throw new Error(
            `GitHub returned no readable content for ${filePath}; no index was built.`,
          );
        }
        const target = path.join(root, ...filePath.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
      }),
    );
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}

function withRevision(
  bundle: SourceIndexBundle,
  revision: string,
): SourceIndexBundle {
  return parseSourceIndexBundle({
    ...bundle,
    sources: bundle.sources.map((source) => ({ ...source, revision })),
    entries: bundle.entries.map((entry) =>
      entry.sourceKind === "dbt"
        ? { ...entry, sourceRevision: revision }
        : entry,
    ),
  });
}

// The generator takes the source id from the root directory name, so the root
// is named after the repo to keep the id stable across builds.
export async function buildDbtSourceIndexFromGitHub(
  repository: DbtRepository,
): Promise<{ bundle: SourceIndexBundle; revision: string }> {
  const head = await readHeadCommit(repository);
  const listing =
    await getAnalyticsProviderApiRuntime().listGitHubRepositoryFiles({
      owner: repository.owner,
      repo: repository.repo,
      ref: head.sha,
      recursive: true,
      maxFiles: MAX_TREE_ENTRIES,
    });
  if (listing.truncated) {
    throw new Error(
      `The dbt repository has more than ${MAX_TREE_ENTRIES} files or GitHub truncated its tree; no index was built.`,
    );
  }
  const filePaths = listing.entries
    .filter(
      (entry) => entry.type === "file" && GENERATOR_INPUT_FILE.test(entry.path),
    )
    .map((entry) => entry.path);

  const parent = await mkdtemp(
    path.join(os.tmpdir(), "analytics-source-index-"),
  );
  try {
    const root = path.join(parent, repository.repo);
    await mkdir(root);
    await fetchFilesInto(root, repository, head.sha, filePaths);
    const bundle = await compileSourceIndex({
      dbtRoots: [root],
      generatedAt: head.committedAt,
    });
    return { bundle: withRevision(bundle, head.sha), revision: head.sha };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}
