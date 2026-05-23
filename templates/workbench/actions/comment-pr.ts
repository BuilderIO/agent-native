import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Post a non-review comment on a PR (issue comment, not a review). Use
 * `add-pr-inline-comment` for diff-line-anchored comments, or `review-pr`'s
 * follow-on actions (`approve-pr`, `request-changes-pr`) when the user is
 * submitting a review.
 */
export default defineAction({
  description:
    "Post a non-review comment on a pull request (the conversation tab). For " +
    "diff-line-anchored comments, use `add-pr-inline-comment`. For an " +
    "approving/blocking review, use `approve-pr` / `request-changes-pr`.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
    message: z.string().min(1, "Comment body is required.").max(65_536),
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

    const { data } = await octokit.issues.createComment({
      owner: args.owner,
      repo: args.repo,
      issue_number: args.number,
      body: args.message,
    });

    return {
      connected: true,
      commentId: data.id,
      createdAt: data.created_at,
      url: data.html_url,
      message: `Posted comment on ${args.owner}/${args.repo}#${args.number}.`,
    };
  },
});
