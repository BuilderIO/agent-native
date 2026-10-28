import type { OperationDefinitionInput } from "../operations.js";

export const factoryOperations: OperationDefinitionInput[] = [
  {
    id: "factory.listItems",
    provider: "factory",
    label: "Factory: list items in a status",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      { name: "status", type: "string", required: true, label: "Status" },
      { name: "limit", type: "number", default: 50, label: "Most items" },
    ],
    implementation: {
      type: "action",
      action: "list-factory-items",
      argMap: { status: "status", limit: "limit" },
    },
    credential: { provider: "factory" },
  },
  {
    id: "factory.mergeGate",
    provider: "factory",
    label: "Factory: check a pull request may merge",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      {
        name: "repo",
        type: "string",
        required: true,
        label: "Repository (owner/name)",
      },
      { name: "number", type: "number", required: true, label: "Pull request" },
    ],
    implementation: {
      type: "action",
      action: "get-factory-merge-gate",
      argMap: { repo: "repo", number: "number" },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "eligible",
        type: "boolean",
        description: "True only when no rule holds the pull request back.",
      },
      {
        name: "reasons",
        type: "list",
        description:
          "One sentence per rule that holds it back; empty when eligible.",
      },
      { name: "reasonCodes", type: "list" },
      {
        name: "reasonText",
        type: "string",
        description: "The reasons joined into one string, for a message.",
      },
      {
        name: "approvals",
        type: "object",
        description:
          "Counts of approvals found: seen, qualifying, byAuthor, fromBots, fromNonCollaborators, stale.",
      },
      { name: "repo", type: "string" },
      { name: "number", type: "number" },
      { name: "url", type: "string", nullable: true },
      { name: "state", type: "string", nullable: true },
      { name: "headSha", type: "string", nullable: true },
      { name: "checkedAt", type: "string" },
    ],
    credential: { provider: "factory" },
  },
];
