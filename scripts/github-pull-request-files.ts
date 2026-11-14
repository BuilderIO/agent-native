import { execFileSync } from "node:child_process";

export type RunGhApi = (args: string[]) => string;

export function pullRequestFilesApiArgs(
  repo: string,
  pullRequestNumber: string,
): string[] {
  return [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/pulls/${pullRequestNumber}/files`,
  ];
}

function runGhApi(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

export function fetchPullRequestFilePages(
  repo: string,
  pullRequestNumber: string,
  gh: RunGhApi = runGhApi,
): unknown {
  return JSON.parse(gh(pullRequestFilesApiArgs(repo, pullRequestNumber)));
}
