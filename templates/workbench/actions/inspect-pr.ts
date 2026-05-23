import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Full PR detail — the shape the `/prs/:owner/:repo/:n` page renders. Fetches
 * live from GitHub on every call (no caching here; the Octokit instance caches
 * ETags on its own). Use `review-pr` instead when the caller is the
 * reviewer and needs permission flags.
 */
export default defineAction({
  description:
    "Fetch full pull request detail: title, body, base/head, files, comments, " +
    "and check runs. Data is fetched live from GitHub via the shared workspace " +
    "integration. For the dedicated review UI, prefer `review-pr` (returns the " +
    "same shape plus permission flags).",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to inspect pull requests.");
    }
    const orgId = getRequestOrgId() || "";

    const octokit = await getGitHubConnection(userEmail, orgId);
    if (!octokit) {
      return {
        connected: false,
        connectHint:
          "GitHub isn't connected to Workbench yet — connect it once in Dispatch and grant Workbench access.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    const [prRes, filesRes, commentsRes, reviewCommentsRes, checksRes] =
      await Promise.all([
        octokit.pulls.get({
          owner: args.owner,
          repo: args.repo,
          pull_number: args.number,
        }),
        octokit.pulls.listFiles({
          owner: args.owner,
          repo: args.repo,
          pull_number: args.number,
          per_page: 100,
        }),
        octokit.issues.listComments({
          owner: args.owner,
          repo: args.repo,
          issue_number: args.number,
          per_page: 100,
        }),
        octokit.pulls.listReviewComments({
          owner: args.owner,
          repo: args.repo,
          pull_number: args.number,
          per_page: 100,
        }),
        octokit.checks
          .listForRef({
            owner: args.owner,
            repo: args.repo,
            ref: `pull/${args.number}/head`,
            per_page: 100,
          })
          .catch(() => null),
      ]);

    const pr = prRes.data;
    const checks = checksRes?.data.check_runs ?? [];
    const ciStatus = aggregateCiStatus(checks);

    return {
      connected: true,
      owner: args.owner,
      repo: args.repo,
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      url: pr.html_url,
      author: pr.user
        ? {
            login: pr.user.login,
            avatarUrl: pr.user.avatar_url,
            url: pr.user.html_url,
          }
        : null,
      state: pr.merged_at ? "merged" : pr.state,
      isDraft: Boolean(pr.draft),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      closedAt: pr.closed_at,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      filesChanged: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      commits: pr.commits,
      mergeable: pr.mergeable,
      ciStatus,
      checks: checks.map((check) => ({
        id: check.id,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        url: check.html_url,
      })),
      files: filesRes.data.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ?? null,
        sha: file.sha,
        rawUrl: file.raw_url,
        blobUrl: file.blob_url,
      })),
      comments: commentsRes.data.map((comment) => ({
        id: comment.id,
        kind: "issue" as const,
        author: comment.user?.login ?? null,
        avatarUrl: comment.user?.avatar_url ?? null,
        body: comment.body ?? "",
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.html_url,
      })),
      reviewComments: reviewCommentsRes.data.map((comment) => ({
        id: comment.id,
        kind: "review" as const,
        author: comment.user?.login ?? null,
        avatarUrl: comment.user?.avatar_url ?? null,
        body: comment.body ?? "",
        path: comment.path,
        line: comment.line ?? comment.original_line ?? null,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.html_url,
      })),
    };
  },
});

function aggregateCiStatus(
  checks: Array<{ status: string; conclusion: string | null }>,
): "pending" | "success" | "failure" | "neutral" | "unknown" {
  if (checks.length === 0) return "unknown";
  if (checks.some((c) => c.status === "in_progress" || c.status === "queued"))
    return "pending";
  if (
    checks.some(
      (c) =>
        c.conclusion === "failure" ||
        c.conclusion === "timed_out" ||
        c.conclusion === "cancelled",
    )
  )
    return "failure";
  if (
    checks.every(
      (c) =>
        c.conclusion === "success" ||
        c.conclusion === "skipped" ||
        c.conclusion === "neutral",
    )
  )
    return "success";
  return "neutral";
}
