import { useActionQuery } from "../use-action.js";

export type ExperimentValues = Record<string, boolean>;

export function useExperimentState(key: string): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const query = useActionQuery<ExperimentValues>("get-experiments" as never);
  return {
    enabled: query.data?.[key] === true,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
  };
}

export function useExperiment(key: string): boolean {
  const state = useExperimentState(key);
  return state.isSuccess ? state.enabled : true;
}

export function useExperiments(): ExperimentValues {
  const query = useActionQuery<ExperimentValues>("get-experiments" as never);
  return query.data ?? {};
}
