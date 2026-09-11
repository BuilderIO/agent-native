import type { ActionRunContext } from "@agent-native/core/action";

import type { CrmWritePolicyInput } from "./crm-contract.js";

export const CRM_SALES_ROUTINE_LOCAL_POLICY_ID =
  "crm-sales-routine-local-v1" as const;

export interface CrmSalesConfigPack {
  id: "crm-sales-v1";
  version: 1;
  delegatedWritePolicies: readonly [
    {
      id: typeof CRM_SALES_ROUTINE_LOCAL_POLICY_ID;
      target: "local";
      operation: "update";
      reversibility: "compensatable";
      scopes: readonly ["single-field", "single-record"];
      risk: "routine";
    },
  ];
}

export const CRM_SALES_CONFIG_PACK: CrmSalesConfigPack = {
  id: "crm-sales-v1",
  version: 1,
  delegatedWritePolicies: [
    {
      id: CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
      target: "local",
      operation: "update",
      reversibility: "compensatable",
      scopes: ["single-field", "single-record"],
      risk: "routine",
    },
  ],
};

export function resolveCrmSalesDelegatedWrite(input: {
  context?: ActionRunContext;
  operation: "update";
  policy: CrmWritePolicyInput;
}) {
  const policyId = input.context?.automation?.policyId;
  const policy = CRM_SALES_CONFIG_PACK.delegatedWritePolicies.find(
    (candidate) => candidate.id === policyId,
  );
  if (input.context?.caller !== "automation" || !policy) {
    return { delegatedAuthority: false, storedAutomationPolicy: false };
  }

  const matches =
    policy.operation === input.operation &&
    policy.target === input.policy.target &&
    policy.reversibility === input.policy.reversibility &&
    (input.policy.scope === "single-field" ||
      input.policy.scope === "single-record") &&
    policy.scopes.includes(input.policy.scope) &&
    policy.risk === input.policy.risk;
  return {
    delegatedAuthority: matches,
    storedAutomationPolicy: matches,
  };
}
