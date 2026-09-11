import { useActionQuery } from "../use-action.js";

export type LabValues = Record<string, boolean>;

export function useLabState(key: string): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const query = useActionQuery<LabValues>("get-labs" as never);
  return {
    enabled: query.data?.[key] === true,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
  };
}

export function useLab(key: string): boolean {
  const state = useLabState(key);
  return state.isSuccess ? state.enabled : true;
}

export function useLabs(): LabValues {
  const query = useActionQuery<LabValues>("get-labs" as never);
  return query.data ?? {};
}
