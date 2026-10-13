import type { LabDefinition } from "../../labs/registry.js";
import type { UserLabState, UserLabStateResult } from "../../labs/store.js";
import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export type LabValues = Record<string, boolean>;
export type LabStates = Record<string, UserLabStateResult>;

export function isLabStateEnabled(labs: LabStates, key: string): boolean {
  const state = labs[key];
  return state !== undefined && "enabled" in state && state.enabled;
}

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
  source: UserLabState["source"] | null;
  mixed: boolean;
  legacyValues?: Record<string, boolean>;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  isStateError: boolean;
  /** Read the Lab state again, such as after it failed to load. */
  refetch: () => void;
} {
  const key = labKey(lab);
  const { status } = useSession();
  const query = useActionQuery<LabStates>(
    "get-lab-states" as never,
    undefined,
    {
      enabled: status === "authenticated",
    },
  );
  const state = query.data?.[key];
  const stateFailed = state !== undefined && "error" in state;
  return {
    enabled:
      state && !stateFailed
        ? state.enabled
        : stateFailed
          ? false
          : typeof lab !== "string" && lab.defaultEnabled === true,
    source: state && !stateFailed ? state.source : null,
    mixed: state && !stateFailed ? state.mixed : false,
    legacyValues: state && !stateFailed ? state.legacyValues : undefined,
    isLoading:
      query.isLoading || (status === "loading" && query.data === undefined),
    isError: query.isError || stateFailed,
    isSuccess: query.isSuccess && !stateFailed,
    isStateError: stateFailed,
    refetch: () => void query.refetch(),
  };
}

/**
 * Whether a lab is on. Until the server answers, a definition reads as its
 * `defaultEnabled`; a bare key reads as on, so UI behind a lab that may be
 * enabled doesn't disappear while loading.
 */
export function useLab(lab: LabReference): boolean {
  const state = useLabState(lab);
  if (state.isStateError) return false;
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

export function useLabStates(): LabStates {
  const { status } = useSession();
  const query = useActionQuery<LabStates>(
    "get-lab-states" as never,
    undefined,
    {
      enabled: status === "authenticated",
    },
  );
  return query.data ?? {};
}
