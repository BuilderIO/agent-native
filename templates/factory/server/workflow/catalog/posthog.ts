import type { OperationDefinitionInput } from "../operations.js";

export const posthogOperations: OperationDefinitionInput[] = [
  {
    // `{customer}` and `{windowDays}` are HogQL placeholders, bound through
    // `values`; they are named differently from the fields so they are never
    // pasted into the SQL text. The count is `results[0][0]`.
    id: "posthog.usage",
    provider: "posthog",
    label: "PostHog: events from a person over recent days",
    nodeKinds: ["lookup"],
    effect: "read",
    readsViaPost: true,
    fields: [
      {
        name: "customerId",
        type: "string",
        required: true,
        label: "Person ID or email",
      },
      { name: "days", type: "number", default: 3, label: "Days" },
      {
        name: "projectId",
        type: "string",
        label: "Project (the connected project when empty)",
      },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/api/projects/{projectId}/query/",
      bodyTemplate: {
        query: {
          kind: "HogQLQuery",
          query:
            "SELECT count() AS keyEvents FROM events WHERE timestamp >= now() - toIntervalDay({windowDays}) AND (distinct_id = {customer} OR person.properties.email = {customer}) AND event NOT IN ('$feature_flag_called', '$identify', '$set', '$groupidentify')",
          values: { customer: "{customerId}", windowDays: "{days}" },
        },
        name: "factory-workflow-usage",
      },
    },
    credential: { provider: "posthog" },
  },
];
