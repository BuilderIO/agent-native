import type { OperationDefinitionInput } from "../operations.js";

const project = {
  name: "projectId",
  type: "string",
  required: true,
  label: "Project",
} as const;

// Builder ignores the branch name a start asks for and returns its own, so every step after the start reads the name from the start step's receipt.
const followBranch = {
  name: "branchName",
  type: "string",
  required: true,
  label: "Branch",
  description:
    "The branch Builder returned for the task: bind it to nodes.<start step>.externalRef. The name the start asked for is not the one Builder keeps.",
} as const;

const task = [project, followBranch] as const;

// Starting or following up lands on this project and branch, so a model never picks them.
const taskTarget = task.map((field) => ({ ...field, target: true }) as const);

/**
 * What the code-side dispatch gate judges before Builder is started. They are
 * required fields, so a graph cannot start Builder without binding each one,
 * and the values that fail the gate come first, so a node added from the
 * palette starts out refused.
 */
const dispatchGate: OperationDefinitionInput["fields"] = [
  {
    name: "clearBug",
    type: "boolean",
    required: true,
    label: "Clear bug",
  },
  {
    name: "productUxImplications",
    type: "boolean",
    required: true,
    label: "Product or design question",
  },
  {
    name: "risk",
    type: "enum",
    enum: ["unknown", "negligible", "low", "medium", "high", "critical"],
    required: true,
    label: "Risk",
  },
  {
    name: "confidence",
    type: "enum",
    enum: ["unknown", "low", "medium", "high"],
    required: true,
    label: "Confidence",
  },
  {
    name: "alreadyClaimed",
    type: "boolean",
    required: true,
    label: "Already claimed by a person",
  },
  // A list of guard codes, such as ["auth"], or [] when the change touches none.
  {
    name: "categories",
    type: "json",
    required: true,
    label: "Sensitive areas touched",
  },
];

export const builderOperations: OperationDefinitionInput[] = [
  {
    id: "builder.start",
    provider: "builder",
    label: "Builder: start a task",
    nodeKinds: ["agent"],
    effect: "write",
    fields: [
      { ...project, target: true },
      {
        name: "branchName",
        type: "string",
        required: true,
        target: true,
        label: "Branch",
        description:
          "The branch name to ask for, and the only duplicate guard: a start finds an earlier task only by this exact name, and Builder renames branches, so a start whose receipt was lost can start a second task. Use a name unique to the task. Read the name Builder kept from nodes.<this step>.externalRef.",
      },
      { name: "prompt", type: "text", required: true, label: "Task" },
      {
        name: "userEmail",
        type: "string",
        target: true,
        label: "Requested by",
      },
      ...dispatchGate,
    ],
    implementation: { type: "builder", op: "start" },
    outputs: [
      { name: "accepted", type: "boolean" },
      { name: "projectId", type: "string" },
      {
        name: "branchName",
        type: "string",
        description:
          "The branch Builder returned, which may differ from the one asked for. The same value is externalRef.",
      },
      {
        name: "status",
        type: "string",
        description:
          "Builder's own word for the start, or existing when an active branch already had the requested name and no new prompt was sent.",
      },
      {
        name: "url",
        type: "string",
        description:
          "Where to watch the task; absent when an existing branch was reused.",
      },
      {
        name: "reused",
        type: "boolean",
        description:
          "Only on a result that found an active branch under the requested name; the new prompt was not sent.",
      },
      {
        name: "recovered",
        type: "boolean",
        description:
          "Only on a result that confirmed a start Builder had answered badly.",
      },
    ],
    receipt: { externalRef: "branchName", url: "url" },
    credential: { provider: "builder" },
  },
  {
    id: "builder.check",
    provider: "builder",
    label: "Builder: check a task",
    nodeKinds: ["agent"],
    effect: "read",
    fields: [...task],
    implementation: { type: "builder", op: "check" },
    outputs: [
      {
        name: "state",
        type: "string",
        description:
          "working, stuck (waiting for input, or idle with no pull request past the window), completed (Builder is idle and a pull request exists, open, closed or draft: read prStatus), failed (archived or deleted without a merge), or not_found (no active branch under this name). not_found is not a failure: the task may have finished and been archived, the name may not be the one Builder returned, or it was never created. Wait and check again, or hand it to a person.",
      },
      {
        name: "reason",
        type: "string",
        description:
          "Why the state is what it is, such as pull_request_open or branch_not_found. Put it in any message that says Builder is something.",
      },
      {
        name: "message",
        type: "string",
        nullable: true,
        description:
          "A sentence for a person, set only when state is not_found; null otherwise.",
      },
      {
        name: "agentState",
        type: "string",
        nullable: true,
        description:
          "running, waiting or idle; null when Builder recorded none.",
      },
      {
        name: "branchState",
        type: "string",
        description: "active, archived, deleted or not_found.",
      },
      { name: "archived", type: "boolean" },
      {
        name: "prStatus",
        type: "string",
        nullable: true,
        description:
          "open, closed, merged, draft or approved; null with no pull request.",
      },
      {
        name: "prUrl",
        type: "string",
        nullable: true,
        description: "Null until Builder opens a pull request.",
      },
      {
        name: "prNumber",
        type: "number",
        nullable: true,
        description:
          "Null until a pull request exists. Test hasPullRequest, never prNumber > 0.",
      },
      {
        name: "prRepository",
        type: "string",
        nullable: true,
        description: "owner/name the pull request is in.",
      },
      { name: "hasPullRequest", type: "boolean" },
      {
        name: "lastActivityAt",
        type: "string",
        nullable: true,
        description: "ISO time of Builder's last recorded activity.",
      },
      { name: "idleForMs", type: "number", nullable: true },
    ],
    credential: { provider: "builder" },
  },
  {
    id: "builder.followUp",
    provider: "builder",
    label: "Builder: send a follow-up",
    nodeKinds: ["agent"],
    effect: "write",
    fields: [
      ...taskTarget,
      { name: "userMessage", type: "text", required: true, label: "Message" },
    ],
    implementation: { type: "builder", op: "followUp" },
    outputs: [
      {
        name: "accepted",
        type: "boolean",
        description:
          "Builder queued the message. It does not say Builder acted on it.",
      },
      { name: "projectId", type: "string" },
      { name: "branchName", type: "string" },
    ],
    receipt: { externalRef: "branchName" },
    credential: { provider: "builder" },
  },
];
