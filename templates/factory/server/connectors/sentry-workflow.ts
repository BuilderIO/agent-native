import { buildProviderApiAuditSummary } from "@agent-native/core/provider-api/actions/provider-api-audit";

import { sendProviderStep } from "../lib/provider-operation.js";
import {
  failWorkflowAction,
  isWorkflowActionError,
} from "../lib/workflow-action-errors.js";
import { clipText } from "../lib/workflow-action-support.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  asRead,
  catalogOperation,
  isRecord,
  textOf,
} from "./provider-step-support.js";

export const SENTRY_RESOLUTIONS = [
  "resolved",
  "resolvedInNextRelease",
] as const;
export const SENTRY_ASSIGNEE_KINDS = ["user", "team", "nobody"] as const;
type SentryResolution = (typeof SENTRY_RESOLUTIONS)[number];
type SentryAssigneeKind = (typeof SENTRY_ASSIGNEE_KINDS)[number];

// Each is pasted into a path or a body, so only the shape Sentry itself issues
// may get there.
const ISSUE_ID = /^\d{1,20}$/;
const ORG_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const TEAM_SLUG = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const NUMERIC_ID = /^\d{1,20}$/;
const MAX_EMAIL_CHARS = 254;
const MAX_NAME_CHARS = 120;

interface SentryCall {
  identity: { userEmail: string; orgId: string; factoryId: string };
  signal?: AbortSignal | undefined;
}

interface IssuePath {
  path: string;
  /** Left for the connection to fill when the graph names no organization. */
  openPlaceholders: string[];
}

function invalid(what: string, shape: string): never {
  return failWorkflowAction({
    message: `${what} is not valid: ${shape}.`,
    errorCode: "sentry_input_invalid",
    statusCode: 400,
  });
}

function checkIssueId(value: string): string {
  const id = value.trim();
  return ISSUE_ID.test(id)
    ? id
    : invalid("The issue id", "it is the issue's numeric id, digits only");
}

function checkOrgSlug(value: string | undefined): string | undefined {
  const slug = value?.trim();
  if (slug === undefined || slug === "") return undefined;
  return ORG_SLUG.test(slug)
    ? slug
    : invalid(
        "The organization slug",
        "letters, digits, dots, dashes and underscores",
      );
}

function isEmail(text: string): boolean {
  if (text.length > MAX_EMAIL_CHARS) return false;
  const at = text.indexOf("@");
  const domain = text.slice(at + 1);
  return (
    at > 0 &&
    at === text.lastIndexOf("@") &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/[\s<>()[\]\\,;:"]/.test(text)
  );
}

function issuePath(issueId: string, orgSlug: string | undefined): IssuePath {
  return orgSlug === undefined
    ? {
        path: `/organizations/{orgSlug}/issues/${issueId}/`,
        openPlaceholders: ["orgSlug"],
      }
    : {
        path: `/organizations/${encodeURIComponent(orgSlug)}/issues/${issueId}/`,
        openPlaceholders: [],
      };
}

function sameId(value: unknown, expected: string): boolean {
  return textOf(value) === expected;
}

/** What Sentry hands back for an update: the issue, as it is now. */
function readUpdatedIssue(
  json: unknown,
  issueId: string,
): Record<string, unknown> | undefined {
  return isRecord(json) && sameId(json.id, issueId) ? json : undefined;
}

function permalinkOf(issue: Record<string, unknown>): string | null {
  const { permalink } = issue;
  return typeof permalink === "string" &&
    URL.canParse(permalink) &&
    /^https?:$/.test(new URL(permalink).protocol)
    ? permalink
    : null;
}

/**
 * Resolves an issue, once. Sentry takes a repeat as it is, so there is no read
 * first; its answer is the issue as it is now and must say resolved, or the
 * write is reported as having an unknown outcome rather than as done.
 */
export async function resolveSentryIssue(
  call: SentryCall,
  input: { issueId: string; orgSlug?: string | undefined; resolution: string },
) {
  const issueId = checkIssueId(input.issueId);
  const orgSlug = checkOrgSlug(input.orgSlug);
  if (!(SENTRY_RESOLUTIONS as readonly string[]).includes(input.resolution)) {
    invalid("The resolution", `one of ${SENTRY_RESOLUTIONS.join(", ")}`);
  }
  const resolution = input.resolution as SentryResolution;
  const answer = await sendProviderStep({
    def: catalogOperation("sentry.resolveIssue"),
    request: {
      method: "PUT",
      ...issuePath(issueId, orgSlug),
      body: { status: resolution },
    },
    identity: call.identity,
    signal: call.signal,
  });
  const issue = readUpdatedIssue(answer.json, issueId);
  if (!issue || issue.status !== "resolved") {
    return answer.unreadable("resolved_not_confirmed");
  }
  return {
    ok: true as const,
    issueId,
    inNextRelease: resolution === "resolvedInNextRelease",
    url: permalinkOf(issue),
    externalRef: `${issueId}:resolved`,
  };
}

/** The team's numeric id: the one form of a team Sentry takes as an assignee. */
async function readTeamId(
  call: SentryCall,
  def: OperationDefinition,
  orgSlug: string | undefined,
  teamSlug: string,
): Promise<string> {
  const org = orgSlug === undefined ? "{orgSlug}" : encodeURIComponent(orgSlug);
  try {
    const answer = await sendProviderStep({
      def: asRead(def),
      request: {
        method: "GET",
        path: `/teams/${org}/${teamSlug}/`,
        openPlaceholders: orgSlug === undefined ? ["orgSlug"] : [],
      },
      identity: call.identity,
      signal: call.signal,
    });
    const team = isRecord(answer.json) ? answer.json : undefined;
    const id = textOf(team?.id);
    if (!team || !id || !NUMERIC_ID.test(id) || team.slug !== teamSlug) {
      return answer.unreadable("team_shape");
    }
    return id;
  } catch (error) {
    if (
      isWorkflowActionError(error) &&
      error.errorCode === "provider_not_found"
    ) {
      return failWorkflowAction({
        message: `Sentry has no team "${teamSlug}" in this organization, so nothing was assigned.`,
        errorCode: "sentry_team_not_found",
        statusCode: 404,
      });
    }
    throw error;
  }
}

function assigneeBody(
  kind: SentryAssigneeKind,
  assignee: string | undefined,
): { email: string } | { teamSlug: string } | { nobody: true } {
  const value = assignee?.trim() ?? "";
  if (kind === "nobody") {
    return value === ""
      ? { nobody: true }
      : invalid("The assignee", "leave it empty to unassign");
  }
  if (kind === "user") {
    return isEmail(value)
      ? { email: value }
      : invalid("The assignee", "a person is assigned by email address");
  }
  return TEAM_SLUG.test(value)
    ? { teamSlug: value }
    : invalid(
        "The assignee",
        "a team is assigned by its slug, in lowercase letters, digits, dashes and underscores",
      );
}

/**
 * Assigns an issue, once: to a person by email, to a team by slug (read first
 * to its id, and an unknown slug is refused before anything is sent), or to
 * nobody. The answer is the issue as it is now and must show the assignment, or
 * the write is reported as having an unknown outcome.
 */
export async function assignSentryIssue(
  call: SentryCall,
  input: {
    issueId: string;
    orgSlug?: string | undefined;
    assigneeKind: string;
    assignee?: string | undefined;
  },
) {
  const issueId = checkIssueId(input.issueId);
  const orgSlug = checkOrgSlug(input.orgSlug);
  if (
    !(SENTRY_ASSIGNEE_KINDS as readonly string[]).includes(input.assigneeKind)
  ) {
    invalid(
      "The kind of assignee",
      `one of ${SENTRY_ASSIGNEE_KINDS.join(", ")}`,
    );
  }
  const kind = input.assigneeKind as SentryAssigneeKind;
  const target = assigneeBody(kind, input.assignee);
  const def = catalogOperation("sentry.assignIssue");

  let assignedTo: string;
  let reference: string;
  let teamId: string | undefined;
  if ("nobody" in target) {
    assignedTo = "";
    reference = `${issueId}:unassigned`;
  } else if ("email" in target) {
    assignedTo = target.email;
    reference = `${issueId}:user:${target.email}`;
  } else {
    teamId = await readTeamId(call, def, orgSlug, target.teamSlug);
    assignedTo = `team:${teamId}`;
    reference = `${issueId}:team:${target.teamSlug}`;
  }

  const answer = await sendProviderStep({
    def,
    request: {
      method: "PUT",
      ...issuePath(issueId, orgSlug),
      body: { assignedTo },
    },
    identity: call.identity,
    signal: call.signal,
  });
  const issue = readUpdatedIssue(answer.json, issueId);
  if (!issue || !("assignedTo" in issue)) {
    return answer.unreadable("assignment_not_confirmed");
  }
  const actor = issue.assignedTo;
  if (kind === "nobody") {
    if (actor !== null) return answer.unreadable("assignment_not_confirmed");
  } else if (
    !isRecord(actor) ||
    actor.type !== kind ||
    (teamId !== undefined && !sameId(actor.id, teamId))
  ) {
    return answer.unreadable("assignment_not_confirmed");
  }
  const name = isRecord(actor) ? textOf(actor.name) : undefined;
  return {
    ok: true as const,
    issueId,
    assignedType: kind === "nobody" ? null : kind,
    assignedName:
      name === undefined ? null : clipText(name, MAX_NAME_CHARS).text,
    url: permalinkOf(issue),
    externalRef: reference,
  };
}

/** The id as the audit row names its target; nothing that is not an id. */
export function auditedIssueId(issueId: unknown): string | undefined {
  const id = typeof issueId === "string" ? issueId.trim() : "";
  return ISSUE_ID.test(id) ? id : undefined;
}

/**
 * What the audit row of a Sentry write says: the method and the path, never
 * the assignee or a body. An id that is not one is not echoed into the path.
 */
export function sentryWriteAuditSummary(issueId: unknown): string {
  return buildProviderApiAuditSummary({
    method: "PUT",
    provider: "sentry",
    path: `/organizations/{orgSlug}/issues/${auditedIssueId(issueId) ?? "{issueId}"}/`,
  });
}
