import type { OperationDefinitionInput } from "../operations.js";

const issueKeyRead = {
  name: "issueKey",
  type: "string",
  required: true,
  label: "Issue",
  description: "Issue key such as PROJ-123.",
} as const;

export const jiraOperations: OperationDefinitionInput[] = [
  {
    // Version 2 takes `description` as plain text; version 3 requires a
    // structured document. The response has no browse link, only the key.
    id: "jira.createIssue",
    provider: "jira",
    label: "Jira: create an issue",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "projectKey",
        type: "string",
        required: true,
        target: true,
        label: "Project",
      },
      { name: "title", type: "string", required: true, label: "Title" },
      { name: "description", type: "text", label: "Description" },
      {
        name: "issueType",
        type: "string",
        default: "Bug",
        label: "Issue type",
      },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/rest/api/2/issue",
      bodyTemplate: {
        fields: {
          project: { key: "{projectKey}" },
          issuetype: { name: "{issueType}" },
          summary: "{title}",
          description: "{description}",
        },
      },
    },
    receipt: { externalRef: "key" },
    credential: { provider: "jira" },
  },
  {
    id: "jira.getIssue",
    provider: "jira",
    label: "Jira: read an issue",
    description:
      "Reads one issue by key: status, resolution, assignee, labels and the names of the transitions it can take now. Lists are capped and say truncated.",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [issueKeyRead],
    implementation: { type: "action", action: "get-jira-issue" },
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "issueKey", type: "string" },
      { name: "summary", type: "string" },
      { name: "status", type: "string" },
      {
        name: "statusCategory",
        type: "string",
        nullable: true,
        description: "new, indeterminate or done.",
      },
      { name: "resolution", type: "string", nullable: true },
      { name: "assignee", type: "string", nullable: true },
      { name: "labels", type: "list" },
      {
        name: "transitionNames",
        type: "list",
        description: "What jira.transitionIssue can be given now.",
      },
      { name: "truncated", type: "boolean" },
    ],
    credential: { provider: "jira" },
  },
  {
    id: "jira.listTransitions",
    provider: "jira",
    label: "Jira: list an issue's transitions",
    description:
      "Lists the transitions the issue can take now, each with its id, name and destination status.",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [issueKeyRead],
    implementation: { type: "action", action: "list-jira-transitions" },
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "count", type: "number" },
      {
        name: "transitions",
        type: "list",
        description: "id, name and toStatus of each.",
      },
      { name: "truncated", type: "boolean" },
    ],
    credential: { provider: "jira" },
  },
  {
    id: "jira.transitionIssue",
    provider: "jira",
    label: "Jira: move an issue",
    description:
      "Moves an issue through one transition chosen by name or id from the ones it can take now. An unknown or ambiguous name is refused and nothing is sent. The write is sent once.",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "issueKey",
        type: "string",
        required: true,
        target: true,
        label: "Issue",
        description: "Issue key such as PROJ-123.",
      },
      {
        name: "transition",
        type: "string",
        required: true,
        target: true,
        label: "Transition",
        description:
          "Transition name or id, such as Done. Naming the status the issue is already in succeeds with alreadyInState and sends nothing.",
      },
    ],
    implementation: { type: "action", action: "transition-jira-issue" },
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "issueKey", type: "string" },
      { name: "fromStatus", type: "string" },
      {
        name: "status",
        type: "string",
        description: "The status the issue is in now.",
      },
      {
        name: "alreadyInState",
        type: "boolean",
        description: "True when nothing was sent.",
      },
      { name: "transitionName", type: "string", nullable: true },
    ],
    receipt: { externalRef: "externalRef" },
    credential: { provider: "jira" },
  },
];
