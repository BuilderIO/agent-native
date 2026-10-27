import { pathToFileURL } from "node:url";

import {
  fetchPullRequestFilePages,
  type RunGhApi,
} from "./github-pull-request-files.ts";

export type ReleasePullRequestPackageFile = {
  filename: string;
  status: string;
};

export function parseReleasePullRequestPackageFiles(
  pages: unknown,
): ReleasePullRequestPackageFile[] {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some((page) => !Array.isArray(page))
  ) {
    throw new Error("GitHub returned an invalid release PR file list");
  }

  const files: ReleasePullRequestPackageFile[] = [];
  for (const page of pages) {
    for (const file of page) {
      if (
        !file ||
        typeof file !== "object" ||
        Array.isArray(file) ||
        typeof file.filename !== "string" ||
        typeof file.status !== "string"
      ) {
        throw new Error("GitHub returned an invalid release PR file list");
      }
      if (
        file.filename === "package.json" ||
        file.filename.endsWith("/package.json")
      ) {
        files.push({ filename: file.filename, status: file.status });
      }
    }
  }
  return files;
}

function listReleasePullRequestPackageFiles(
  repo: string,
  pullRequestNumber: string,
  gh?: RunGhApi,
): ReleasePullRequestPackageFile[] {
  return parseReleasePullRequestPackageFiles(
    fetchPullRequestFilePages(repo, pullRequestNumber, gh),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repo = process.env.REPO;
  const pullRequestNumber = process.env.PR_NUMBER;
  if (!repo || !pullRequestNumber) {
    throw new Error("REPO and PR_NUMBER are required");
  }

  process.stdout.write(
    JSON.stringify(listReleasePullRequestPackageFiles(repo, pullRequestNumber)),
  );
}
