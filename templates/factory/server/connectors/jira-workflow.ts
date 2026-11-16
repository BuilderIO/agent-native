import { buildProviderApiAuditSummary } from "@agent-native/core/provider-api/actions/provider-api-audit";

import { sendProviderStep } from "../lib/provider-operation.js";
import { failWorkflowAction } from "../lib/workflow-action-errors.js";
import { clipText } from "../lib/workflow-action-support.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  asRead,
  catalogOperation,
  isRecord,
  textOf,
} from "./provider-step-support.js";

// Jira's key shape: an uppercase project key, a dash, the issue number. It is
// pasted into a path, so nothing else may reach it.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,49}-[1-9]\d{0,9}$/;
const MAX_TRANSITION_TEXT = 120;
const MAX_SUMMARY_CHARS = 300;
const MAX_NAME_CHARS = 120;
const MAX_LABELS = 50;
const MAX_TRANSITIONS = 50;
const NAMES_IN_A_REFUSAL = 10;
const NAME_IN_A_REFUSAL_CHARS = 60;

interface JiraCall {
  identity: { userEmail: string; orgId: string; factoryId: string };
  signal?: AbortSignal | undefined;
}

interface JiraTransition {
  id: string;
  name: string;
  toStatusId: string;
  toStatus: string;
}

interface JiraIssue {
  key: string;
  summary: string;
  status: { id: string; name: string; category: string | null };
  resolution: string | null;
  assignee: { name: string; accountId: string | null } | null;
  labels: string[];
  transitions: JiraTransition[];
}

function checkIssueKey(value: string): string {
  const key = value.trim();
  if (!ISSUE_KEY.test(key)) {
    return failWorkflowAction({
      message: `"${clipText(key, 40).text}" is not a Jira issue key. A key is the project key in capitals, a dash and a number, such as PROJ-123.`,
      errorCode: "jira_issue_key_invalid",
      statusCode: 400,
    });
  }
  return key;
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function checkTransitionText(value: string): string {
  const text = value.trim();
  if (
    text === "" ||
    text.length > MAX_TRANSITION_TEXT ||
    hasControlCharacter(text)
  ) {
    return failWorkflowAction({
      message: `A transition is a name or an id of up to ${MAX_TRANSITION_TEXT} characters, on one line.`,
      errorCode: "jira_transition_invalid",
      statusCode: 400,
    });
  }
  return text;
}

function readTransitions(value: unknown): JiraTransition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const transitions: JiraTransition[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.to)) return undefined;
    const id = textOf(entry.id);
    const name = textOf(entry.name);
    const toStatusId = textOf(entry.to.id);
    const toStatus = textOf(entry.to.name);
    if (!id || !name || !toStatusId || !toStatus) return undefined;
    transitions.push({ id, name, toStatusId, toStatus });
  }
  return transitions;
}

function readIssue(json: unknown): JiraIssue | undefined {
  if (!isRecord(json) || !isRecord(json.fields)) return undefined;
  const { fields } = json;
  const key = textOf(json.key);
  const transitions = readTransitions(json.transitions);
  if (!key || !ISSUE_KEY.test(key) || !transitions) return undefined;
  if (!isRecord(fields.status)) return undefined;
  const statusId = textOf(fields.status.id);
  const statusName = textOf(fields.status.name);
  const summary = typeof fields.summary === "string" ? fields.summary : null;
  if (!statusId || !statusName || summary === null) return undefined;
  const category = isRecord(fields.status.statusCategory)
    ? (textOf(fields.status.statusCategory.key) ?? null)
    : null;

  let resolution: string | null = null;
  if (fields.resolution !== null && fields.resolution !== undefined) {
    if (!isRecord(fields.resolution)) return undefined;
    resolution = textOf(fields.resolution.name) ?? null;
    if (resolution === null) return undefined;
  }
  let assignee: JiraIssue["assignee"] = null;
  if (fields.assignee !== null && fields.assignee !== undefined) {
    if (!isRecord(fields.assignee)) return undefined;
    const accountId = textOf(fields.assignee.accountId) ?? null;
    const name = textOf(fields.assignee.displayName) ?? accountId;
    if (name === null) return undefined;
    assignee = { name, accountId };
  }
  if (
    !Array.isArray(fields.labels) ||
    fields.labels.some((label) => typeof label !== "string")
  ) {
    return undefined;
  }
  return {
    key,
    summary,
    status: { id: statusId, name: statusName, category },
    resolution,
    assignee,
    labels: fields.labels as string[],
    transitions,
  };
}

async function readIssueFromJira(
  call: JiraCall,
  def: OperationDefinition,
  key: string,
): Promise<JiraIssue> {
  const answer = await sendProviderStep({
    def,
    request: {
      method: "GET",
      path: `/rest/api/2/issue/${encodeURIComponent(key)}`,
      query: {
        fields: "summary,status,assignee,resolution,labels",
        expand: "transitions",
      },
    },
    identity: call.identity,
    signal: call.signal,
  });
  return readIssue(answer.json) ?? answer.unreadable("issue_shape");
}

/** The most that fits: a clipped text or a shortened list is said, never passed as whole. */
function bounded(text: string, max: number, cut: { value: boolean }): string {
  const clipped = clipText(text, max);
  if (clipped.clipped) cut.value = true;
  return clipped.text;
}

function takeFirst<T>(
  list: readonly T[],
  max: number,
  cut: { value: boolean },
): T[] {
  if (list.length > max) cut.value = true;
  return list.slice(0, max);
}

export async function getJiraIssue(
  call: JiraCall,
  input: { issueKey: string },
) {
  const key = checkIssueKey(input.issueKey);
  const issue = await readIssueFromJira(
    call,
    catalogOperation("jira.getIssue"),
    key,
  );
  const cut = { value: false };
  return {
    ok: true as const,
    issueKey: issue.key,
    summary: bounded(issue.summary, MAX_SUMMARY_CHARS, cut),
    status: bounded(issue.status.name, MAX_NAME_CHARS, cut),
    statusCategory: issue.status.category,
    resolution:
      issue.resolution === null
        ? null
        : bounded(issue.resolution, MAX_NAME_CHARS, cut),
    assignee:
      issue.assignee === null
        ? null
        : bounded(issue.assignee.name, MAX_NAME_CHARS, cut),
    labels: takeFirst(issue.labels, MAX_LABELS, cut).map((label) =>
      bounded(label, MAX_NAME_CHARS, cut),
    ),
    transitionNames: takeFirst(issue.transitions, MAX_TRANSITIONS, cut).map(
      (transition) => bounded(transition.name, MAX_NAME_CHARS, cut),
    ),
    truncated: cut.value,
  };
}

export async function listJiraTransitions(
  call: JiraCall,
  input: { issueKey: string },
) {
  const key = checkIssueKey(input.issueKey);
  const answer = await sendProviderStep({
    def: catalogOperation("jira.listTransitions"),
    request: {
      method: "GET",
      path: `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
    },
    identity: call.identity,
    signal: call.signal,
  });
  const transitions = isRecord(answer.json)
    ? readTransitions(answer.json.transitions)
    : undefined;
  if (!transitions) return answer.unreadable("transitions_shape");
  const cut = { value: false };
  return {
    ok: true as const,
    count: transitions.length,
    transitions: takeFirst(transitions, MAX_TRANSITIONS, cut).map(
      (transition) => ({
        id: transition.id,
        name: bounded(transition.name, MAX_NAME_CHARS, cut),
        toStatus: bounded(transition.toStatus, MAX_NAME_CHARS, cut),
      }),
    ),
    truncated: cut.value,
  };
}

type Choice =
  | { send: JiraTransition }
  | { send: null; reason: "already in the status named" | "loops back" };

function describeCandidates(transitions: readonly JiraTransition[]): string {
  const shown = transitions
    .slice(0, NAMES_IN_A_REFUSAL)
    .map(
      (transition) =>
        `${clipText(transition.name, NAME_IN_A_REFUSAL_CHARS).text} (id ${transition.id}, to ${clipText(transition.toStatus, NAME_IN_A_REFUSAL_CHARS).text})`,
    );
  const more = transitions.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

/**
 * The transition `wanted` names among the ones the issue can take now: an id
 * is exact, a name matches without regard to case. Nothing is guessed: a name
 * that matches none, or more than one, is refused. The one way to succeed
 * without a match is naming the status the issue is already in.
 */
function chooseTransition(wanted: string, issue: JiraIssue): Choice {
  const byId = issue.transitions.filter(
    (transition) => transition.id === wanted,
  );
  const lower = wanted.toLowerCase();
  const byName = issue.transitions.filter(
    (transition) => transition.name.toLowerCase() === lower,
  );
  const matches = byId.length > 0 ? byId : byName;
  if (matches.length > 1) {
    return failWorkflowAction({
      message: `More than one transition of ${issue.key} is named "${clipText(wanted, NAME_IN_A_REFUSAL_CHARS).text}": ${describeCandidates(matches)}. Use the id of the one you mean.`,
      errorCode: "jira_transition_ambiguous",
      statusCode: 409,
    });
  }
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only) {
    return only.toStatusId === issue.status.id
      ? { send: null, reason: "loops back" }
      : { send: only };
  }
  if (lower === issue.status.name.toLowerCase()) {
    return { send: null, reason: "already in the status named" };
  }
  return failWorkflowAction({
    message:
      issue.transitions.length === 0
        ? `${issue.key} has no transition available from ${clipText(issue.status.name, NAME_IN_A_REFUSAL_CHARS).text}, so "${clipText(wanted, NAME_IN_A_REFUSAL_CHARS).text}" cannot be applied.`
        : `${issue.key} has no transition "${clipText(wanted, NAME_IN_A_REFUSAL_CHARS).text}" from ${clipText(issue.status.name, NAME_IN_A_REFUSAL_CHARS).text}. It can take: ${describeCandidates(issue.transitions)}.`,
    errorCode: "jira_transition_not_found",
    statusCode: 409,
  });
}

/**
 * Moves an issue, once. The issue is read first, the name is resolved to the
 * id Jira itself offers, and only that id is sent; an issue already where the
 * name says is a success that sends nothing. The reference is the key and the
 * status the issue is in, so it reads the same whether this call moved it or
 * found it there.
 */
export async function transitionJiraIssue(
  call: JiraCall,
  input: { issueKey: string; transition: string },
) {
  const key = checkIssueKey(input.issueKey);
  const wanted = checkTransitionText(input.transition);
  const def = catalogOperation("jira.transitionIssue");
  const issue = await readIssueFromJira(call, asRead(def), key);
  const choice = chooseTransition(wanted, issue);
  const fromStatus = bounded(issue.status.name, MAX_NAME_CHARS, {
    value: false,
  });

  if (choice.send === null) {
    return {
      ok: true as const,
      issueKey: issue.key,
      fromStatus,
      status: fromStatus,
      alreadyInState: true as const,
      transitionName: null,
      externalRef: `${issue.key}:${fromStatus}`,
    };
  }
  const { send } = choice;
  await sendProviderStep({
    def,
    request: {
      method: "POST",
      path: `/rest/api/2/issue/${encodeURIComponent(issue.key)}/transitions`,
      body: { transition: { id: send.id } },
    },
    identity: call.identity,
    signal: call.signal,
  });
  const status = bounded(send.toStatus, MAX_NAME_CHARS, { value: false });
  return {
    ok: true as const,
    issueKey: issue.key,
    fromStatus,
    status,
    alreadyInState: false as const,
    transitionName: bounded(send.name, MAX_NAME_CHARS, { value: false }),
    externalRef: `${issue.key}:${status}`,
  };
}

/** The key as the audit row names its target; nothing that is not a key. */
export function auditedIssueKey(issueKey: unknown): string | undefined {
  const key = typeof issueKey === "string" ? issueKey.trim() : "";
  return ISSUE_KEY.test(key) ? key : undefined;
}

/**
 * What the audit row of a transition says: the method and the path, never the
 * transition or a body. A key that is not one is not echoed into the path.
 */
export function jiraTransitionAuditSummary(issueKey: unknown): string {
  return buildProviderApiAuditSummary({
    method: "POST",
    provider: "jira",
    path: `/rest/api/2/issue/${auditedIssueKey(issueKey) ?? "{issueKey}"}/transitions`,
  });
}
