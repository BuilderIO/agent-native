import {
  SLACK_CHANNEL_CONFIG_KEYS,
  hasSlackChannelPatch,
} from "./slack-source-config.js";

export type SourceListField = "slackChannels" | "githubRepositories";

export type SourceConfigIssueCode =
  | "invalid_slack_channel"
  | "slack_direct_message"
  | "invalid_github_repository"
  | "not_a_string";

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

interface RawListEntry {
  raw: unknown;
  line: number;
}

/**
 * Slack conversation IDs are uppercase and prefixed by conversation kind.
 * Only C (public channel) and G (private channel) are accepted: `resolveSlackChannel`
 * resolves a D-prefixed ref to an IM, and `isUsableSlackChannel` then drops it, so a
 * D-only source syncs successfully against zero channels.
 */
const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;

const SLACK_DIRECT_MESSAGE_ID = /^D[A-Z0-9]{6,20}$/i;

/**
 * Slack channel names allow non-Latin letters, so this rejects the characters
 * Slack forbids instead of allow-listing ASCII and locking out those names.
 * Symbols and emoji are forbidden too: Slack permits letters, numbers, hyphens
 * and underscores only, so an emoji can never match a real channel name.
 */
const SLACK_NAME_FORBIDDEN =
  /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]|\p{S}|\p{Extended_Pictographic}/u;

const SLACK_NAME_MAX_LENGTH = 80;

/** Repository names may contain dots; GitHub owners may not. */
const GITHUB_OWNER = /^[A-Za-z0-9_-]+$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+$/;

const GITHUB_REPOSITORY_CONFIG_KEYS = ["repositories", "repos"] as const;

export function normalizeSlackChannelRef(value: string) {
  return value.trim().replace(/^#/, "");
}

export function isSlackDirectMessageRef(value: string) {
  return SLACK_DIRECT_MESSAGE_ID.test(normalizeSlackChannelRef(value));
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
 *
 * The bare-host form (`github.com/owner/repo`) has to be stripped before the
 * split, or the host becomes the owner and a different repository is addressed
 * silently. Rejecting a dotted owner is what stops the same confusion for any
 * other host.
 */
export function normalizeGitHubRepoRef(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/, "");
  if (!trimmed) return null;
  const withoutHost = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^(?:www\.)?github\.com\//i, "");
  const [owner, repo] = withoutHost.split("/");
  if (!owner || !repo) return null;
  const cleanRepo = repo.split(/[?#]/)[0];
  if (!GITHUB_OWNER.test(owner) || !GITHUB_REPO.test(cleanRepo)) {
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
  entries: readonly RawListEntry[],
  field: SourceListField,
  invalidCode: SourceConfigIssueCode,
): SourceConfigIssue[] {
  const issues: SourceConfigIssue[] = [];
  for (const entry of entries) {
    const code = classifyEntry(entry.raw, field, invalidCode);
    if (!code) continue;
    issues.push({
      field,
      code,
      value: displayValue(entry.raw),
      line: entry.line,
    });
  }
  return issues;
}

function classifyEntry(
  raw: unknown,
  field: SourceListField,
  invalidCode: SourceConfigIssueCode,
): SourceConfigIssueCode | null {
  if (typeof raw !== "string") return "not_a_string";
  if (field === "slackChannels") {
    if (isSlackDirectMessageRef(raw)) return "slack_direct_message";
    return isValidSlackChannelRef(raw) ? null : invalidCode;
  }
  return isValidGitHubRepoRef(raw) ? null : invalidCode;
}

function displayValue(raw: unknown) {
  return typeof raw === "string" ? raw : (JSON.stringify(raw) ?? String(raw));
}

function entriesFromValues(values: readonly unknown[]): RawListEntry[] {
  return values.map((raw, index) => ({ raw, line: index + 1 }));
}

export function validateSlackChannelRefs(values: readonly unknown[]) {
  return issuesForEntries(
    entriesFromValues(values),
    "slackChannels",
    "invalid_slack_channel",
  );
}

export function validateGitHubRepoRefs(values: readonly unknown[]) {
  return issuesForEntries(
    entriesFromValues(values),
    "githubRepositories",
    "invalid_github_repository",
  );
}

export function validateSlackChannelInput(raw: string) {
  return issuesForEntries(
    parseSourceListInput(raw).map((entry) => ({
      raw: entry.value,
      line: entry.line,
    })),
    "slackChannels",
    "invalid_slack_channel",
  );
}

export function validateGitHubRepoInput(raw: string) {
  return issuesForEntries(
    parseSourceListInput(raw).map((entry) => ({
      raw: entry.value,
      line: entry.line,
    })),
    "githubRepositories",
    "invalid_github_repository",
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Collects list entries exactly as the caller supplied them.
 *
 * The storage-side readers (`slackChannelRefsFromConfig`, `githubReposFromConfig`)
 * drop blanks and non-strings before returning, which would hide precisely the
 * malformed entries this validator exists to catch and let an action caller
 * persist what the drawer refuses. A delimited string is split like the textarea,
 * so blank segments around separators are skipped; an array element is a discrete
 * value and is always inspected, blank or not.
 */
function rawListEntriesFromConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
  nestedKey: string,
): RawListEntry[] {
  const entries: RawListEntry[] = [];
  let line = 0;
  for (const itemConfig of [config, objectValue(config[nestedKey])]) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(itemConfig, key)) continue;
      const value = itemConfig[key];
      if (typeof value === "string") {
        for (const part of value.split(",")) {
          if (!part.trim()) continue;
          line += 1;
          entries.push({ raw: part.trim(), line });
        }
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          line += 1;
          entries.push({ raw: item, line });
        }
        continue;
      }
      line += 1;
      entries.push({ raw: value, line });
    }
  }
  return entries;
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
    return validateSlackChannelRefs(
      rawListEntriesFromConfig(config, SLACK_CHANNEL_CONFIG_KEYS, "slack").map(
        (entry) => entry.raw,
      ),
    );
  }
  if (provider === "github" && hasGitHubRepositoryPatch(config)) {
    return validateGitHubRepoRefs(
      rawListEntriesFromConfig(
        config,
        GITHUB_REPOSITORY_CONFIG_KEYS,
        "github",
      ).map((entry) => entry.raw),
    );
  }
  return [];
}

export function describeSourceConfigIssues(
  issues: readonly SourceConfigIssue[],
) {
  const parts: string[] = [];
  const dms = issues.filter((issue) => issue.code === "slack_direct_message");
  const slack = issues.filter(
    (issue) =>
      issue.field === "slackChannels" && issue.code !== "slack_direct_message",
  );
  const github = issues.filter((issue) => issue.field === "githubRepositories");
  if (dms.length) {
    parts.push(
      `Slack direct-message ${listLabel(dms)}: ${entryList(dms)}. Brain only syncs public and private channels, not DMs or group DMs.`,
    );
  }
  if (slack.length) {
    parts.push(
      `Invalid Slack channel ${listLabel(slack)}: ${entryList(slack)}. Use a channel ID like C0123456789 or a #channel-name.`,
    );
  }
  if (github.length) {
    parts.push(
      `Invalid GitHub repository ${listLabel(github)}: ${entryList(github)}. Use owner/repo or a github.com repository URL.`,
    );
  }
  return parts.join(" ");
}

function listLabel(issues: readonly SourceConfigIssue[]) {
  return issues.length === 1 ? "entry" : "entries";
}

function entryList(issues: readonly SourceConfigIssue[]) {
  return issues.map((issue) => JSON.stringify(issue.value)).join(", ");
}
