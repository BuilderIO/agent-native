import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Submit a REQUEST_CHANGES review on a PR. The message is required — GitHub
 * forces a body on REQUEST_CHANGES reviews and the UI should surface a
 * "please explain what to change" field before submission.
 */
export default defineAction({
  description:
    "Submit a REQUEST_CHANGES review on a pull request. The message is " +
    "required and becomes the review body — explain what needs to change.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.coerce.number().int().positive(),
    message: z
      .string()
      .min(1, "A message is required when requesting changes.")
      .max(65_536),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to request changes on pull requests.");
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
      event: "REQUEST_CHANGES",
      body: args.message,
    });

    return {
      connected: true,
      reviewId: data.id,
      submittedAt: data.submitted_at,
      url: data.html_url,
      message: `Requested changes on ${args.owner}/${args.repo}#${args.number}.`,
    };
  },
});
