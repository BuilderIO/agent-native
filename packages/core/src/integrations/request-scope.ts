import { resolveOrgScopeForEmail } from "../org/context.js";

export type IntegrationRequestScope = {
  orgId: string | null;
  orgScope?: "personal";
  defaultAgentEngineScope?: "deployment";
};

export async function resolveIntegrationRequestScope(input: {
  ownerEmail: string;
  orgId?: string | null;
  orgScope?: "personal";
  principalType?: "user" | "service";
}): Promise<IntegrationRequestScope> {
  const explicitOrgId = input.orgId?.trim();
  if (explicitOrgId) return { orgId: explicitOrgId };

  if (input.orgScope === "personal") {
    return { orgId: null, orgScope: "personal" };
  }

  if (input.principalType === "service") {
    return { orgId: null, defaultAgentEngineScope: "deployment" };
  }

  const scope = await resolveOrgScopeForEmail(input.ownerEmail);
  if (scope.status === "organization") return { orgId: scope.orgId };
  if (scope.status === "personal") return { orgId: null, orgScope: "personal" };

  throw new Error(
    "The integration owner's organization scope could not be resolved.",
  );
}

export function integrationRequestContext(scope: IntegrationRequestScope): {
  orgId?: string;
  orgScope?: "personal";
  defaultAgentEngineScope?: "deployment";
} {
  return {
    ...(scope.orgId ? { orgId: scope.orgId } : {}),
    ...(scope.orgScope ? { orgScope: scope.orgScope } : {}),
    ...(scope.defaultAgentEngineScope
      ? { defaultAgentEngineScope: scope.defaultAgentEngineScope }
      : {}),
  };
}
