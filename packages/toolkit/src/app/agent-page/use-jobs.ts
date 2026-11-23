import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  useMutationState,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  ScheduledTriggerState,
  ScheduledTriggerStatus,
} from "./scheduled-trigger-state.js";

export type JobsScope = "user" | "org";

export interface RecurringJob {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  schedule: string | null;
  timezone: string | null;
  scheduleDescription: string | null;
  instructions: string;
  enabled: boolean;
  lastRun: string | null;
  lastCheck: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRun: string | null;
  createdBy: string | null;
  mcpTools: string[];
  canUpdate: boolean;
  capabilities?: AutomationCapabilities;
}

export type AutomationTriggerType = "event" | "schedule" | "manual" | "webhook";
export type AutomationClassification = "automation" | "recurring-job";
export type AutomationEffectiveRole = "owner" | "collaborate" | "view";
export type AutomationSharingVisibility = "private" | "organization" | "shared";
export type AutomationSharingRole = "view" | "collaborate";
export type AutomationSharingMode = "personal" | "organization" | "specific";

export interface AutomationCapabilities {
  canEdit: boolean;
  canOperate: boolean;
  canDelete: boolean;
  canManageSharing: boolean;
}

export interface AutomationSharingGrant {
  email: string;
  role: AutomationSharingRole;
  name: string | null;
  avatar: string | null;
}

export interface AutomationSharingSummary {
  source: "explicit" | "legacy";
  visibility: AutomationSharingVisibility;
  organizationId: string | null;
  grantCount: number;
  grants?: AutomationSharingGrant[];
}

export interface AutomationCreator {
  email: string | null;
  label: string | null;
}

// Kept only because `manage-recurring-job` still accepts name/scope as a
// compatibility input; every new caller should address by `resourceId`.
export type LegacyJobLocator =
  | { resourceId: string }
  | { name: string; scope: "personal" | "organization" };

export interface Automation {
  id: string;
  resourceId: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  classification: AutomationClassification;
  triggerType: AutomationTriggerType;
  event: string | null;
  webhookPath: string | null;
  schedule: string | null;
  timezone: string | null;
  scheduleDescription: string | null;
  condition: string | null;
  body: string;
  enabled: boolean;
  lastRun: string | null;
  lastCheck: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  nextRun: string | null;
  createdBy: string | null;
  model: string | null;
  reasoningEffort: string | null;
  executionHostId: string | null;
  executionEngine: string | null;
  executionCwd: string | null;
  mcpTools: string[];
  originScopeId: string | null;
  deliveryPlatform: string | null;
  deliveryDestination: string | null;
  deliveryThreadRef: string | null;
  deliveryTenantId: string | null;
  canUpdate: boolean;
  effectiveRole: AutomationEffectiveRole;
  capabilities: AutomationCapabilities;
  sharing: AutomationSharingSummary;
  creator: AutomationCreator;
}

export type AutomationSharingGrantSubmission = {
  email: string;
  role: AutomationSharingRole;
};

export type AutomationSharingSubmission =
  | { kind: "personal" }
  | { kind: "organization"; organizationId: string }
  | {
      kind: "specific";
      organizationId?: string | null;
      grants: AutomationSharingGrantSubmission[];
    };

export type ManageJobInput = LegacyJobLocator & {
  operation: "update" | "delete";
  enabled?: boolean;
  schedule?: string;
  timezone?: string;
};

export interface AutomationEvent {
  name: string;
  description: string;
  payloadSchema: Record<string, unknown> | null;
  example: Record<string, unknown> | null;
}

interface AutomationEditorFields {
  enabled?: boolean;
  triggerType?: AutomationTriggerType;
  event?: string;
  schedule?: string;
  timezone?: string;
  condition?: string | null;
  body?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  executionHostId?: string | null;
  executionEngine?: string | null;
  executionCwd?: string | null;
  mcpTools?: string[];
  sharing?: AutomationSharingSubmission;
  acknowledgeExternalCollaborators?: boolean;
}

export type ManageAutomationInput =
  | ({
      operation: "create";
      name: string;
      scope: "personal" | "organization";
      triggerType: AutomationTriggerType;
      body: string;
    } & Omit<AutomationEditorFields, "triggerType" | "body">)
  | ({
      operation: "update";
      resourceId?: string;
      name?: string;
      scope?: "personal" | "organization";
    } & AutomationEditorFields)
  | {
      operation: "delete";
      resourceId?: string;
      name?: string;
      scope?: "personal" | "organization";
    };

export interface ManageAutomationResult {
  created?: true;
  updated?: true;
  deleted?: true;
  resourceId?: string | null;
  name: string;
  scope?: "personal" | "organization";
  triggerType?: AutomationTriggerType;
  event?: string | null;
  schedule?: string | null;
  timezone?: string | null;
  condition?: string | null;
  body?: string;
  enabled?: boolean;
  nextRun?: string | null;
  createdBy?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  executionHostId?: string | null;
  executionEngine?: string | null;
  executionCwd?: string | null;
  webhookPath?: string | null;
  changed?: boolean;
  previouslyEnabled?: boolean;
  requestedEnabled?: boolean | null;
  mcpTools?: string[];
}

export type RunAutomationNowInput =
  | { resourceId: string; name?: never; path?: never; scope?: never }
  | {
      path: string;
      resourceId?: never;
      name?: never;
      scope?: "personal" | "organization";
    }
  | {
      name: string;
      scope: "personal" | "organization";
      resourceId?: never;
      path?: never;
    };

export interface RunAutomationNowResult {
  queued: true;
  runId: string;
  automationRunId: string;
}

export interface AutomationRun {
  id: string;
  automation: string;
  scope: string | null;
  runId: string | null;
  threadId: string | null;
  status: "running" | "success" | "error" | "interrupted" | "skipped";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  errorCode: string | null;
}

export interface AutomationAccountSearchResult {
  email: string;
  name: string | null;
  avatar: string | null;
  outsideOrganization: boolean;
}

function recurringParams(scope: JobsScope) {
  return { scope: scope === "org" ? "organization" : "personal" } as const;
}

function automationParams(scope: JobsScope) {
  return { scope: scope === "org" ? "organization" : "personal" } as const;
}

function automationQueryKey(scope?: JobsScope) {
  return [
    "action",
    "list-automations",
    scope ? automationParams(scope) : {},
  ] as const;
}

function matchesLocator(
  automation: {
    id: string;
    resourceId?: string;
    name: string;
    scope: string;
  },
  locator: { resourceId?: string; name?: string; scope?: string },
): boolean {
  if (locator.resourceId) {
    return (automation.resourceId ?? automation.id) === locator.resourceId;
  }
  return automation.name === locator.name && automation.scope === locator.scope;
}

type RecurringField = "enabled" | "schedule" | "timezone";

type RecurringMutation = {
  scope: JobsScope;
  resourceId: string | undefined;
  locator: ManageJobInput;
  conflictingFields: Set<RecurringField>;
  schedulingAmbiguous: boolean;
};

const recurringMutations = new WeakMap<QueryClient, Set<RecurringMutation>>();

function beginRecurringMutation(
  client: QueryClient,
  scope: JobsScope,
  variables: ManageJobInput,
): RecurringMutation {
  const resourceId =
    "resourceId" in variables
      ? variables.resourceId
      : client
          .getQueryData<RecurringJob[]>([
            "action",
            "list-recurring-jobs",
            recurringParams(scope),
          ])
          ?.find((job) => matchesLocator(job, variables))?.id;
  const mutation: RecurringMutation = {
    scope,
    resourceId,
    locator: variables,
    conflictingFields: new Set(),
    schedulingAmbiguous: false,
  };
  let active = recurringMutations.get(client);
  if (!active) {
    active = new Set();
    recurringMutations.set(client, active);
  }
  for (const other of active) {
    const sameResource =
      resourceId && other.resourceId
        ? resourceId === other.resourceId
        : "name" in variables && "name" in other.locator
          ? variables.name === other.locator.name &&
            variables.scope === other.locator.scope
          : scope === other.scope;
    if (
      !sameResource ||
      variables.operation !== "update" ||
      other.locator.operation !== "update"
    )
      continue;
    mutation.schedulingAmbiguous = true;
    other.schedulingAmbiguous = true;
    for (const field of ["enabled", "schedule", "timezone"] as const) {
      if (
        variables[field] !== undefined &&
        other.locator[field] !== undefined &&
        variables[field] !== other.locator[field]
      ) {
        mutation.conflictingFields.add(field);
        other.conflictingFields.add(field);
      }
    }
  }
  active.add(mutation);
  return mutation;
}

export type { ScheduledTriggerState, ScheduledTriggerStatus };

export function useScheduledTriggerState(): ScheduledTriggerState {
  const query = useActionQuery<ScheduledTriggerStatus>(
    "get-scheduled-trigger-status",
    {},
    { staleTime: 5 * 60_000 },
  );
  if (query.data) return { kind: "resolved", status: query.data };
  if (query.error) return { kind: "unknown", error: query.error };
  return { kind: "loading" };
}

function usePendingRecurringJobs(scope?: JobsScope) {
  return useMutationState<ManageJobInput>({
    filters: {
      mutationKey: scope ? ["recurring-job", scope] : ["recurring-job"],
      status: "pending",
    },
    select: (mutation) => mutation.state.variables as ManageJobInput,
  });
}

function applyPendingJobs<T extends RecurringJob | Automation>(
  data: T[] | undefined,
  pending: ManageJobInput[],
): T[] | undefined {
  if (!data) return data;
  return pending.reduce((items, variables) => {
    if (variables.operation === "delete") {
      return items.filter((item) => !matchesLocator(item, variables));
    }
    return items.map((item) =>
      matchesLocator(item, variables)
        ? { ...item, ...optimisticJobPatch(variables) }
        : item,
    );
  }, data);
}

export function useRecurringJobs(scope: JobsScope) {
  const query = useActionQuery<RecurringJob[]>(
    "list-recurring-jobs",
    recurringParams(scope),
    { staleTime: 5_000 },
  );
  const pending = usePendingRecurringJobs(scope);
  const data = useMemo(
    () => applyPendingJobs(query.data, pending),
    [query.data, pending],
  );
  return { ...query, data };
}

export function useAutomations(scope?: JobsScope) {
  const query = useActionQuery<Automation[]>(
    "list-automations",
    scope ? automationParams(scope) : {},
    { staleTime: 5_000 },
  );
  const pending = usePendingRecurringJobs(scope);
  const data = useMemo(
    () => applyPendingJobs(query.data, pending),
    [query.data, pending],
  );
  return { ...query, data };
}

export function useAutomationEvents() {
  return useActionQuery<AutomationEvent[]>(
    "list-automation-events",
    {},
    {
      staleTime: 30_000,
    },
  );
}

export function useAutomationAccountSearch(query: string, enabled: boolean) {
  return useActionQuery<AutomationAccountSearchResult[]>(
    "search-automation-accounts",
    { query, limit: 10 },
    { enabled: enabled && query.trim().length >= 2, staleTime: 10_000 },
  );
}

/** Mutates legacy `jobs/*.md` recurring jobs; schedule/enabled/delete only. */
export function useManageRecurringJob(scope: JobsScope) {
  const queryClient = useQueryClient();
  const queryKey = [
    "action",
    "list-recurring-jobs",
    recurringParams(scope),
  ] as const;
  const automationsKey = automationQueryKey(scope);

  return useActionMutation<
    {
      deleted?: boolean;
      resourceId?: string;
      name: string;
      enabled?: boolean;
      nextRun?: string | null;
    },
    ManageJobInput
  >("manage-recurring-job", {
    mutationKey: ["recurring-job", scope],
    onMutate: (variables) =>
      beginRecurringMutation(queryClient, scope, variables),
    beforeInvalidate: (result, variables, context) => {
      const mutation = context as RecurringMutation | undefined;
      const locator = result.resourceId
        ? { resourceId: result.resourceId }
        : variables;
      const commit = <T extends RecurringJob | Automation>(
        current: T[] | undefined,
      ): T[] | undefined => {
        if (!current) return current;
        if (variables.operation === "delete")
          return current.filter((item) => !matchesLocator(item, locator));
        return current.map((item) => {
          if (!matchesLocator(item, locator)) return item;
          const enabled =
            variables.enabled !== undefined &&
            !mutation?.conflictingFields.has("enabled")
              ? (result.enabled ?? variables.enabled)
              : item.enabled;
          const schedule =
            variables.schedule !== undefined &&
            !mutation?.conflictingFields.has("schedule")
              ? variables.schedule.trim()
              : undefined;
          const timezone =
            variables.timezone !== undefined &&
            !mutation?.conflictingFields.has("timezone")
              ? variables.timezone.trim()
              : undefined;
          return {
            ...item,
            ...(variables.enabled !== undefined &&
            !mutation?.conflictingFields.has("enabled")
              ? { enabled }
              : {}),
            ...(schedule !== undefined
              ? { schedule, scheduleDescription: null }
              : {}),
            ...(timezone !== undefined
              ? { timezone, scheduleDescription: null }
              : {}),
            ...(!enabled ||
            mutation?.schedulingAmbiguous ||
            (result.enabled !== undefined && result.enabled !== enabled)
              ? { nextRun: null }
              : result.enabled === enabled && result.nextRun !== undefined
                ? { nextRun: result.nextRun }
                : {}),
            ...(variables.enabled === true &&
            !mutation?.conflictingFields.has("enabled") &&
            enabled &&
            item.lastStatus === "paused"
              ? { lastStatus: null, lastError: null }
              : {}),
          };
        });
      };
      queryClient.setQueriesData<RecurringJob[]>(
        { queryKey: ["action", "list-recurring-jobs"] },
        commit,
      );
      queryClient.setQueriesData<Automation[]>(
        { queryKey: ["action", "list-automations"] },
        commit,
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey, exact: true });
      void queryClient.invalidateQueries({
        queryKey: automationsKey,
        exact: true,
      });
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context) {
        recurringMutations
          .get(queryClient)
          ?.delete(context as RecurringMutation);
      }
    },
  });
}

export function useManageAutomation(scope?: JobsScope) {
  const queryClient = useQueryClient();
  const queryKey = automationQueryKey(scope);

  return useActionMutation<ManageAutomationResult, ManageAutomationInput>(
    "manage-automation",
    {
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<Automation[]>(queryKey);
        queryClient.setQueryData<Automation[]>(queryKey, (current) => {
          if (!current) return current;
          if (variables.operation === "delete") {
            return current.filter(
              (automation) => !matchesLocator(automation, variables),
            );
          }
          if (variables.operation === "create") {
            return [...current, optimisticAutomation(variables)];
          }
          return current.map((automation) =>
            matchesLocator(automation, variables)
              ? { ...automation, ...optimisticAutomationPatch(variables) }
              : automation,
          );
        });
        return { previous };
      },
      onError: (_error, _variables, context) => {
        const rollback = context as { previous?: Automation[] } | undefined;
        if (rollback && "previous" in rollback) {
          queryClient.setQueryData(queryKey, rollback.previous);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-automations"],
        });
      },
    },
  );
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient();
  return useActionMutation<RunAutomationNowResult, RunAutomationNowInput>(
    "run-automation-now",
    {
      errorNotification: "caller",
      onSuccess: (_result, variables) => {
        if ("resourceId" in variables) {
          void queryClient.invalidateQueries({
            queryKey: [
              "action",
              "list-automation-runs",
              { resourceId: variables.resourceId },
            ],
          });
        } else {
          const scope =
            variables.scope === "organization" ? "organization" : "personal";
          const name =
            "name" in variables
              ? variables.name
              : variables.path.replace(/^jobs\//, "").replace(/\.md$/, "");
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-automation-runs", { scope, name }],
          });
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-automations"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-recurring-jobs"],
        });
      },
    },
  );
}

function optimisticJobPatch(variables: ManageJobInput) {
  const patch: {
    enabled?: boolean;
    schedule?: string;
    timezone?: string;
  } = {};
  if (variables.enabled !== undefined) patch.enabled = variables.enabled;
  if (variables.schedule !== undefined) patch.schedule = variables.schedule;
  if (variables.timezone !== undefined) patch.timezone = variables.timezone;
  return patch;
}

function optimisticAutomation(
  variables: Extract<ManageAutomationInput, { operation: "create" }>,
): Automation {
  const name = variables.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  const visibility: AutomationSharingVisibility =
    variables.sharing?.kind === "organization"
      ? "organization"
      : variables.sharing?.kind === "specific"
        ? "shared"
        : "private";
  return {
    id: `optimistic:${variables.scope}:${name}`,
    resourceId: `optimistic:${variables.scope}:${name}`,
    name,
    path: `jobs/${name}.md`,
    scope: variables.scope,
    classification: "automation",
    webhookPath: null,
    triggerType: variables.triggerType,
    event: variables.triggerType === "event" ? (variables.event ?? null) : null,
    schedule:
      variables.triggerType === "schedule"
        ? (variables.schedule ?? null)
        : null,
    timezone:
      variables.triggerType === "schedule"
        ? (variables.timezone ?? null)
        : null,
    scheduleDescription: null,
    condition:
      variables.triggerType === "event" ? (variables.condition ?? null) : null,
    body: variables.body,
    enabled: variables.enabled ?? true,
    lastRun: null,
    lastCheck: null,
    lastStatus: null,
    lastError: null,
    lastErrorCode: null,
    nextRun: null,
    createdBy: null,
    model: variables.model ?? null,
    reasoningEffort: variables.reasoningEffort ?? null,
    executionHostId: variables.executionHostId ?? null,
    executionEngine: variables.executionEngine ?? null,
    executionCwd: variables.executionCwd ?? null,
    mcpTools: variables.mcpTools ?? [],
    originScopeId: null,
    deliveryPlatform: null,
    deliveryDestination: null,
    deliveryThreadRef: null,
    deliveryTenantId: null,
    canUpdate: true,
    effectiveRole: "owner",
    capabilities: {
      canEdit: true,
      canOperate: true,
      canDelete: true,
      canManageSharing: true,
    },
    sharing: {
      source: "explicit",
      visibility,
      organizationId:
        variables.sharing && variables.sharing.kind !== "personal"
          ? (variables.sharing.organizationId ?? null)
          : null,
      grantCount:
        variables.sharing?.kind === "specific"
          ? variables.sharing.grants.length
          : 0,
    },
    creator: { email: null, label: null },
  };
}

function optimisticAutomationPatch(
  variables: Extract<ManageAutomationInput, { operation: "update" }>,
): Partial<Automation> {
  const patch: Partial<Automation> = {};
  if (variables.enabled !== undefined) patch.enabled = variables.enabled;
  if (variables.body !== undefined) patch.body = variables.body;
  if (variables.model !== undefined) patch.model = variables.model;
  if (variables.mcpTools !== undefined) patch.mcpTools = variables.mcpTools;
  if (variables.condition !== undefined) patch.condition = variables.condition;

  if (variables.triggerType !== undefined) {
    patch.triggerType = variables.triggerType;
    patch.event =
      variables.triggerType === "event" ? (variables.event ?? null) : null;
    patch.schedule =
      variables.triggerType === "schedule"
        ? (variables.schedule ?? null)
        : null;
    patch.timezone =
      variables.triggerType === "schedule"
        ? (variables.timezone ?? null)
        : null;
    patch.scheduleDescription = null;
    patch.nextRun = null;
    if (variables.triggerType !== "event") patch.condition = null;
  } else {
    if (variables.event !== undefined) patch.event = variables.event;
    if (variables.schedule !== undefined) {
      patch.schedule = variables.schedule;
      patch.scheduleDescription = null;
      patch.nextRun = null;
    }
    if (variables.timezone !== undefined) {
      patch.timezone = variables.timezone;
      patch.scheduleDescription = null;
      patch.nextRun = null;
    }
  }
  return patch;
}

export function useAutomationRuns(
  target: { resourceId: string } | { name: string; scope: JobsScope } | null,
  active: boolean,
) {
  const params = target
    ? "resourceId" in target
      ? { resourceId: target.resourceId }
      : {
          name: target.name,
          scope: target.scope === "org" ? "organization" : "personal",
        }
    : undefined;
  return useActionQuery<AutomationRun[]>("list-automation-runs", params, {
    staleTime: 5_000,
    enabled: active && Boolean(target),
  });
}
