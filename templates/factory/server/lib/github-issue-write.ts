import { buildProviderApiAuditSummary } from "@agent-native/core/provider-api/actions/provider-api-audit";

import { GitHubRequestError } from "../triage/github-client.js";
import { failGitHubStep, type GitHubClient } from "./factory-pull-request.js";
import {
  gitHubRepositoriesEqual,
  parseGitHubRepositoryRef,
  type GitHubRepositoryRef,
} from "./github-repository.js";
import { failWorkflowAction } from "./workflow-action-errors.js";

export const GITHUB_LABEL_MAX_CHARS = 50;
export const GITHUB_LABELS_MAX = 5;

// A name is `owner/name` and nothing else: no scheme, host, query or extra
// segment, because the request path is built from it.
const OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
// Control and invisible format characters, and the comma GitHub's own label
// filters split on.
const LABEL_FORBIDDEN = /[\p{Cc}\p{Cf},]/u;
const ONLY_DOTS = /^\.+$/;

/** The repository of a write: `owner/name`. A URL is refused, not unpacked. */
export function parseIssueRepository(repo: string): GitHubRepositoryRef {
  const value = repo.trim();
  if (OWNER_REPO.test(value)) {
    try {
      return parseGitHubRepositoryRef(value);
    } catch {
      // coercion-ok: the refusal on the next line is the typed outcome.
    }
  }
  return failWorkflowAction({
    message: "The repository must be owner/name, not a URL.",
    errorCode: "github_repository_invalid",
    statusCode: 400,
  });
}

/**
 * A write lands only in the repository the factory is set up for, the rule the
 * merge gate applies (`repository_not_allowed`): another repository, and a
 * factory with none configured, are refused before any request leaves.
 */
function assertFactoryRepository(
  repository: GitHubRepositoryRef,
  configuredRepository: string | null,
): void {
  const label = repositoryLabel(repository);
  if (gitHubRepositoriesEqual(configuredRepository, label)) return;
  failWorkflowAction({
    message: configuredRepository
      ? `${label} is not this factory's repository (${configuredRepository}).`
      : "This factory has no repository configured, so it may not change labels in any.",
    errorCode: "repository_not_allowed",
    statusCode: 409,
  });
}

function checkIssueNumber(number: number): number {
  if (!Number.isInteger(number) || number < 1) {
    return failWorkflowAction({
      message:
        "The issue or pull request number must be a positive whole number.",
      errorCode: "github_number_invalid",
      statusCode: 400,
    });
  }
  return number;
}

function labelProblem(label: unknown): string | null {
  if (typeof label !== "string") return "is not text";
  const name = label.trim();
  if (!name) return "is empty";
  if ([...name].length > GITHUB_LABEL_MAX_CHARS) {
    return `is over ${GITHUB_LABEL_MAX_CHARS} characters`;
  }
  if (LABEL_FORBIDDEN.test(name)) {
    return "has a comma, a control character or an invisible character";
  }
  if (ONLY_DOTS.test(name)) return "is only dots";
  return null;
}

/** One label name, trimmed; a name GitHub could not hold, or that could change the request path, is refused. */
function checkLabel(label: unknown): string {
  const problem = labelProblem(label);
  if (problem) {
    return failWorkflowAction({
      message: `The label ${problem}.`,
      errorCode: "github_label_invalid",
      statusCode: 400,
    });
  }
  return (label as string).trim();
}

/** The labels to add: 1 to 5 names, trimmed, each once (GitHub reads names without regard to case). */
function checkLabels(labels: unknown): string[] {
  if (!Array.isArray(labels) || labels.length === 0) {
    return failWorkflowAction({
      message: "Give a list of at least one label.",
      errorCode: "github_label_invalid",
      statusCode: 400,
    });
  }
  const seen = new Set<string>();
  const checked: string[] = [];
  labels.forEach((label, index) => {
    const problem = labelProblem(label);
    if (problem) {
      failWorkflowAction({
        message: `Label ${index + 1} ${problem}.`,
        errorCode: "github_label_invalid",
        statusCode: 400,
      });
    }
    const name = (label as string).trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      checked.push(name);
    }
  });
  if (checked.length > GITHUB_LABELS_MAX) {
    return failWorkflowAction({
      message: `A step adds at most ${GITHUB_LABELS_MAX} labels; this one adds ${checked.length}.`,
      errorCode: "github_label_invalid",
      statusCode: 400,
      details: { count: checked.length, limit: GITHUB_LABELS_MAX },
    });
  }
  return checked;
}

/**
 * A failed GitHub write as a typed one, by what GitHub answered. Not being
 * connected, a rate limit and a refused credential are `failGitHubStep`'s, and
 * nothing was written. Any other 4xx means GitHub said no. A 5xx, a dropped
 * connection and an answer that cannot be read are all `_outcome_unknown`: the
 * write may have landed, and the engine stops for a person instead of repeating
 * it.
 */
function failGitHubWrite(error: unknown, what: string): never {
  if (error instanceof GitHubRequestError) {
    const { status } = error;
    if (!error.requestAttempted || error.rateLimited) {
      return failGitHubStep(error, what);
    }
    if (status === 401 || status === 403) return failGitHubStep(error, what);
    if (status === 404) {
      return failWorkflowAction({
        message: `GitHub could not find that issue or pull request while ${what}. Check the repository and number, and that the token can write to the repository (a token without access to a private repository gets this answer too).`,
        errorCode: "github_not_found",
        statusCode: 404,
        details: { status },
      });
    }
    if (status !== null && status >= 400 && status < 500 && status !== 408) {
      return failWorkflowAction({
        message: `GitHub rejected the request while ${what} (HTTP ${status}); nothing was written.`,
        errorCode: "github_write_rejected",
        statusCode: 424,
        details: { status },
      });
    }
  }
  return failWorkflowAction({
    message: `GitHub did not confirm whether the write finished while ${what}.`,
    errorCode: "github_labels_outcome_unknown",
    statusCode: 424,
  });
}

function repositoryLabel(repository: GitHubRepositoryRef): string {
  return `${repository.owner}/${repository.repo}`;
}

/**
 * Adds labels. Adding one the item already has changes nothing, so a repeat is
 * safe; the reference is derived from where and what, so a repeat has the same
 * one. Every label asked for must be in GitHub's answer, or the write is not
 * confirmed.
 */
export async function addLabelsToIssue(
  github: GitHubClient,
  input: {
    repo: string;
    number: number;
    labels: unknown;
    /** The repository the factory is set up for; null when it has none. */
    configuredRepository: string | null;
  },
) {
  const repository = parseIssueRepository(input.repo);
  assertFactoryRepository(repository, input.configuredRepository);
  const number = checkIssueNumber(input.number);
  const labels = checkLabels(input.labels);
  let now: string[];
  try {
    now = await github.addIssueLabels(repository, number, labels);
  } catch (error) {
    return failGitHubWrite(error, "adding labels");
  }
  const carried = new Set(now.map((name) => name.toLowerCase()));
  if (labels.some((label) => !carried.has(label.toLowerCase()))) {
    return failWorkflowAction({
      message:
        "GitHub answered without every label that was asked for, so it is not confirmed that they were added.",
      errorCode: "github_labels_outcome_unknown",
      statusCode: 424,
    });
  }
  // GitHub reads names without regard to case, so the reference does too.
  const ordered = labels.map((label) => label.toLowerCase()).sort();
  return {
    ok: true as const,
    labels: now,
    externalRef: `${repositoryLabel(repository)}#${number}+${ordered.join(",")}`,
  };
}

/**
 * Removes one label. An item that never had it is a success with
 * `alreadyAbsent`, the same end state; a missing item or repository is
 * `github_not_found`.
 */
export async function removeLabelFromIssue(
  github: GitHubClient,
  input: {
    repo: string;
    number: number;
    label: string;
    /** The repository the factory is set up for; null when it has none. */
    configuredRepository: string | null;
  },
) {
  const repository = parseIssueRepository(input.repo);
  assertFactoryRepository(repository, input.configuredRepository);
  const number = checkIssueNumber(input.number);
  const label = checkLabel(input.label);
  let removal;
  try {
    removal = await github.removeIssueLabel(repository, number, label);
  } catch (error) {
    return failGitHubWrite(error, "removing a label");
  }
  if (
    removal.labels?.some((name) => name.toLowerCase() === label.toLowerCase())
  ) {
    return failWorkflowAction({
      message:
        "GitHub answered with the label still on the item, so it is not confirmed that it was removed.",
      errorCode: "github_labels_outcome_unknown",
      statusCode: 424,
    });
  }
  return {
    ok: true as const,
    alreadyAbsent: !removal.removed,
    externalRef: `${repositoryLabel(repository)}#${number}-${label.toLowerCase()}`,
  };
}

/**
 * The audit row of a write: `POST github /repos/acme/web/issues/12/labels`, the
 * way chat's provider request is audited, and never the labels asked for. A
 * repository that is not `owner/name` is left out of the line rather than
 * copied into it.
 */
export function issueWriteAuditSummary(
  args: { repo: unknown; number: unknown; label?: unknown },
  method: "POST" | "DELETE",
  status: string,
): string {
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  const number = typeof args.number === "number" ? args.number : Number.NaN;
  const target =
    OWNER_REPO.test(repo) && Number.isInteger(number) && number > 0
      ? `/repos/${repo}/issues/${number}/labels`
      : "(an unreadable target)";
  const label =
    method === "DELETE" &&
    typeof args.label === "string" &&
    labelProblem(args.label) === null
      ? `/${encodeURIComponent(args.label.trim())}`
      : "";
  const line = buildProviderApiAuditSummary({
    method,
    provider: "github",
    path: `${target}${label}`,
  });
  return status === "success" ? line : `${line} (failed)`;
}

/** The audit row's target: the issue as `owner/name#12`, or no id when the target cannot be read. */
export function issueAuditTarget(args: { repo: unknown; number: unknown }): {
  type: "github-issue";
  id?: string;
  visibility: "org";
} {
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  const readable =
    OWNER_REPO.test(repo) &&
    typeof args.number === "number" &&
    Number.isInteger(args.number) &&
    args.number > 0;
  return {
    type: "github-issue",
    ...(readable ? { id: `${repo}#${args.number}` } : {}),
    visibility: "org",
  };
}
