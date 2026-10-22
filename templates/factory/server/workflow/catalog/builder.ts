import type { OperationDefinitionInput } from "../operations.js";

const task = [
  { name: "projectId", type: "string", required: true, label: "Project" },
  { name: "branchName", type: "string", required: true, label: "Branch" },
] as const;

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
      ...taskTarget,
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
    receipt: { externalRef: "branchName" },
    credential: { provider: "builder" },
  },
];
