import type { OperationDefinitionInput } from "../operations.js";

const issue = [
  { name: "issueId", type: "string", required: true, label: "Issue" },
  {
    name: "orgSlug",
    type: "string",
    label: "Organization (the connected one when empty)",
  },
] as const;

export const sentryOperations: OperationDefinitionInput[] = [
  {
    id: "sentry.issueStatus",
    provider: "sentry",
    label: "Sentry: read an issue's status",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [...issue],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/organizations/{orgSlug}/issues/{issueId}/",
    },
    credential: { provider: "sentry" },
  },
  {
    id: "sentry.issueEvents",
    provider: "sentry",
    label: "Sentry: recent events of an issue",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [...issue],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/organizations/{orgSlug}/issues/{issueId}/events/",
      query: { per_page: "50" },
    },
    credential: { provider: "sentry" },
  },
];
