import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export type LabValues = Record<string, boolean>;

export function useLabState(key: string): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  // get-labs requires a real session. Gating on it avoids firing a request
  // that 401s for every signed-out visitor; isSuccess stays false so callers
  // keep today's "not yet known" default below.
  const { status } = useSession();
  const query = useActionQuery<LabValues>("get-labs" as never, undefined, {
    enabled: status === "authenticated",
  });
  return {
    enabled: query.data?.[key] === true,
    // A disabled query reports isLoading=false with no data. While the
    // session gate itself is still resolving (e.g. a cold reload), that would
    // read as "known off" for a signed-in user whose lab is actually on.
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
