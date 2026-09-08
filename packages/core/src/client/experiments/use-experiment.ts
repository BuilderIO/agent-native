import { useActionQuery } from "../use-action.js";

export type ExperimentValues = Record<string, boolean>;

export function useExperimentState(key: string): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useActionQuery<ExperimentValues>("get-experiments" as never);
  return {
    enabled: query.data?.[key] === true,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useExperiment(key: string): boolean {
  return useExperimentState(key).enabled;
}

export function useExperiments(): ExperimentValues {
  const query = useActionQuery<ExperimentValues>("get-experiments" as never);
  return query.data ?? {};
}
