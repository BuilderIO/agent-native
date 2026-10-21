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
    credential: { provider: "factory" },
  },
];
