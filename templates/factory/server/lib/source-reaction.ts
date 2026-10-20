const REACTION_NAME = /^[a-z0-9_+-]{1,50}$/;

/**
 * Where the Slack poller records which reactions a person put on a message,
 * in the item's metadata. A person is anyone who is not a bot, so the
 * workflow's own acknowledgement never counts as someone claiming a report.
 * `personReactions` is written only for a message that starts a thread, and an
 * empty list means the reactions were read and a person had added none; a row
 * without the key was never read for reactions at all.
 */
export const PERSON_REACTIONS_KEY = "personReactions";
/** Slack ids of the people behind `personReactions`, for the audit. */
export const PERSON_REACTORS_KEY = "personReactors";
/**
 * Reactors the poller could not tell from a bot (a failed lookup, or a list
 * Slack cut short). Their reactions are counted in `personReactions`, so a
 * claim is never missed, and they are listed here so it can be seen.
 */
export const UNVERIFIED_REACTORS_KEY = "unverifiedReactors";

export const GITHUB_ISSUE_REACTIONS = [
  "+1",
  "-1",
  "laugh",
  "confused",
  "heart",
  "hooray",
  "rocket",
  "eyes",
] as const;

export type GitHubIssueReaction = (typeof GITHUB_ISSUE_REACTIONS)[number];

export function parseOptionalReaction(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? "")
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  if (!trimmed) return null;
  if (!REACTION_NAME.test(trimmed)) {
    throw new Error("Reaction must be an emoji name like eyes.");
  }
  return trimmed;
}

export function githubIssueReaction(
  name: string | null,
): GitHubIssueReaction | null {
  if (!name) return null;
  return (GITHUB_ISSUE_REACTIONS as readonly string[]).includes(name)
    ? (name as GitHubIssueReaction)
    : null;
}
