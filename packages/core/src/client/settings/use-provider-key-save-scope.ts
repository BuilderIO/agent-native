import { canManageOrg } from "../../org/permissions.js";
import type { AgentEngineKeyScope } from "../agent-engine-key.js";
import { useOrg } from "../org/hooks.js";

export interface ProviderKeySaveScope {
  /**
   * The organization's for owners and admins, personal for members and for
   * anyone without an organization. `null` until the role is known, so Save
   * stays off: an early or failed role read must not store an admin's
   * organization key as personal.
   */
  scope: AgentEngineKeyScope | null;
  /** The role read failed. Show it with `retry` instead of guessing a scope. */
  roleUnavailable: boolean;
  retry: () => void;
}

export function useProviderKeySaveScope(
  chosen?: AgentEngineKeyScope,
): ProviderKeySaveScope {
  const query = useOrg({ enabled: !chosen });
  const retry = () => void query.refetch();
  if (chosen) return { scope: chosen, roleUnavailable: false, retry };
  if (!query.data) {
    return { scope: null, roleUnavailable: query.isError, retry };
  }
  return {
    scope: canManageOrg(query.data.role) ? "org" : "user",
    roleUnavailable: false,
    retry,
  };
}
