import type { AgentEngineKeyScope } from "@agent-native/core/client/agent-engine-key";
import { useOrg } from "@agent-native/core/client/org";
import { canManageOrg } from "@agent-native/core/org/permissions";
import { useState } from "react";

export interface CredentialSaveScope {
  /**
   * Where Save writes. Owners and admins save for the organization unless
   * they pick personal; members, and anyone without an organization, save
   * personally. `null` until the role is known, so Save stays off: an early
   * or failed role read must not store an admin's organization key as
   * personal.
   */
  scope: AgentEngineKeyScope | null;
  /** Owners and admins pick where it saves; show `WhoField` for them. */
  canChoose: boolean;
  setScope: (scope: AgentEngineKeyScope) => void;
  orgName: string;
  /** The role read failed. Show it with `retry` instead of guessing a scope. */
  roleUnavailable: boolean;
  retry: () => void;
}

export function useCredentialSaveScope(
  chosen?: AgentEngineKeyScope,
): CredentialSaveScope {
  const query = useOrg({ enabled: !chosen });
  const [picked, setPicked] = useState<AgentEngineKeyScope | null>(null);
  const retry = () => void query.refetch();
  const base = { setScope: setPicked, retry, roleUnavailable: false };
  if (chosen) return { ...base, scope: chosen, canChoose: false, orgName: "" };
  if (!query.data) {
    return {
      ...base,
      scope: null,
      canChoose: false,
      orgName: "",
      roleUnavailable: query.isError,
    };
  }
  const canChoose = canManageOrg(query.data.role);
  return {
    ...base,
    scope: canChoose ? (picked ?? "org") : "user",
    canChoose,
    orgName: query.data.orgName ?? "",
  };
}
