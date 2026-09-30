import type { LabDefinition } from "../../labs/registry.js";
import type { UserLabState } from "../../labs/store.js";
import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";

export type LabValues = Record<string, boolean>;
export type LabStates = Record<string, UserLabState>;

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
  return {
    enabled: state
      ? state.enabled
      : typeof lab !== "string" && lab.defaultEnabled === true,
    source: state?.source ?? null,
    mixed: state?.mixed ?? false,
    legacyValues: state?.legacyValues,
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
