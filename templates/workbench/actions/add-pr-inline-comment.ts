import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Post an inline review comment on a specific line of a diff. Uses GitHub's
 * single-comment review API (`createReviewComment`), which posts a standalone
 * inline comment without opening a multi-line review session.
 *
 * `line` is the RIGHT-side (added) line number in the diff. For comments on
 * the left side (removed lines), the caller should switch to the GitHub UI —
 * the single-comment API doesn't accept side overrides.
 */
export default defineAction({
  description:
    "Post an inline comment on a specific line of a PR's diff. The comment " +
    "is anchored to the right-side (added) line number. For comments on " +
    "removed lines or multi-line ranges, use the GitHub UI directly.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
    path: z.string().min(1).describe("File path relative to repo root."),
    line: z.coerce
      .number()
      .int()
      .positive()
      .describe("Right-side (added) line number in the diff."),
    message: z.string().min(1).max(65_536),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to comment on pull requests.");
    }
    const orgId = getRequestOrgId() || "";

    const octokit = await getGitHubConnection(userEmail, orgId);
    if (!octokit) {
      return {
        connected: false,
        error:
          "GitHub isn't connected to Workbench yet — connect it once in Dispatch and grant Workbench access.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    // Need the head commit SHA to anchor the inline comment.
    const { data: pr } = await octokit.pulls.get({
      owner: args.owner,
      repo: args.repo,
      pull_number: args.number,
    });

    const { data } = await octokit.pulls.createReviewComment({
      owner: args.owner,
      repo: args.repo,
      pull_number: args.number,
      commit_id: pr.head.sha,
      path: args.path,
      line: args.line,
      side: "RIGHT",
      body: args.message,
    });

    return {
      connected: true,
      commentId: data.id,
      createdAt: data.created_at,
      url: data.html_url,
      message: `Posted inline comment on ${args.path}:${args.line}.`,
    };
  },
});
