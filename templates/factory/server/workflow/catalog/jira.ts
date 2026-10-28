import type { OperationDefinitionInput } from "../operations.js";

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
];
