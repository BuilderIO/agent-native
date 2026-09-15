import {
  hasSlackChannelPatch,
  slackChannelRefsFromConfig,
} from "./slack-source-config.js";

export type SourceListField = "slackChannels" | "githubRepositories";

export type SourceConfigIssueCode =
  | "invalid_slack_channel"
  | "invalid_github_repository";

export interface SourceConfigIssue {
  field: SourceListField;
  code: SourceConfigIssueCode;
  /** The offending entry exactly as the user typed it, before normalization. */
  value: string;
  /** 1-based position of the entry within its field. */
  line: number;
}

export interface ParsedSourceListEntry {
  value: string;
  line: number;
}

/**
 * Slack conversation IDs are uppercase and prefixed by conversation kind:
 * C (public channel), G (private channel), D (DM). Enterprise Grid can widen
 * the suffix, so the length bound stays loose on purpose.
 */
const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]{6,20}$/;

/**
 * Slack channel names allow non-Latin letters, so this rejects the characters
 * Slack forbids instead of allow-listing ASCII and locking out those names.
 */
const SLACK_NAME_FORBIDDEN = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/u;

const SLACK_NAME_MAX_LENGTH = 80;

const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;

const GITHUB_REPOSITORY_CONFIG_KEYS = ["repositories", "repos"] as const;

export function normalizeSlackChannelRef(value: string) {
  return value.trim().replace(/^#/, "");
}

export function isValidSlackChannelRef(value: string) {
  const ref = normalizeSlackChannelRef(value);
  if (!ref || ref.length > SLACK_NAME_MAX_LENGTH) return false;
  if (SLACK_CHANNEL_ID.test(ref)) return true;
  if (SLACK_NAME_FORBIDDEN.test(ref)) return false;
  return !/[A-Z]/.test(ref);
}

/**
 * Returns the canonical `owner/repo` form, or null when the value is not a
 * repository reference at all. Callers must treat null as invalid input rather
 * than filtering it away.
 */
export function normalizeGitHubRepoRef(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/, "");
  if (!trimmed) return null;
  const withoutProtocol = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "");
  const [owner, repo] = withoutProtocol.split("/");
  if (!owner || !repo) return null;
  const cleanRepo = repo.split(/[?#]/)[0];
  if (!GITHUB_SEGMENT.test(owner) || !GITHUB_SEGMENT.test(cleanRepo)) {
    return null;
  }
  return `${owner}/${cleanRepo}`;
}

export function isValidGitHubRepoRef(value: string) {
  return normalizeGitHubRepoRef(value) !== null;
}

/**
 * Splits a multi-line list field while keeping the line the user typed each
 * entry on, so an inline error can point at the offending row.
 */
export function parseSourceListInput(raw: string): ParsedSourceListEntry[] {
  const entries: ParsedSourceListEntry[] = [];
  const lines = raw.split(/\n/g);
  for (const [index, lineText] of lines.entries()) {
    for (const part of lineText.split(",")) {
      const value = part.trim();
      if (!value) continue;
      entries.push({ value, line: index + 1 });
    }
  }
  return entries;
}

export function sourceListValues(raw: string) {
  return parseSourceListInput(raw).map((entry) =>
    entry.value.replace(/^#/, ""),
  );
}

function issuesForEntries(
  entries: readonly ParsedSourceListEntry[],
  field: SourceListField,
  code: SourceConfigIssueCode,
  isValid: (value: string) => boolean,
): SourceConfigIssue[] {
  return entries
    .filter((entry) => !isValid(entry.value))
    .map((entry) => ({ field, code, value: entry.value, line: entry.line }));
}

function entriesFromValues(values: readonly string[]) {
  return values.map((value, index) => ({ value, line: index + 1 }));
}

export function validateSlackChannelRefs(values: readonly string[]) {
  return issuesForEntries(
    entriesFromValues(values),
    "slackChannels",
    "invalid_slack_channel",
    isValidSlackChannelRef,
  );
}

export function validateGitHubRepoRefs(values: readonly string[]) {
  return issuesForEntries(
    entriesFromValues(values),
    "githubRepositories",
    "invalid_github_repository",
    isValidGitHubRepoRef,
  );
}

export function validateSlackChannelInput(raw: string) {
  return issuesForEntries(
    parseSourceListInput(raw),
    "slackChannels",
    "invalid_slack_channel",
    isValidSlackChannelRef,
  );
}

export function validateGitHubRepoInput(raw: string) {
  return issuesForEntries(
    parseSourceListInput(raw),
    "githubRepositories",
    "invalid_github_repository",
    isValidGitHubRepoRef,
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function githubRepoRefsFromConfig(config: Record<string, unknown>) {
  const nested = objectValue(config.github);
  const values: string[] = [];
  for (const itemConfig of [config, nested]) {
    for (const key of GITHUB_REPOSITORY_CONFIG_KEYS) {
      const value = itemConfig[key];
      if (typeof value === "string") values.push(...value.split(","));
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") values.push(item);
        }
      }
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function hasGitHubRepositoryPatch(config: Record<string, unknown>) {
  const nested = objectValue(config.github);
  return GITHUB_REPOSITORY_CONFIG_KEYS.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(config, key) ||
      Object.prototype.hasOwnProperty.call(nested, key),
  );
}

/**
 * Validates only the list fields the caller actually supplied, so editing an
 * unrelated field on a source that already holds bad data is not blocked by
 * that pre-existing data.
 */
export function validateSourceConfig(
  provider: string,
  config: Record<string, unknown>,
): SourceConfigIssue[] {
  if (provider === "slack" && hasSlackChannelPatch(config)) {
    return validateSlackChannelRefs(slackChannelRefsFromConfig(config));
  }
  if (provider === "github" && hasGitHubRepositoryPatch(config)) {
    return validateGitHubRepoRefs(githubRepoRefsFromConfig(config));
  }
  return [];
}

export function describeSourceConfigIssues(
  issues: readonly SourceConfigIssue[],
) {
  const slack = issues.filter((issue) => issue.field === "slackChannels");
  const github = issues.filter((issue) => issue.field === "githubRepositories");
  const parts: string[] = [];
  if (slack.length) {
    parts.push(
      `Invalid Slack channel ${slack.length === 1 ? "entry" : "entries"}: ${slack
        .map((issue) => JSON.stringify(issue.value))
        .join(", ")}. Use a channel ID like C0123456789 or a #channel-name.`,
    );
  }
  if (github.length) {
    parts.push(
      `Invalid GitHub repository ${
        github.length === 1 ? "entry" : "entries"
      }: ${github
        .map((issue) => JSON.stringify(issue.value))
        .join(", ")}. Use owner/repo or a github.com repository URL.`,
    );
  }
  return parts.join(" ");
}
