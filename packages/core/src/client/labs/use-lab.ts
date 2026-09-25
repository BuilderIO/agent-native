import type { LabDefinition } from "../../labs/registry.js";
import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export type LabValues = Record<string, boolean>;

/**
 * A lab by key, or by its definition. Pass the definition so the lab reads as
 * its `defaultEnabled` until the server answers (and when it can't); a bare
 * key can't know that default.
 */
export type LabReference =
  | string
  | Pick<LabDefinition, "key" | "defaultEnabled">;

function labKey(lab: LabReference): string {
  return typeof lab === "string" ? lab : lab.key;
}

export function useLabState(lab: LabReference): {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const key = labKey(lab);
  // get-labs requires a real session. Gating on it avoids firing a request
  // that 401s for every signed-out visitor; isSuccess stays false so callers
  // keep today's "not yet known" default below.
  const { status } = useSession();
  const query = useActionQuery<LabValues>("get-labs" as never, undefined, {
    enabled: status === "authenticated",
  });
  return {
    enabled: query.data
      ? query.data[key] === true
      : typeof lab !== "string" && lab.defaultEnabled === true,
    // A disabled query reports isLoading=false with no data. While the
    // session gate itself is still resolving (e.g. a cold reload), that would
    // read as "known off" for a signed-in user whose lab is actually on.
    isLoading:
      query.isLoading || (status === "loading" && query.data === undefined),
    isError: query.isError,
    isSuccess: query.isSuccess,
  };
}

/**
 * Whether a lab is on. Until the server answers, a definition reads as its
 * `defaultEnabled`; a bare key reads as on, so UI behind a lab that may be
 * enabled doesn't disappear while loading.
 */
export function useLab(lab: LabReference): boolean {
  const state = useLabState(lab);
  if (state.isSuccess || typeof lab !== "string") return state.enabled;
  return true;
}

export function useLabs(): LabValues {
  const { status } = useSession();
  const query = useActionQuery<LabValues>("get-labs" as never, undefined, {
    enabled: status === "authenticated",
  });
  return query.data ?? {};
}
