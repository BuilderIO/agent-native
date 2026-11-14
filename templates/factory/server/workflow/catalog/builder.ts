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
    description:
      "True only when the report describes wrong behavior and the correct behavior is evident; false for a feature request, a question or an opinion.",
  },
  {
    name: "productUxImplications",
    type: "boolean",
    required: true,
    label: "Product or design question",
    description:
      "True only when the fix needs a product or design decision; false when the expected behavior is already clear and the fix restores it, even for a UI or copy bug.",
  },
  {
    name: "risk",
    type: "enum",
    enum: ["unknown", "negligible", "low", "medium", "high", "critical"],
    required: true,
    label: "Risk",
    description:
      "Low means a contained change with no data, auth, money or migration; only low is started.",
  },
  {
    name: "confidence",
    type: "enum",
    enum: ["unknown", "low", "medium", "high"],
    required: true,
    label: "Confidence",
    description:
      "High only when the report names the cause or the expected behavior and the repository would confirm it; only high is started.",
  },
  {
    name: "alreadyClaimed",
    type: "boolean",
    required: true,
    label: "Already claimed by a person",
    description:
      "True when a person already reacted to the report, so it is theirs and is not started.",
  },
  // A list of guard codes, such as ["auth"], or [] when the change touches none.
  {
    name: "categories",
    type: "json",
    required: true,
    label: "Sensitive areas touched",
    description:
      'Guard codes the fix would touch, such as ["auth"], or [] when it touches none.',
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
          "The branch to ask for. Builder keeps its own name, so a lookup by it never finds a renamed task. The guard that holds is the receipt (the same item at this step does not call Builder again); a lost one can mean a second task. Use a unique name. Read the kept name from nodes.<this step>.externalRef.",
      },
      { name: "prompt", type: "text", required: true, label: "Task" },
      {
        name: "reports",
        type: "json",
        required: true,
        label: "Reports",
        description:
          "The reports this task is for: bind item.reports for a group, or item.id for one. Factory adds each one's headline, author, link and text from its inbox under your Task. A report not kept in the inbox cannot be quoted and fails the start. Five at most.",
      },
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
      {
        name: "accepted",
        type: "boolean",
        description:
          "True on every answer this step returns: a start Builder did not accept fails the step. A start found already done does not carry it, because a receipt keeps only the fields that name a thing, so test externalRef instead.",
      },
      { name: "projectId", type: "string" },
      {
        name: "branchName",
        type: "string",
        description:
          "The branch Builder returned, which may differ from the one asked for. The same value is externalRef, which is also there on a start found already done; branchName is not.",
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
          "Where to watch the task; empty when an existing branch was reused or a failed start was confirmed, because Builder gave none then.",
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
