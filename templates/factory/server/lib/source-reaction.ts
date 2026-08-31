const REACTION_NAME = /^[a-z0-9_+-]{1,50}$/;

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
    throw new Error("Reaction must be an emoji name like robot_face.");
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
