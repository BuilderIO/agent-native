import type { OperationDefinitionInput } from "../operations.js";

const issue = [
  { name: "issueId", type: "string", required: true, label: "Issue" },
  {
    name: "orgSlug",
    type: "string",
    label: "Organization (the connected one when empty)",
  },
] as const;

// A write decides which issue changes, and in which organization.
const issueTarget = [
  {
    name: "issueId",
    type: "string",
    required: true,
    target: true,
    label: "Issue",
    description: "The issue's numeric id, digits only.",
  },
  {
    name: "orgSlug",
    type: "string",
    target: true,
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
  {
    id: "sentry.resolveIssue",
    provider: "sentry",
    label: "Sentry: resolve an issue",
    description:
      "Sets an issue to resolved, or resolved in the next release. Sentry takes a repeat as it is, and its answer must confirm resolved. The write is sent once.",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      ...issueTarget,
      {
        name: "resolution",
        type: "enum",
        enum: ["resolved", "resolvedInNextRelease"],
        default: "resolved",
        label: "Resolve",
      },
    ],
    implementation: { type: "action", action: "resolve-sentry-issue" },
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "issueId", type: "string" },
      { name: "inNextRelease", type: "boolean" },
    ],
    receipt: { externalRef: "externalRef", url: "url" },
    credential: { provider: "sentry" },
  },
  {
    id: "sentry.assignIssue",
    provider: "sentry",
    label: "Sentry: assign an issue",
    description:
      "Assigns an issue to a person by email, to a team by slug (read first, an unknown slug is refused), or to nobody. Sentry's answer must confirm it. The write is sent once.",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      ...issueTarget,
      {
        name: "assigneeKind",
        type: "enum",
        enum: ["user", "team", "nobody"],
        required: true,
        target: true,
        label: "Assign to",
      },
      {
        name: "assignee",
        type: "string",
        target: true,
        label: "Email or team slug",
        description:
          "The person's email for user, the team slug for team; leave empty for nobody.",
      },
    ],
    implementation: { type: "action", action: "assign-sentry-issue" },
    outputs: [
      { name: "ok", type: "boolean" },
      { name: "issueId", type: "string" },
      {
        name: "assignedType",
        type: "string",
        nullable: true,
        description: "user, team or null when unassigned.",
      },
      { name: "assignedName", type: "string", nullable: true },
    ],
    receipt: { externalRef: "externalRef", url: "url" },
    credential: { provider: "sentry" },
  },
];
