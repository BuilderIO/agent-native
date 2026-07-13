import { useQueryClient } from "@tanstack/react-query";

import { useActionMutation, useActionQuery } from "../use-action.js";

export type JobsScope = "user" | "org";

export interface RecurringJob {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  schedule: string;
  scheduleDescription: string;
  instructions: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRun: string | null;
  createdBy: string | null;
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
  scheduleDescription: string | null;
  condition: string | null;
  body: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRun: string | null;
  createdBy: string | null;
  canUpdate: boolean;
}

export type ManageJobInput = {
  operation: "update" | "delete";
  name: string;
  scope: "personal" | "organization";
  enabled?: boolean;
};

export type ManageAutomationInput = {
  operation: "update" | "delete";
  name: string;
  scope: "personal" | "organization";
  enabled?: boolean;
};

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
          job.name === variables.name && variables.enabled !== undefined
            ? { ...job, enabled: variables.enabled }
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
          automation.name === variables.name && variables.enabled !== undefined
            ? { ...automation, enabled: variables.enabled }
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
