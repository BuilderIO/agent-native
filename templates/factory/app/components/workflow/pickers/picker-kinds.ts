import type { OptionProvider } from "../../../../server/workflow-host/option-listers/types.js";

export type PickerResource =
  | "channels"
  | "repositories"
  | "organizations"
  | "projects";

/** What a field's list is read from; it is the `provider` and `resource` of `list-provider-options`. */
export interface PickerKind {
  provider: OptionProvider;
  resource: PickerResource;
  /** Listed and chosen first; the stored value already names it, as `organization/project` does. */
  parentResource?: PickerResource;
}

const SLACK_CHANNELS: PickerKind = { provider: "slack", resource: "channels" };
const GITHUB_REPOSITORIES: PickerKind = {
  provider: "github",
  resource: "repositories",
};
const SENTRY_PROJECTS: PickerKind = {
  provider: "sentry",
  resource: "projects",
  parentResource: "organizations",
};

/** What each inbox poller's single scope is. */
const INBOX_POLLER_SCOPES: Readonly<
  Record<"slack" | "github" | "sentry", PickerKind>
> = {
  slack: SLACK_CHANNELS,
  github: GITHUB_REPOSITORIES,
  sentry: SENTRY_PROJECTS,
};

/** The operation fields that hold a provider's resource, by operation id and field name. */
const OPERATION_FIELD_PICKERS: Readonly<
  Record<string, Readonly<Record<string, PickerKind>>>
> = {
  "slack.readThread": { channel: SLACK_CHANNELS },
  "slack.postMessage": { to: SLACK_CHANNELS },
  "slack.replyInThread": { channel: SLACK_CHANNELS },
  "github.listCommits": { repo: GITHUB_REPOSITORIES },
  "github.listSecurityAlerts": { repo: GITHUB_REPOSITORIES },
  "github.mergedPullRequests": { repo: GITHUB_REPOSITORIES },
  "github.readPullRequest": { repo: GITHUB_REPOSITORIES },
  "github.mergePullRequest": { repo: GITHUB_REPOSITORIES },
  "github.readFile": { repo: GITHUB_REPOSITORIES },
  "github.searchCode": { repo: GITHUB_REPOSITORIES },
  "factory.mergeGate": { repo: GITHUB_REPOSITORIES },
};

export function pickerForInboxPoller(
  poller: "slack" | "github" | "sentry",
): PickerKind {
  return INBOX_POLLER_SCOPES[poller];
}

export function pickerForOperationField(
  operationId: string,
  fieldName: string,
): PickerKind | undefined {
  return OPERATION_FIELD_PICKERS[operationId]?.[fieldName];
}

/** Every mapped operation field, for a check that none has drifted from the catalog. */
export function mappedOperationFields(): readonly {
  operationId: string;
  fieldName: string;
}[] {
  return Object.entries(OPERATION_FIELD_PICKERS).flatMap(
    ([operationId, fields]) =>
      Object.keys(fields).map((fieldName) => ({ operationId, fieldName })),
  );
}
