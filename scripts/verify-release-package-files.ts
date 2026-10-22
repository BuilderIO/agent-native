import { execFileSync } from "node:child_process";

const pullRequestFilesLimit = 3_000;

const allowedReleasePaths = [
  /^\.changeset\/.+\.md$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^.+\/package\.json$/,
  /^.+\/CHANGELOG\.md$/,
  /^.+\/changelog\/.+$/,
  /^packages\/dispatch\/src\/server\/lib\/community-apps\.ts$/,
];

export function assertReleaseOnlyPullRequestFiles(
  files: unknown,
  changedFilesCount: unknown,
): string[] {
  if (
    typeof changedFilesCount !== "number" ||
    !Number.isSafeInteger(changedFilesCount) ||
    changedFilesCount < 0
  ) {
    throw new Error("GitHub returned an invalid pull request file count.");
  }
  if (changedFilesCount >= pullRequestFilesLimit) {
    throw new Error(
      `Cannot verify pull requests with ${changedFilesCount} changed files: GitHub's pull request files endpoint is capped at ${pullRequestFilesLimit}.`,
    );
  }
  if (
    !Array.isArray(files) ||
    !files.every((file): file is string => typeof file === "string")
  ) {
    throw new Error("GitHub returned an invalid release PR file list.");
  }
  if (files.length !== changedFilesCount) {
    throw new Error(
      `GitHub returned ${files.length} of ${changedFilesCount} changed pull request files.`,
    );
  }
  if (files.length === 0) {
    throw new Error("Release PR has no changed files; refusing admin-merge.");
  }

  for (const file of files) {
    if (/[\0-\x1f\x7f]/.test(file)) {
      throw new Error(
        "Release PR contains a filename with control characters; refusing admin-merge.",
      );
    }
    if (!allowedReleasePaths.some((pattern) => pattern.test(file))) {
      throw new Error(
        `Refusing admin-merge for unexpected release PR path: ${file}`,
      );
    }
  }

  return files;
}

export function extractPullRequestFileNames(pages: unknown): string[] {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("GitHub returned an invalid pull request file list.");
  }

  const files: string[] = [];
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new Error("GitHub returned an invalid pull request file list.");
    }
    for (const file of page) {
      if (
        file === null ||
        typeof file !== "object" ||
        Array.isArray(file) ||
        !("filename" in file) ||
        typeof file.filename !== "string"
      ) {
        throw new Error("GitHub returned an invalid pull request file list.");
      }
      files.push(file.filename);
    }
  }

  return files;
}

function main(): void {
  const repo = process.env.REPO;
  const prNumber = process.env.PR_NUMBER;
  if (!repo || !prNumber) {
    throw new Error("Missing release PR file verification context.");
  }

  const gh = (args: string[]) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  const pages = JSON.parse(
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/pulls/${prNumber}/files`,
    ]),
  ) as unknown;
  const files = extractPullRequestFileNames(pages);
  const pullRequest = JSON.parse(
    gh(["api", `repos/${repo}/pulls/${prNumber}`]),
  ) as { changed_files?: unknown };
  const completeFiles = assertReleaseOnlyPullRequestFiles(
    files,
    pullRequest.changed_files,
  );
  console.log(
    `Verified ${completeFiles.length} complete release PR file paths against the allowlist.`,
  );
}

if (process.argv[1]?.endsWith("verify-release-package-files.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
