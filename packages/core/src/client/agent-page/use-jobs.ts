import { useQueryClient } from "@tanstack/react-query";

import { useActionMutation, useActionQuery } from "../use-action.js";

export type JobsScope = "user" | "org";
export type AutomationTriggerType = "event" | "schedule" | "manual";

export interface RecurringJob {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  schedule: string;
  timezone: string;
  scheduleDescription: string;
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
}

export interface Automation {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  triggerType: AutomationTriggerType;
  event: string | null;
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
  nextRun: string | null;
  createdBy: string | null;
  model: string | null;
  mcpTools: string[];
  originScopeId: string | null;
  deliveryPlatform: string | null;
  deliveryDestination: string | null;
  deliveryThreadRef: string | null;
  deliveryTenantId: string | null;
  canUpdate: boolean;
}

export type ManageJobInput = {
  operation: "update" | "delete";
  name: string;
  scope: "personal" | "organization";
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
  mcpTools?: string[];
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
      name: string;
      scope: "personal" | "organization";
    } & AutomationEditorFields)
  | {
      operation: "delete";
      name: string;
      scope: "personal" | "organization";
    };

export interface ManageAutomationResult {
  created?: true;
  updated?: true;
  deleted?: true;
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
  mcpTools?: string[];
}

export interface RunAutomationNowInput {
  name: string;
  scope: "personal" | "organization";
}

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
  status: "running" | "success" | "error" | "interrupted";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

function recurringParams(scope: JobsScope) {
  return { scope: scope === "org" ? "organization" : "personal" } as const;
}

function automationParams(scope: JobsScope) {
  return { scope: scope === "org" ? "organization" : "personal" } as const;
}

export function useRecurringJobs(scope: JobsScope) {
  return useActionQuery<RecurringJob[]>(
    "list-recurring-jobs",
    recurringParams(scope),
    { staleTime: 5_000 },
  );
}

export function useAutomations(scope: JobsScope) {
  return useActionQuery<Automation[]>(
    "list-automations",
    automationParams(scope),
    { staleTime: 5_000 },
  );
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

export function useManageRecurringJob(scope: JobsScope) {
  const queryClient = useQueryClient();
  const params = recurringParams(scope);
  const queryKey = ["action", "list-recurring-jobs", params] as const;

  return useActionMutation<
    { deleted?: boolean; name: string; enabled?: boolean },
    ManageJobInput
  >("manage-recurring-job", {
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RecurringJob[]>(queryKey);
      queryClient.setQueryData<RecurringJob[]>(queryKey, (current) => {
        if (!current) return current;
        if (variables.operation === "delete") {
          return current.filter((job) => job.name !== variables.name);
        }
        return current.map((job) =>
          job.name === variables.name
            ? { ...job, ...optimisticPatch(variables) }
            : job,
        );
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      const rollback = context as { previous?: RecurringJob[] } | undefined;
      if (rollback && "previous" in rollback) {
        queryClient.setQueryData(queryKey, rollback.previous);
      }
    },
  });
}

export function useManageAutomation(scope: JobsScope) {
  const queryClient = useQueryClient();
  const params = automationParams(scope);
  const queryKey = ["action", "list-automations", params] as const;

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
              (automation) => automation.name !== variables.name,
            );
          }
          if (variables.operation === "create") {
            return [...current, optimisticAutomation(variables)];
          }
          return current.map((automation) =>
            automation.name === variables.name
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
    },
  );
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient();
  return useActionMutation<RunAutomationNowResult, RunAutomationNowInput>(
    "run-automation-now",
    {
      onSuccess: (_result, variables) => {
        const scope =
          variables.scope === "organization" ? "organization" : "personal";
        queryClient.invalidateQueries({
          queryKey: [
            "action",
            "list-automation-runs",
            { scope, name: variables.name },
          ],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-automations", { scope }],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-recurring-jobs", { scope }],
        });
      },
    },
  );
}

function optimisticPatch(variables: ManageJobInput) {
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
  return {
    id: `optimistic:${variables.scope}:${name}`,
    name,
    path: `jobs/${name}.md`,
    scope: variables.scope,
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
      variables.triggerType === "manual" ? null : (variables.condition ?? null),
    body: variables.body,
    enabled: variables.enabled ?? true,
    lastRun: null,
    lastCheck: null,
    lastStatus: null,
    lastError: null,
    nextRun: null,
    createdBy: null,
    model: variables.model ?? null,
    mcpTools: variables.mcpTools ?? [],
    originScopeId: null,
    deliveryPlatform: null,
    deliveryDestination: null,
    deliveryThreadRef: null,
    deliveryTenantId: null,
    canUpdate: true,
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
    if (variables.triggerType === "manual") patch.condition = null;
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
  scope: JobsScope,
  name: string | null,
  active: boolean,
) {
  const params = {
    scope: scope === "org" ? "organization" : "personal",
    name: name || "",
  } as const;
  return useActionQuery<AutomationRun[]>("list-automation-runs", params, {
    staleTime: 5_000,
    enabled: active && Boolean(name),
  });
}
