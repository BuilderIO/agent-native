import type { OperationDefinitionInput } from "../operations.js";

export const factoryOperations: OperationDefinitionInput[] = [
  {
    id: "factory.listItems",
    provider: "factory",
    label: "Factory: list items in a status",
    nodeKinds: ["lookup"],
    effect: "read",
    // An item is 1 KB to 6 KB (its stored metadata and payload are most of
    // it), and story 01 reads the list once for each clear report. A report is
    // told apart from another by its title and text, found again by its thread
    // and link, and tied to Builder's task by the project and branch the
    // handed-off End recorded, so those are what is kept: about 0.7 KB an item
    // where a whole one is about 2 KB. 10,000 holds about 13 open reports and
    // says there are more (`hasMore`, `nextCursor`); with the thread at its
    // budget it is what three reports a run can carry through one step.
    answerBudgetChars: 10_000,
    answerFields: [
      "items.id",
      "items.status",
      "items.title",
      "items.summary",
      "items.url",
      "items.channelId",
      "items.threadTs",
      "items.author",
      "items.truncated",
      "items.metadata.extras.projectId",
      "items.metadata.extras.branchName",
      "items.metadata.extras.repository",
    ],
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
