import { canonicalGitHubRepository } from "../../../../../server/lib/github-repository.js";

type InboxPoller = "slack" | "github" | "sentry";

// The shape the Slack connector accepts for a channel: a name such as #eng is
// not an id, and the poller cannot read one. Saving does not check it, so a
// name would only fail at the first poll.
const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]{2,}$/;

/**
 * True when `scope` is not what this poller reads: a Slack channel id,
 * `owner/repo`, or a Sentry `organization/project`. GitHub and Sentry follow
 * the checks `planWorkflowJob` makes when it writes the job file.
 */
export function isInvalidInboxScope(
  poller: InboxPoller,
  scope: string,
): boolean {
  switch (poller) {
    case "slack":
      return !SLACK_CHANNEL_ID.test(scope);
    case "github":
      try {
        canonicalGitHubRepository(scope);
        return false;
      } catch {
        return true;
      }
    case "sentry": {
      const [org, project, ...rest] = scope.split("/");
      return !org || !project || rest.length > 0;
    }
  }
}
