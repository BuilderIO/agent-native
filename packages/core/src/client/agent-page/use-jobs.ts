import { useQueryClient } from "@tanstack/react-query";

import { useActionMutation, useActionQuery } from "../use-action.js";
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
  triggerType: "event" | "schedule";
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

export type ManageAutomationInput = ManageJobInput;

export interface RunAutomationNowInput {
  name?: string;
  path?: string;
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

// Re-exported so existing callers keep one import site for the jobs data layer.
export type { ScheduledTriggerState, ScheduledTriggerStatus };

/**
 * Deploy-scoped and fixed for the life of the process, so it is cached far
 * longer than the automation lists.
 */
export function useScheduledTriggerState(): ScheduledTriggerState {
  const query = useActionQuery<ScheduledTriggerStatus>(
    "get-scheduled-trigger-status",
    {},
    { staleTime: 5 * 60_000 },
  );
  // Data first: a cached answer with a failing background refetch is still an
  // answer, and downgrading it to `unknown` would flicker the warning off.
  if (query.data) return { kind: "resolved", status: query.data };
  if (query.error) return { kind: "unknown", error: query.error };
  return { kind: "loading" };
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

  return useActionMutation<
    { deleted?: boolean; name: string; enabled?: boolean },
    ManageAutomationInput
  >("manage-automation", {
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
        return current.map((automation) =>
          automation.name === variables.name
            ? { ...automation, ...optimisticPatch(variables) }
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
  });
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient();
  return useActionMutation<RunAutomationNowResult, RunAutomationNowInput>(
    "run-automation-now",
    {
      onSuccess: (_result, variables) => {
        const scope =
          variables.scope === "organization" ? "organization" : "personal";
        const name =
          variables.name ??
          variables.path?.replace(/^jobs\//, "").replace(/\.md$/, "");
        queryClient.invalidateQueries({
          queryKey: ["action", "list-automation-runs", { scope, name }],
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
