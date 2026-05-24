import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Submit an APPROVE review on a PR. Optionally accept a short message that
 * goes into the review body (e.g. "LGTM" or a template's expansion). On
 * success the response includes the GitHub review ID so the UI can mark the
 * review bar as "submitted" without a refetch.
 *
 * GitHub rejects approving your own PR; the UI gates the button via
 * `review-pr`'s `permissions.canApprove`, but we surface a clear error
 * here as a defense-in-depth check.
 */
export default defineAction({
  description:
    "Submit an APPROVE review on a pull request. Optionally include a short " +
    "message (defaults to no body — GitHub renders 'Approved' on its own). " +
    "Authors cannot approve their own PRs.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
    message: z
      .string()
      .max(10_000)
      .optional()
      .describe("Optional approval message / body."),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to approve pull requests.");
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

    const { data } = await octokit.pulls.createReview({
      owner: args.owner,
      repo: args.repo,
      pull_number: args.number,
      event: "APPROVE",
      body: args.message || undefined,
    });

    return {
      connected: true,
      reviewId: data.id,
      submittedAt: data.submitted_at,
      url: data.html_url,
      message: `Approved ${args.owner}/${args.repo}#${args.number}.`,
    };
  },
});
