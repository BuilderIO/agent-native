import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export type LabValues = Record<string, boolean>;

export function useLabState(key: string): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const { status } = useSession();
  const query = useActionQuery<LabValues>("get-labs" as never, undefined, {
    enabled: status === "authenticated",
  });
  return {
    enabled: query.data?.[key] === true,
    isLoading:
      query.isLoading || (status === "loading" && query.data === undefined),
    isError: query.isError,
    isSuccess: query.isSuccess,
  };
}

export function useLab(key: string): boolean {
  const state = useLabState(key);
  return state.isSuccess ? state.enabled : true;
}

export function useLabs(): LabValues {
  const { status } = useSession();
  const query = useActionQuery<LabValues>("get-labs" as never, undefined, {
    enabled: status === "authenticated",
  });
  return query.data ?? {};
}
