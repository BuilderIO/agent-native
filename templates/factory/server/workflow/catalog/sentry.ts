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
    // An issue is 4 KB to 15 KB: its identity, status and counts come first,
    // then the activity, seen-by and stats lists that grow with the issue, so
    // the cut takes the tail.
    id: "sentry.issueStatus",
    provider: "sentry",
    label: "Sentry: read an issue's status",
    nodeKinds: ["lookup"],
    effect: "read",
    answerBudgetChars: 6_000,
    fields: [...issue],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/organizations/{orgSlug}/issues/{issueId}/",
    },
    credential: { provider: "sentry" },
  },
  {
    // Fifty events are 50 KB to 100 KB (each carries its tags, user and
    // metadata), newest first. Story 07 reads one issue per incident that
    // resolved, and with the model's postmortem each is about 5 KB more, so
    // 10,000 lets four incidents through a step with the newest few events.
    id: "sentry.issueEvents",
    provider: "sentry",
    label: "Sentry: recent events of an issue",
    nodeKinds: ["lookup"],
    effect: "read",
    answerBudgetChars: 10_000,
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
