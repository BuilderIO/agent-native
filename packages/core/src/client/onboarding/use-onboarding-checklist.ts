import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import type {
  OnboardingStepStatus,
  OnboardingSummary,
} from "../../onboarding/types.js";
import { agentNativePath } from "../api-path.js";
import {
  readClientAppState,
  writeClientAppState,
} from "../application-state.js";
import { useChangeVersions } from "../use-change-version.js";

const CHECKLIST_TIMEOUT_MS = 10_000;

type ChecklistSummary = Pick<OnboardingSummary, "steps" | "dismissed">;

export interface UseOnboardingChecklistResult {
  steps: OnboardingStepStatus[];
  completeCount: number;
  totalCount: number;
  dismissed: boolean;
  collapsed: boolean;
  /** `loading` only before the first answer; a refresh keeps the last one. */
  status: "loading" | "ready" | "error";
  error: Error | null;
  refresh: () => Promise<unknown>;
  dismiss: () => Promise<void>;
  reopen: () => Promise<void>;
  setCollapsed: (collapsed: boolean) => Promise<void>;
}

function summaryKey(checklist: string) {
  return ["onboarding-checklist", checklist] as const;
}

function collapsedKey(checklist: string) {
  return ["onboarding-checklist-collapsed", checklist] as const;
}

function collapsedStateKey(checklist: string): string {
  return `onboarding:collapsed:${checklist}`;
}

function checklistUrl(path: string, checklist: string): string {
  return agentNativePath(
    `/_agent-native/onboarding/${path}?checklist=${encodeURIComponent(checklist)}`,
  );
}

async function fetchChecklist(
  checklist: string,
  signal: AbortSignal,
): Promise<ChecklistSummary> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  const timer = setTimeout(abort, CHECKLIST_TIMEOUT_MS);
  try {
    const response = await fetch(checklistUrl("summary", checklist), {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`checklist: ${response.status}`);
    const body = (await response.json()) as ChecklistSummary;
    return { steps: body.steps, dismissed: !!body.dismissed };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function postChecklist(
  path: "dismiss" | "reopen",
  checklist: string,
): Promise<void> {
  const response = await fetch(checklistUrl(path, checklist), {
    method: "POST",
  });
  if (!response.ok) throw new Error(`checklist ${path}: ${response.status}`);
}

type SummarySnapshot = [readonly unknown[], ChecklistSummary | undefined][];

function patchSummary(
  queryClient: QueryClient,
  checklist: string,
  patch: Partial<ChecklistSummary>,
): SummarySnapshot {
  const snapshot = queryClient.getQueriesData<ChecklistSummary>({
    queryKey: summaryKey(checklist),
  });
  queryClient.setQueriesData<ChecklistSummary>(
    { queryKey: summaryKey(checklist) },
    (current) => (current ? { ...current, ...patch } : current),
  );
  return snapshot;
}

/**
 * Reads one named onboarding checklist (steps registered with
 * `registerOnboardingStep({ checklist })`). Rows are re-read whenever a local
 * action or an agent tool finishes, so a step checks itself off after the work
 * that completes it. Dismissal is stored by the onboarding plugin and the
 * collapsed state in application state, so both follow the user across devices.
 */
export function useOnboardingChecklist(
  checklist: string,
): UseOnboardingChecklistResult {
  const queryClient = useQueryClient();
  const changeVersion = useChangeVersions(["action"]);

  const summary = useQuery<ChecklistSummary>({
    queryKey: [...summaryKey(checklist), changeVersion],
    queryFn: ({ signal }) => fetchChecklist(checklist, signal),
    placeholderData: (previous) => previous,
  });

  const collapsedQuery = useQuery<boolean>({
    queryKey: collapsedKey(checklist),
    queryFn: async () => {
      const value = await readClientAppState<{ collapsed?: boolean }>(
        collapsedStateKey(checklist),
      );
      return value?.collapsed === true;
    },
    staleTime: Infinity,
  });

  const dismissMutation = useMutation({
    mutationFn: (dismissed: boolean) =>
      postChecklist(dismissed ? "dismiss" : "reopen", checklist),
    onMutate: (dismissed) => ({
      previous: patchSummary(queryClient, checklist, { dismissed }),
    }),
    onError: (_error, _dismissed, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: summaryKey(checklist) }),
  });

  const collapseMutation = useMutation({
    mutationFn: (collapsed: boolean) =>
      writeClientAppState(collapsedStateKey(checklist), { collapsed }),
    onMutate: (collapsed) => {
      const previous = queryClient.getQueryData<boolean>(
        collapsedKey(checklist),
      );
      queryClient.setQueryData(collapsedKey(checklist), collapsed);
      return { previous };
    },
    onError: (_error, _collapsed, context) => {
      queryClient.setQueryData(collapsedKey(checklist), context?.previous);
    },
  });

  const dismiss = useCallback(
    () => dismissMutation.mutateAsync(true),
    [dismissMutation],
  );
  const reopen = useCallback(
    () => dismissMutation.mutateAsync(false),
    [dismissMutation],
  );
  const setCollapsed = useCallback(
    (collapsed: boolean) =>
      collapseMutation.mutateAsync(collapsed).then(() => undefined),
    [collapseMutation],
  );

  const steps = summary.data?.steps ?? [];
  return {
    steps,
    completeCount: steps.filter((step) => step.complete).length,
    totalCount: steps.length,
    dismissed: summary.data?.dismissed ?? false,
    collapsed: collapsedQuery.data ?? false,
    status: summary.data ? "ready" : summary.isError ? "error" : "loading",
    error: summary.error,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: summaryKey(checklist) }),
    dismiss,
    reopen,
    setCollapsed,
  };
}
